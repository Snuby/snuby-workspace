"use client";

// 实验室 · 本地 Agent — WorkBuddy ACP 网关协作测试 demo
// 连接可视化: 网关发现 → 建连 → initialize → 会话, 分阶段可见状态
// 协作演示: 发送任务, WorkBuddy 回复经 ACP SSE 流式渲染 (打字机效果)

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
  models?: { modelId: string; name: string; description?: string }[];
  sessionConfig?: Record<
    string,
    { id: string; name: string; description?: string; currentValue?: string; options?: { value: string; name: string; description?: string }[] }
  >;
  usage?: { used: number; size: number };
};

type ToolEv = { tool: string; state: string; detail?: string; toolCallId?: string; ts?: number };
type Msg = {
  id: number;
  role: "user" | "agent";
  text: string;
  streaming?: boolean;
  thinking?: boolean;
  tools?: ToolEv[];
  error?: boolean;
  startedAt?: number;
  finishedAt?: number;
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

/** 网关配置项的中文 label 映射; 未知配置项回退网关给的 name */
const CONFIG_LABEL: Record<string, string> = {
  mode: "权限模式",
  thought_level: "思考深度",
  sandbox: "沙箱",
  context_window: "上下文窗口",
  multitask: "多任务",
};

// 输入框自动撑开: 最多 MAX_ROWS 行, 超出才滚动
const INPUT_MAX_ROWS = 6;
const INPUT_LINE_H = 20; // 13px 字号 + line-height
const INPUT_MAX_H = INPUT_MAX_ROWS * INPUT_LINE_H + 16; // 上下 padding py-2 = 16px

export default function LocalAgentPanel() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

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
    const agentMsg: Msg = { id: id + 1, role: "agent", text: "", streaming: true, startedAt: Date.now() };
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
          let ev: { type: string; text?: string; tool?: string; state?: string; detail?: string; toolCallId?: string; error?: string };
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
              tools: [
                ...(m.tools ?? []),
                { tool: ev.tool ?? "", state: ev.state ?? "", detail: ev.detail ?? "", toolCallId: ev.toolCallId ?? "", ts: Date.now() },
              ],
            }));
          } else if (ev.type === "done") {
            update((m) => ({ ...m, streaming: false, thinking: false, finishedAt: Date.now() }));
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

  /** 切换模型: POST /api/agent/set-model, 成功用返回 status 刷新 */
  const applyModel = async (modelId: string) => {
    if (!modelId) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agent/set-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      const j = (await r.json()) as { ok: boolean; status?: AgentStatus; error?: string };
      if (j.ok && j.status) setStatus(j.status);
      else alert(j.error ?? "切换模型失败");
    } catch {
      alert("切换模型失败: 本地服务无响应");
    } finally {
      setBusy(false);
    }
  };

  /** 通用配置项: POST /api/agent/set-config (权限模式/思考深度/沙箱) */
  const applyConfig = async (configId: string, value: string) => {
    if (!value) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agent/set-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, value }),
      });
      const j = (await r.json()) as { ok: boolean; status?: AgentStatus; error?: string };
      if (j.ok && j.status) setStatus(j.status);
      else alert(j.error ?? "设置失败");
    } catch {
      alert("设置失败: 本地服务无响应");
    } finally {
      setBusy(false);
    }
  };

  // 流式自动滚底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // 输入框自动撑高: 内容增高 → 高度跟随, 达到上限后滚动
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_H)}px`;
  }, [input]);

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

      {/* ── 会话设置条 (模型 + 动态配置项 + 用量) ── */}
      {phase === "connected" && status?.sessionConfig && (
        <div className="border-b border-line bg-surface px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px]">
            <CtlSelect
              label="模型"
              value={status.sessionConfig.model?.currentValue ?? ""}
              options={
                status.models?.map((m) => ({
                  value: m.modelId,
                  label: `${m.name}${m.description ? ` · ${m.description}` : ""}`,
                })) ?? []
              }
              disabled={busy}
              onChange={(v) => void applyModel(v)}
              title="切换会话模型 (session/set_model)"
            />
            {/* 动态渲染网关暴露的其他 select 配置项 (options 非空), 新增项自动出现 */}
            {Object.entries(status.sessionConfig)
              .filter(([id, c]) => id !== "model" && (c.options?.length ?? 0) > 0)
              .map(([id, c]) => (
                <CtlSelect
                  key={id}
                  label={CONFIG_LABEL[id] ?? c.name}
                  value={c.currentValue ?? ""}
                  options={(c.options ?? []).map((o) => ({
                    value: o.value,
                    label: `${o.name}${o.description ? ` · ${o.description}` : ""}`,
                  }))}
                  disabled={busy}
                  onChange={(v) => void applyConfig(id, v)}
                  title={c.description ?? undefined}
                />
              ))}
            {status.usage ? (
              <span className="ml-auto tabular-nums text-ink-faint" title={`token 用量 ${status.usage.used} / ${status.usage.size}`}>
                用量 {(status.usage.used / 1000).toFixed(1)}k / {(status.usage.size / 1000).toFixed(0)}k
              </span>
            ) : null}
          </div>
        </div>
      )}

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
          <div className="mx-auto space-y-3" style={{ width: "min(max(820px, 80vw), 100%)" }}>
            {msgs.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="group flex items-end justify-end gap-1.5">
                    <CopyBtn text={m.text} />
                    <div className="max-w-[70%] rounded-xl rounded-br-sm bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-white">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[90%]">
                    <div className="group mb-1 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                      <span className="text-[11px] font-medium text-ink-muted">本地 Agent</span>
                      {m.streaming && (
                        <span className="text-[11px] text-accent">
                          {m.thinking ? "思考中…" : "正在生成…"}
                        </span>
                      )}
                      <span className="ml-auto">
                        <CopyBtn text={m.text} />
                      </span>
                    </div>
                    <ToolStrip m={m} />
                    <div
                      className={`rounded-xl rounded-tl-sm border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        m.error ? "border-up/40 text-up" : "text-ink"
                      }`}
                    >
                      {m.error ? (
                        m.text
                      ) : m.text ? (
                        <>
                          {renderMd(m.text)}
                          {m.streaming ? <span className="animate-pulse">▍</span> : null}
                        </>
                      ) : m.streaming ? (
                        <span className="animate-pulse">▍</span>
                      ) : (
                        "…"
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
        <div className="mx-auto flex items-center gap-2" style={{ width: "min(max(820px, 80vw), 100%)" }}>
          <textarea
            ref={taRef}
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
            style={{ maxHeight: INPUT_MAX_H }}
            className="min-h-[38px] flex-1 resize-none overflow-y-auto rounded-lg border border-line bg-page px-3 py-2 text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-50"
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
        <div className="mx-auto mt-1.5 text-[10.5px] text-ink-faint" style={{ width: "min(max(820px, 80vw), 100%)" }}>
          ACP over HTTP+SSE · 连接令牌仅保存在本机内存 · 权限请求默认拒绝
        </div>
      </div>
    </div>
  );
}

const IconCopy = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

const IconCheck = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

/** 复制按钮: hover 显示, 点击复制消息原文 (Markdown) */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      title="复制原文"
      aria-label="复制原文"
      onClick={() => void copy()}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-all hover:bg-black/5 hover:text-ink group-hover:opacity-100"
    >
      {copied ? <IconCheck className="h-3.5 w-3.5 text-down" /> : <IconCopy className="h-3.5 w-3.5" />}
    </button>
  );
}

const IconChevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** 会话配置下拉: label + select (WorkBuddy 会话设置入口) */
function CtlSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5" title={title}>
      <span className="text-ink-faint">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[220px] cursor-pointer rounded-md border border-line bg-page px-1.5 py-0.5 text-[11.5px] text-ink outline-none hover:border-accent focus:border-accent disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 工具信息条 (WorkBuddy 风格): 聚合展示工具执行状态与耗时, 可点击展开明细列表 */
function ToolStrip({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false);
  const tools = m.tools ?? [];

  // 按 toolCallId 聚合: 起始时间/结束时间/工具/参数, 按开始时间排序
  // 依赖 m.tools (引用稳定), 内部再 ?? [] 兜底, 避免每次渲染新数组
  const rows = useMemo(() => {
    const arr = m.tools ?? [];
    const map = new Map<string, { tool: string; detail: string; start: number; end: number }>();
    arr.forEach((t, i) => {
      const k = t.toolCallId || `${t.tool}-${i}`;
      const ts = t.ts ?? 0;
      const r = map.get(k) ?? { tool: t.tool, detail: "", start: ts, end: ts };
      if (!r.start || (ts && ts < r.start)) r.start = ts;
      if (ts > r.end) r.end = ts;
      if (t.detail) r.detail = t.detail;
      map.set(k, r);
    });
    return [...map.values()]
      .sort((a, b) => a.start - b.start)
      .map((r) => ({ ...r, ms: r.end - r.start }));
  }, [m.tools]);

  if (!tools.length && !m.streaming) return null;
  const last = tools[tools.length - 1];
  const unique = [...new Set(tools.map((t) => t.tool))].join("、") || "任务";
  const elapsed = m.finishedAt && m.startedAt
    ? Math.round((m.finishedAt - m.startedAt) / 1000)
    : Math.max(0, Math.round((Date.now() - (m.startedAt ?? Date.now())) / 1000));
  const detail = last?.detail ? ` · ${last.detail}` : "";

  const fmtTime = (n: number) =>
    n ? new Date(n).toLocaleTimeString("zh-CN", { hour12: false }) : "—";

  return (
    <div className="mb-1.5">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
        title={rows.length ? "点击展开/收起工具明细" : undefined}
        className="flex min-h-[22px] cursor-pointer select-none items-center gap-2 rounded-md bg-black/[0.03] px-2.5 py-1 text-[11.5px] text-ink-muted hover:bg-black/[0.05]"
      >
        <span
          className={`shrink-0 rounded px-1.5 py-px font-medium ${
            m.streaming ? "bg-accent-soft text-accent-deep" : "bg-black/[0.04] text-ink-muted"
          }`}
        >
          {m.streaming ? "正在执行" : "已处理"}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {m.streaming ? (last ? `${last.tool}${detail ? ` · ${detail}` : ""}` : "任务运行中…") : `${unique}${detail ? ` · ${detail}` : ""}`}
        </span>
        <span className="shrink-0 tabular-nums">{elapsed}s</span>
        {rows.length > 0 ? <IconChevron open={open} /> : null}
      </div>
      {open && rows.length > 0 ? (
        <div className="mt-1 max-h-[200px] overflow-y-auto rounded-md border border-line bg-white/60">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-ink-faint">
                <th className="whitespace-nowrap px-2 py-1 text-left font-medium">时间</th>
                <th className="px-2 py-1 text-left font-medium">工具</th>
                <th className="px-2 py-1 text-left font-medium">参数</th>
                <th className="whitespace-nowrap px-2 py-1 text-right font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums">{fmtTime(r.start)}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-medium text-ink">{r.tool}</td>
                  <td className="max-w-[260px] truncate px-2 py-1" title={r.detail}>
                    {r.detail || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {r.ms > 0 ? `${(r.ms / 1000).toFixed(1)}s` : "…"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** 行内解析: **粗体** `代码` [链接](url) ![图片/视频](url "title")
 *  + HTML 白名单直通: <video> / <img> (属性+协议双重校验)
 *  + 裸 http(s) URL 自动转可点击链接 */
function Inline({ text }: { text: string }) {
  const parts = text.split(
    /(<video[^>]*>[\s\S]*?<\/video>|<img[^>]*\/?>|\*\*[^*\n]+\*\*|`[^`\n]+`|!\[[^\]\n]+\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<]+)/g,
  );
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    // 安全: 协议白名单 + 标签/属性白名单
    const LOCAL_RE = /^(\/Users\/|\/home\/|\/private\/|\/tmp\/|file:\/\/)/;
    const safeUrl = (u: string) => /^(https?:\/\/|data:image\/)/i.test(u) || LOCAL_RE.test(u);
    const toSrc = (u: string) => {
      const cleaned = u.replace(/^file:\/\//, "");
      return LOCAL_RE.test(u) ? `/api/local-file?path=${encodeURIComponent(cleaned)}` : u;
    };

    const vtag = p.match(/^<video([^>]*)>[\s\S]*?<\/video>$/i);
    if (vtag) {
      const attrs = vtag[1];
      const src = attrs.match(/src="([^"]+)"/)?.[1] ?? "";
      const width = attrs.match(/width="?(\d+)"?/)?.[1];
      const height = attrs.match(/height="?(\d+)"?/)?.[1];
      const controls = /\bcontrols\b/i.test(attrs);
      if (src && safeUrl(src)) {
        out.push(
          <video
            key={i}
            src={toSrc(src)}
            controls={controls || true}
            playsInline
            style={{ width: width ? `${width}px` : "100%", maxHeight: height ? `${height}px` : 320 }}
            className="my-1 rounded-lg border border-line bg-black/5"
          />,
        );
        return;
      }
      out.push(<span key={i}>{p}</span>);
      return;
    }

    const htag = p.match(/^<img([^>]*)\/?>$/i);
    if (htag) {
      const attrs = htag[1];
      const src = attrs.match(/src="([^"]+)"/)?.[1] ?? "";
      const width = attrs.match(/width="?(\d+)"?/)?.[1];
      const height = attrs.match(/height="?(\d+)"?/)?.[1];
      const alt = attrs.match(/alt="([^"]*)"/)?.[1] ?? "";
      if (src && safeUrl(src)) {
        out.push(
          <img
            key={i}
            src={toSrc(src)}
            alt={alt}
            loading="lazy"
            style={{ width: width ? `${width}px` : "100%", maxHeight: height ? `${height}px` : 360 }}
            className="my-1 rounded-lg border border-line object-contain bg-black/[0.02]"
          />,
        );
        return;
      }
      out.push(<span key={i}>{p}</span>);
      return;
    }

    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      out.push(<strong key={i}>{p.slice(2, -2)}</strong>);
      return;
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      out.push(
        <code key={i} className="rounded bg-black/[0.06] px-1 py-0.5 text-[12px]">
          {p.slice(1, -1)}
        </code>,
      );
      return;
    }

    // 图片语法: ![alt](url) / ![alt](url "title")
    const img = p.match(/^!\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (img) {
      const alt = img[1];
      const src = img[2].trim();
      const title = img[3] ?? "";
      if (safeUrl(src)) {
        if (/\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(src)) {
          out.push(
            <video key={i} src={toSrc(src)} controls playsInline className="my-1 max-h-[320px] w-full rounded-lg border border-line bg-black/5">
              <p className="px-2 py-1 text-[11.5px] text-ink-muted">视频无法预览: {alt || src}</p>
            </video>,
          );
        } else {
          out.push(
            <img
              key={i}
              src={toSrc(src)}
              alt={alt}
              title={title || undefined}
              loading="lazy"
              className="my-1 max-h-[360px] w-full rounded-lg border border-line object-contain bg-black/[0.02]"
            />,
          );
        }
        return;
      }
      out.push(<span key={i}>{alt}</span>);
      return;
    }

    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m && safeUrl(m[2])) {
      out.push(
        <a
          key={i}
          href={toSrc(m[2])}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/40 underline-offset-2"
        >
          {m[1]}
        </a>,
      );
      return;
    }

    // 裸 URL: 自动可点击
    if (/^https?:\/\//i.test(p)) {
      out.push(
        <a
          key={i}
          href={p}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/40 underline-offset-2"
        >
          {p}
        </a>,
      );
      return;
    }

    const lines = p.split("\n");
    lines.forEach((ln, li) => {
      if (li > 0) out.push(<br key={`br-${i}-${li}`} />);
      out.push(<span key={`${i}-${li}`}>{ln}</span>);
    });
  });
  return <>{out}</>;
}

/** 轻量 Markdown 渲染: 标题/表格/列表/引用/代码块/段落/行内格式 (WorkBuddy 风格) */
function renderMd(md: string): ReactNode[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const parseRow = (r: string) => r.split("|").slice(1, -1).map((x) => x.trim());
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        <pre key={`pre-${i}`} className="my-1 overflow-x-auto rounded-lg bg-black/[0.05] p-2.5 text-[12px] leading-relaxed">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const header = parseRow(lines[i]);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(parseRow(lines[j]));
        j++;
      }
      out.push(
        <div key={`tbl-${i}`} className="my-1 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} className="border border-line bg-black/[0.03] px-2.5 py-1.5 text-left font-medium">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-line px-2.5 py-1.5 align-top leading-relaxed">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j;
      continue;
    }
    if (/^#{1,3} /.test(trimmed)) {
      const level = trimmed.match(/^#+/)![0].length;
      const text = trimmed.replace(/^#+\s*/, "");
      out.push(
        level <= 2 ? (
          <h4 key={`h-${i}`} className="mb-1 mt-2.5 flex items-center gap-1.5 text-[14px] font-bold text-ink">
            <span className="h-3 w-[3px] rounded-full bg-accent" />
            <Inline text={text} />
          </h4>
        ) : (
          <h5 key={`h-${i}`} className="mb-0.5 mt-2 text-[13px] font-semibold text-ink">
            <Inline text={text} />
          </h5>
        ),
      );
      i++;
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*] /, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="my-1 list-disc space-y-0.5 pl-4">
          {items.map((it, ii) => (
            <li key={ii}>
              <Inline text={it} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\. /, ""));
        i++;
      }
      out.push(
        <ol key={`ol-${i}`} className="my-1 list-decimal space-y-0.5 pl-4">
          {items.map((it, ii) => (
            <li key={ii}>
              <Inline text={it} />
            </li>
          ))}
        </ol>,
      );
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote key={`q-${i}`} className="my-1 border-l-2 border-accent/40 pl-2.5 text-[12.5px] text-ink-muted">
          {quote.map((q, qi) => (
            <div key={qi}>
              <Inline text={q} />
            </div>
          ))}
        </blockquote>,
      );
      continue;
    }
    if (!trimmed) {
      i++;
      continue;
    }
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const t = lines[j].trim();
      if (!t || t.startsWith("|") || t.startsWith("```") || /^#{1,3} /.test(t) || /^\s*[-*] /.test(t) || /^\s*\d+\. /.test(t) || t.startsWith(">")) break;
      para.push(lines[j]);
      j++;
    }
    out.push(
      <p key={`p-${i}`} className="my-1 leading-relaxed">
        <Inline text={para.join("\n")} />
      </p>,
    );
    i = j;
  }
  return out;
}
