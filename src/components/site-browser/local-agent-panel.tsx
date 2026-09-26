"use client";

// 实验室 · 本地 Agent — WorkBuddy ACP 网关协作测试 demo
// 连接可视化: 网关发现 → 建连 → initialize → 会话, 分阶段可见状态
// 协作演示: 发送任务, WorkBuddy 回复经 ACP SSE 流式渲染 (打字机效果)

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "discovering" | "connecting" | "connected" | "error";

type AgentStatus = {
  phase: Phase;
  discovered?: { pid: number; port: number; sessionId: string; cwd: string; heartbeatMsAgo: number };
  connectionIdMasked?: string;
  protocolVersion?: number;
  capabilities?: {
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    loadSession?: boolean;
    multitaskSupport?: boolean;
    delegateToolsSupport?: boolean;
  };
  authMethods?: string[];
  acpSessionId?: string;
  lastError?: string;
};

type ToolEv = { tool: string; state: string };
type Msg = {
  id: number;
  role: "user" | "agent";
  text: string;
  streaming?: boolean;
  thinking?: boolean;
  tools?: ToolEv[];
  error?: boolean;
};

const PHASE_META: Record<Phase, { label: string; color: string; dot: string }> = {
  idle: { label: "未检测到 WorkBuddy 网关", color: "bg-ink-faint/20 text-ink-faint", dot: "bg-ink-faint" },
  discovering: { label: "正在发现网关…", color: "bg-ink-faint/20 text-ink-faint", dot: "bg-ink-faint animate-pulse" },
  connecting: { label: "正在建立连接…", color: "bg-accent-soft text-accent-deep", dot: "bg-accent animate-pulse" },
  connected: { label: "已连接 WorkBuddy 网关", color: "bg-down-soft text-down", dot: "bg-down" },
  error: { label: "连接失败", color: "bg-up-soft text-up", dot: "bg-up" },
};

const PRESET_TASKS = [
  "用一句话介绍你自己",
  "列出你最擅长处理的 5 类任务",
];

export default function LocalAgentPanel() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const phase = status?.phase ?? "idle";

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/status", { cache: "no-store" });
      const j = (await r.json()) as { status: AgentStatus };
      setStatus(j.status);
    } catch {
      // 网络错误忽略, 下轮重试
    }
  }, []);

  // 挂载 + 周期轮询 (3s), 感知网关存活变化
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setStatus((s) => ({ ...(s ?? {}), phase: "connecting" }) as AgentStatus);
    try {
      const r = await fetch("/api/agent/connect", { method: "POST" });
      const j = (await r.json()) as { status: AgentStatus };
      setStatus(j.status);
    } catch {
      setStatus((s) => ({ ...(s ?? {}), phase: "error", lastError: "本地服务无响应" }) as AgentStatus);
    } finally {
      setBusy(false);
    }
  };

  const send = async (text?: string) => {
    const task = (text ?? input).trim();
    if (!task || running) return;
    setInput("");
    setRunning(true);
    const id = Date.now();
    setMsgs((m) => [...m, { id, role: "user", text: task }]);
    const agentMsg: Msg = { id: id + 1, role: "agent", text: "", streaming: true };
    setMsgs((m) => [...m, agentMsg]);
    const ac = new AbortController();
    abortRef.current = ac;
    const update = (fn: (m: Msg) => Msg) =>
      setMsgs((all) => all.map((m) => (m.id === agentMsg.id ? fn(m) : m)));
    try {
      const res = await fetch("/api/agent/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: task }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error("任务启动失败");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let ev: { type: string; text?: string; tool?: string; state?: string; error?: string };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "chunk") {
            update((m) => ({ ...m, text: m.text + (ev.text ?? ""), thinking: false }));
          } else if (ev.type === "thought") {
            update((m) => ({ ...m, thinking: true }));
          } else if (ev.type === "tool") {
            update((m) => ({
              ...m,
              tools: [...(m.tools ?? []), { tool: ev.tool ?? "", state: ev.state ?? "" }],
            }));
          } else if (ev.type === "done") {
            update((m) => ({ ...m, streaming: false, thinking: false }));
          } else if (ev.type === "error") {
            update((m) => ({ ...m, streaming: false, error: true, text: ev.error ?? "任务执行失败" }));
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        update((m) => ({ ...m, streaming: false, error: true, text: (e as Error).message }));
      } else {
        update((m) => ({ ...m, streaming: false, text: m.text + "\n\n(已停止)" }));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = async () => {
    abortRef.current?.abort();
    try {
      await fetch("/api/agent/cancel", { method: "POST" });
    } catch {
      // 忽略
    }
  };

  // 流式自动滚底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const pm = PHASE_META[phase];
  const caps = status?.capabilities;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-page">
      {/* ── 连接状态条 ── */}
      <div className="flex items-start gap-3 border-b border-line bg-surface px-4 py-3">
        <div
          className={`mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${pm.color}`}
        >
          <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
          {pm.label}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-muted">
            {status?.discovered ? (
              <>
                <span>
                  网关 <b className="font-semibold text-ink">{status.discovered.pid}</b> ·{" "}
                  <b className="font-semibold text-ink">127.0.0.1:{status.discovered.port}</b>
                </span>
                <span>会话 {status.discovered.sessionId.slice(0, 8)}…</span>
                <span>心跳 {Math.round(status.discovered.heartbeatMsAgo / 1000)}s 前</span>
              </>
            ) : (
              <span>未发现 ~/.workbuddy/sessions 存活网关，请先启动 WorkBuddy</span>
            )}
            {status?.connectionIdMasked && (
              <>
                <span>
                  连接 <b className="font-semibold text-ink">{status.connectionIdMasked}</b>
                </span>
                <span>ACP 协议 v{status.protocolVersion}</span>
                {status.acpSessionId && <span>会话 {status.acpSessionId.slice(0, 8)}…</span>}
              </>
            )}
          </div>
          {/* 能力徽章 */}
          {caps && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[
                caps.loadSession && "loadSession",
                caps.multitaskSupport && "multitask",
                caps.promptCapabilities?.image && "image",
                caps.promptCapabilities?.embeddedContext && "embeddedContext",
                caps.mcpCapabilities?.http && "MCP·HTTP",
                caps.mcpCapabilities?.sse && "MCP·SSE",
                ...(status.authMethods ?? []).map((a) => `auth:${a}`),
              ]
                .filter(Boolean)
                .map((c) => (
                  <span
                    key={String(c)}
                    className="rounded border border-line bg-page px-1.5 py-0.5 text-[10.5px] text-ink-muted"
                  >
                    {c}
                  </span>
                ))}
            </div>
          )}
          {status?.lastError && (
            <div className="mt-1.5 rounded bg-up-soft px-2 py-1.5 text-[11.5px] leading-snug text-up">
              {status.lastError}
            </div>
          )}
        </div>
        {phase !== "connected" ? (
          <button
            onClick={connect}
            disabled={busy}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {busy ? "连接中…" : "连接"}
          </button>
        ) : (
          <button
            onClick={connect}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-page"
          >
            重连
          </button>
        )}
      </div>

      {/* ── 协作演示区 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-[15px] font-semibold text-ink">本地 Agent 协作演示</div>
            <div className="mt-2 max-w-[460px] text-[12.5px] leading-relaxed text-ink-muted">
              通过本机 ACP 网关（HTTP + SSE）与 WorkBuddy 建立连接，
              <br />
              在这里发送任务，WorkBuddy 的回复将流式实时渲染。
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {PRESET_TASKS.map((t) => (
                <button
                  key={t}
                  onClick={() => send(t)}
                  disabled={running}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-40"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[820px] space-y-3">
            {msgs.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[70%] rounded-xl rounded-br-sm bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-white">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[90%]">
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                      <span className="text-[11px] font-medium text-ink-muted">本地 Agent</span>
                      {m.streaming && (
                        <span className="text-[11px] text-accent">
                          {m.thinking ? "思考中…" : "正在生成…"}
                        </span>
                      )}
                    </div>
                    {!!m.tools?.length && (
                      <div className="mb-1.5 flex flex-wrap gap-1">
                        {m.tools.map((t, i) => (
                          <span
                            key={i}
                            className="flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-muted"
                          >
                            <span
                              className={`h-1 w-1 rounded-full ${
                                t.state === "pending" ? "bg-ink-faint" : "bg-down"
                              }`}
                            />
                            {t.tool}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      className={`rounded-xl rounded-tl-sm border border-line bg-surface px-3.5 py-2 text-[13px] leading-relaxed ${
                        m.error ? "border-up/40 text-up" : "text-ink"
                      }`}
                    >
                      {m.streaming ? (
                        <>
                          {m.text}
                          <span className="animate-pulse">▍</span>
                        </>
                      ) : (
                        m.text || "…"
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── 输入区 ── */}
      <div className="border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-[820px] items-center gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={phase === "connected" ? "给本地 Agent 派个任务… (Enter 发送, Shift+Enter 换行)" : "请先连接 WorkBuddy 网关"}
            disabled={phase !== "connected" || running}
            rows={1}
            className="max-h-[120px] min-h-[38px] flex-1 resize-none rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-50"
          />
          {running ? (
            <button
              onClick={stop}
              className="shrink-0 rounded-lg bg-up px-4 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={phase !== "connected" || !input.trim()}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-white hover:bg-accent-deep disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
        <div className="mx-auto mt-1.5 max-w-[820px] text-[10.5px] text-ink-faint">
          ACP over HTTP+SSE · 连接令牌仅保存在本机内存 · 权限请求默认拒绝
        </div>
      </div>
    </div>
  );
}
