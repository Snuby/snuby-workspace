"use client";

// 实验室 · 本地 Agent — WorkBuddy ACP 网关协作测试 demo
// 连接可视化: 网关发现 → 建连 → initialize → 会话, 分阶段可见状态
// 协作演示: 发送任务, WorkBuddy 回复经 ACP SSE 流式渲染 (打字机效果)

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useClickOutside } from "@/lib/use-click-outside";

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
/** 本地会话元信息 (磁盘持久化) */
type SessionInfo = { id: string; title: string; createdAt: number; updatedAt: number; acpSessionId?: string };

/** 磁盘存储的消息形态 (messages.jsonl 单行) */
type StoredMsg = {
  role: "user" | "assistant";
  text: string;
  tools?: { tool: string; detail?: string; toolCallId?: string; ts?: number }[];
  error?: boolean;
  ts: number;
};

/** 磁盘消息 → 面板消息 */
function storedToMsg(m: StoredMsg): Msg {
  return {
    id: m.ts,
    role: m.role === "user" ? "user" : "agent",
    text: m.text,
    tools: (m.tools ?? []).map((t) => ({
      tool: t.tool,
      state: "",
      detail: t.detail ?? "",
      toolCallId: t.toolCallId ?? "",
      ts: t.ts ?? 0,
    })),
    error: m.error,
    streaming: false,
    finishedAt: m.ts,
  };
}

/** 本地 markdown 文档预览状态 */
type DocPreview = {
  path: string;
  title: string;
  text: string;
  loading: boolean;
  error?: string;
};

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
  /** 正在预览的本地 markdown 文档 (点击 📄 打开) */
  const [preview, setPreview] = useState<DocPreview | null>(null);
  /** 本地会话: 列表 / 当前会话 / 历史加载中 */
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [histLoaded, setHistLoaded] = useState(false);
  /** 流式中的最新 agent 消息 (供结束落盘) */
  const agentLatestRef = useRef<Msg | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  /** 状态信息下拉 */
  const infoRef = useRef<HTMLDivElement | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  useClickOutside(infoRef, infoOpen, () => setInfoOpen(false));

  /** 点击 📄 打开本地 markdown 文档: 拉取文本并内联预览 */
  const openDoc = useCallback(async (path: string, title: string) => {
    setPreview({ path, title, text: "", loading: true });
    try {
      const r = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      setPreview({ path, title, text, loading: false, error: undefined });
    } catch (e) {
      setPreview({
        path,
        title,
        text: "",
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  /** 「📄 文件名」补偿定位: 用会话工作目录做候选 */
  const docHints = useMemo(
    () => (status?.discovered?.cwd ? [status.discovered.cwd] : []),
    [status?.discovered?.cwd],
  );

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

  // 会话列表 + 最近会话历史 (磁盘持久化)
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/agent/sessions", { cache: "no-store" });
        const j = (await r.json()) as { sessions: SessionInfo[] };
        const list = j.sessions ?? [];
        setSessions(list);
        if (list.length) {
          setCurrentId(list[0].id);
          const mr = await fetch(`/api/agent/sessions/${list[0].id}/messages`, { cache: "no-store" });
          const mj = (await mr.json()) as { messages: StoredMsg[] };
          setMsgs((mj.messages ?? []).map(storedToMsg));
        } else {
          await createLocalSession();
        }
      } catch {
        // 网络失败忽略, 面板仍可连接后新建
      }
      setHistLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 新建本地会话 */
  const createLocalSession = async () => {
    try {
      const r = await fetch("/api/agent/sessions", { method: "POST" });
      const j = (await r.json()) as { session: SessionInfo };
      setSessions((x) => [j.session, ...x]);
      setCurrentId(j.session.id);
      setMsgs([]);
    } catch {
      // 落盘失败不阻塞本地会话
    }
  };

  /** 切换本地会话 (加载历史 + 恢复网关上下文) */
  const switchSession = async (id: string) => {
    if (id === currentId) return;
    setCurrentId(id);
    setMsgs([]);
    try {
      const r = await fetch(`/api/agent/sessions/${id}/messages`, { cache: "no-store" });
      const j = (await r.json()) as { messages: StoredMsg[] };
      setMsgs((j.messages ?? []).map(storedToMsg));
    } catch {
      // 忽略
    }
    // 已连接时激活该会话绑定的网关会话 (session/load 恢复上下文, 使 WorkBuddy 记得之前对话)
    if (phase === "connected") {
      try {
        await fetch(`/api/agent/sessions/${id}/activate`, { method: "POST" });
      } catch {
        // 激活失败不阻塞; 下次发送时 prompt 内部会再对齐
      }
      void refresh();
    }
  };

  /** 删除本地会话 (磁盘+列表); 删当前则切到最近会话 */
  const removeSession = async (id: string) => {
    try {
      await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
    } catch {
      // 忽略
    }
    const rest = sessions.filter((x) => x.id !== id);
    setSessions(rest);
    if (id === currentId) {
      if (rest.length) void switchSession(rest[0].id);
      else void createLocalSession();
    }
  };

  /** 落盘一条消息到当前会话 */
  const persist = (role: "user" | "assistant", msg: Partial<Msg>) => {
    if (!currentId) return;
    void fetch(`/api/agent/sessions/${currentId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role,
        text: msg.text ?? "",
        tools: msg.tools,
        error: msg.error,
        ts: Date.now(),
      }),
    });
  };

  /** 相对时间 */
  const fmtRel = (ts: number) => {
    const d = Date.now() - ts;
    if (d < 60_000) return "刚刚";
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
    return `${Math.floor(d / 86_400_000)}d`;
  };

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
    persist("user", { text: task });
    const agentMsg: Msg = { id: id + 1, role: "agent", text: "", streaming: true, startedAt: Date.now() };
    agentLatestRef.current = agentMsg;
    setMsgs((m) => [...m, agentMsg]);
    const ac = new AbortController();
    abortRef.current = ac;
    const update = (fn: (m: Msg) => Msg) =>
      setMsgs((all) =>
        all.map((m) => {
          if (m.id !== agentMsg.id) return m;
          const next = fn(m);
          agentLatestRef.current = next;
          return next;
        }),
      );
    try {
      const res = await fetch("/api/agent/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: task, localSessionId: currentId ?? undefined }),
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
      const last = agentLatestRef.current;
      agentLatestRef.current = null;
      if (last) persist("assistant", { text: last.text, tools: last.tools, error: last.error });
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
    <div className="flex h-full w-full overflow-hidden bg-page">
      {/* ── 会话侧栏 (磁盘持久化的本地会话) ── */}
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">会话</span>
          <button
            type="button"
            title="新建会话"
            aria-label="新建会话"
            onClick={() => void createLocalSession()}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {!histLoaded ? (
            <div className="px-2 py-2 text-[11.5px] text-ink-faint">加载中…</div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-2 text-[11.5px] text-ink-faint">暂无会话，点 + 新建</div>
          ) : (
            sessions.map((sd) => (
              <div
                key={sd.id}
                role="button"
                tabIndex={0}
                onClick={() => void switchSession(sd.id)}
                onKeyDown={(e) => e.key === "Enter" && void switchSession(sd.id)}
                className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] ${
                  sd.id === currentId ? "bg-accent-soft font-medium text-accent-deep" : "text-ink hover:bg-black/5"
                }`}
                title={sd.title}
              >
                <span className="min-w-0 flex-1 truncate">{sd.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{fmtRel(sd.updatedAt)}</span>
                <button
                  type="button"
                  aria-label={`删除会话 ${sd.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeSession(sd.id);
                  }}
                  className="hidden h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/10 hover:text-red-500 group-hover:flex"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3 w-3">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── 连接状态条 ── */}
      <div className="relative flex items-start gap-3 border-b border-line bg-surface px-4 py-3">
        <div
          className={`mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${pm.color}`}
        >
          <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
          {pm.label}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-muted">
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
          </div>
          {status?.lastError && (
            <div className="mt-1.5 rounded bg-up-soft px-2 py-1.5 text-[11.5px] leading-snug text-up">
              {status.lastError}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 状态信息按钮: 点击展示连接/会话/能力详情 */}
          <div className="relative">
            <button
              type="button"
              aria-label="网关状态信息"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
            >
              <IconInfo />
            </button>
            {infoOpen && phase === "connected" && status ? (
              <div
                ref={infoRef}
                className="absolute right-0 top-[36px] z-50 w-[360px] rounded-lg border border-line bg-white p-3.5 shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-ink">网关连接信息</span>
                  <button
                    type="button"
                    aria-label="关闭信息"
                    onClick={() => setInfoOpen(false)}
                    className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5">
                      <path d="M6 6l12 12" />
                      <path d="M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-1.5 text-[11.5px]">
                  {status.discovered ? (
                    <>
                      <InfoRow label="网关进程" value={`${status.discovered.pid} · 127.0.0.1:${status.discovered.port}`} mono />
                      <InfoRow label="心跳" value={`${Math.round(status.discovered.heartbeatMsAgo / 1000)}s 前`} />
                    </>
                  ) : null}
                  {status.connectionIdMasked ? (
                    <InfoRow label="连接 ID" value={status.connectionIdMasked} mono />
                  ) : null}
                  {status.protocolVersion ? (
                    <InfoRow label="协议版本" value={`v${status.protocolVersion}`} />
                  ) : null}
                  {status.acpSessionId ? (
                    <InfoRow label="ACP 会话" value={`${status.acpSessionId.slice(0, 8)}…${status.acpSessionId.slice(-4)}`} mono />
                  ) : null}
                </div>
                {caps ? (
                  <div className="mt-2.5 border-t border-line pt-2">
                    <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
                      网关能力
                    </div>
                    <div className="flex flex-wrap gap-1">
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
                  </div>
                ) : null}
              </div>
            ) : null}
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
                          {renderMd(m.text, openDoc, docHints)}
                          {m.streaming ? <span className="animate-pulse">▍</span> : null}
                        </>
                      ) : m.streaming ? (
                        <span className="animate-pulse">▍</span>
                      ) : (
                        "…"
                      )}
                    </div>
                    {/* 文档预览卡 (点击 📄 后展开) */}
                    {preview ? (
                      <DocPreviewCard
                        preview={preview}
                        onClose={() => setPreview(null)}
                        onOpenDoc={openDoc}
                        docHints={docHints}
                      />
                    ) : null}
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

const IconInfo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

/** 文档预览卡: 渲染本地 markdown 内容, 支持复制路径/关闭 */
function DocPreviewCard({
  preview,
  onClose,
  onOpenDoc,
  docHints,
}: {
  preview: DocPreview;
  onClose: () => void;
  onOpenDoc: (path: string, title: string) => void;
  docHints: string[];
}) {
  const [copied, setCopied] = useState(false);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(preview.path);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = preview.path;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-page px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">📄 {preview.title}</span>
        <span className="max-w-[220px] truncate font-mono text-[10.5px] text-ink-faint" title={preview.path}>
          {preview.path}
        </span>
        <button
          type="button"
          title="复制路径"
          aria-label="复制文档路径"
          onClick={() => void copyPath()}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
        >
          {copied ? <IconCheck className="h-3.5 w-3.5 text-down" /> : <IconCopy className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          title="关闭预览"
          aria-label="关闭文档预览"
          onClick={onClose}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
        {preview.loading ? (
          <span className="animate-pulse text-ink-faint">加载中…</span>
        ) : preview.error ? (
          <div className="rounded bg-up-soft px-2.5 py-2 text-[12px] leading-snug text-up">
            打开失败: {preview.error}
          </div>
        ) : (
          renderMd(preview.text, onOpenDoc, docHints)
        )}
      </div>
    </div>
  );
}

/** 信息下拉中的键值行 */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-ink-faint">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono text-[10.5px]" : ""} text-ink`}>{value}</span>
    </div>
  );
}

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(wrapRef, open, () => setOpen(false));
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
    <div ref={wrapRef} className="mb-1.5">
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
 *  + 裸 http(s) URL 自动转可点击链接
 *  + 本地 markdown 路径 → 可点击按钮 (点击内联预览)
 *  + 「📄 文件名.md」纯文本 → 用 docHints (会话工作目录) 尝试定位并预览 */
function Inline({
  text,
  onOpenDoc,
  docHints,
}: {
  text: string;
  onOpenDoc?: (path: string, title: string) => void;
  docHints?: string[];
}) {
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
      const target = m[2].trim();
      // 本地 markdown 文档: 不跳转, 点击内联预览
      if (LOCAL_RE.test(target) && /\.(md|markdown)(\?|#|$)/i.test(target)) {
        out.push(
          <button
            key={i}
            type="button"
            onClick={() => onOpenDoc?.(target.replace(/^file:\/\//, ""), m[1])}
            title={target}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 align-baseline text-[12px] font-medium text-accent-deep transition-colors hover:bg-accent/15"
          >
            <span className="truncate">📄 {m[1]}</span>
          </button>,
        );
        return;
      }
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

    // 「📄 文件名.md」纯文本: 结合 docHints (会话工作目录) 尝试定位
    const docHint = p.match(/^📄\s*([^\s「」()]+\.md|\.markdown)$/i);
    if (docHint && onOpenDoc && docHints?.length) {
      const name = docHint[1];
      const full = `${docHints[0].replace(/\/$/, "")}/${name}`;
      out.push(
        <button
          key={i}
          type="button"
          onClick={() => onOpenDoc(full, name)}
          title={`点击预览 ${full}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 align-baseline text-[12px] font-medium text-accent-deep transition-colors hover:bg-accent/15"
        >
          <span className="truncate">{p}</span>
        </button>,
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
function renderMd(
  md: string,
  onOpenDoc?: (path: string, title: string) => void,
  docHints?: string[],
): ReactNode[] {
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
                    <Inline text={h} onOpenDoc={onOpenDoc} docHints={docHints} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-line px-2.5 py-1.5 align-top leading-relaxed">
                      <Inline text={c} onOpenDoc={onOpenDoc} docHints={docHints} />
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
            <Inline text={text} onOpenDoc={onOpenDoc} docHints={docHints} />
          </h4>
        ) : (
          <h5 key={`h-${i}`} className="mb-0.5 mt-2 text-[13px] font-semibold text-ink">
            <Inline text={text} onOpenDoc={onOpenDoc} docHints={docHints} />
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
              <Inline text={it} onOpenDoc={onOpenDoc} docHints={docHints} />
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
              <Inline text={it} onOpenDoc={onOpenDoc} docHints={docHints} />
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
              <Inline text={q} onOpenDoc={onOpenDoc} docHints={docHints} />
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
        <Inline text={para.join("\n")} onOpenDoc={onOpenDoc} docHints={docHints} />
      </p>,
    );
    i = j;
  }
  return out;
}
