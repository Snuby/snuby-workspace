// WorkBuddy 本机 ACP 网关客户端 (服务端多连接池)
// 协议依据: ~/Workbuddy/.../workbuddy-acp-integration-prompt.md (2026-09-26 实测)
// - 发现: ~/.workbuddy/sessions/*.json 的 pid → lsof 解析 127.0.0.1 监听端口
// - 建连: POST /api/v1/acp/connect → connectionId + sessionToken (仅内存)
// - 调用: POST /api/v1/acp 标准 JSON-RPC 2.0, 响应为 SSE 流 (:ok keepalive + event: message)
// 多会话隔离: 全局串行队列 + 每个本地会话自己的 ACP sessionId / cwd。
// 网关进程里工具授权是全局总线: 每条 HTTP 连接都会注册一个 Agent,
// 其中任一 Agent 发现会话 abortSignal 已置位就会替所有人拒绝这次授权。
// 因此整个进程只保持一条 ACP 连接, 重连前先关掉旧连接。
// 安全: 仅 127.0.0.1/localhost; token 永不落盘/出服务端。
// 权限: 读 SSE 的循环不等待用户。用户点选后用同一 JSON-RPC id 另发 response。

import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  clearAllGatewayBindings,
  getAgentPreference,
  getInactivityTimeoutMs,
  getSession,
  patchAgentPreference,
  updateSessionGateway,
  workDirOf,
} from "./agent-session-store";
import { snubyLog } from "./snuby-log";

// —— 类型 ——
export type AgentCapabilities = {
  promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  loadSession?: boolean;
  multitaskSupport?: boolean;
  delegateToolsSupport?: boolean;
  mainAgentSupport?: boolean;
};

export type ModelInfo = {
  modelId: string;
  name: string;
  description?: string;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  /** 积分倍数, 如 "x0.21" (网关常放在 _meta.credits / description) */
  credits?: string;
  maxInputTokens?: number;
};

export type ConfigOptionInfo = {
  type?: string;
  id: string;
  name: string;
  description?: string;
  category?: string;
  currentValue?: string;
  options?: { value: string; name: string; description?: string; credits?: string }[];
};

/** 网关倍数文案: "x0.21" / "x1.20" */
function isCreditMultiplier(s?: string): s is string {
  return !!s && /^x\d+(\.\d+)?$/i.test(s.trim());
}

/** 网关 availableModels 常把 credits 放在 _meta, description 也是倍数; 展平给 UI */
function normalizeModelInfo(
  raw: ModelInfo & {
    _meta?: {
      credits?: string;
      supportsImages?: boolean;
      supportsReasoning?: boolean;
      maxInputTokens?: number;
    };
  },
): ModelInfo {
  const meta = raw._meta;
  const credits =
    raw.credits ||
    meta?.credits ||
    (isCreditMultiplier(raw.description) ? raw.description.trim() : undefined);
  return {
    modelId: raw.modelId,
    name: raw.name,
    description: raw.description,
    supportsImages: raw.supportsImages ?? meta?.supportsImages,
    supportsReasoning: raw.supportsReasoning ?? meta?.supportsReasoning,
    credits,
    maxInputTokens: raw.maxInputTokens ?? meta?.maxInputTokens,
  };
}

function modelsFromConfigOptions(
  options: { value: string; name: string; description?: string; credits?: string }[],
): ModelInfo[] {
  return options.map((opt) =>
    normalizeModelInfo({
      modelId: opt.value,
      name: opt.name || opt.value,
      description: opt.description,
      credits: opt.credits || (isCreditMultiplier(opt.description) ? opt.description.trim() : undefined),
    }),
  );
}

export type AgentStatus = {
  phase: "idle" | "discovering" | "connecting" | "connected" | "error";
  discovered?: {
    pid: number;
    port: number;
    sessionId: string;
    cwd: string;
    heartbeatMsAgo: number;
  };
  connectionIdMasked?: string;
  protocolVersion?: number;
  capabilities?: AgentCapabilities;
  authMethods?: string[];
  acpSessionId?: string;
  connectedAt?: number;
  lastError?: string | null;
  models?: ModelInfo[];
  sessionConfig?: Record<string, ConfigOptionInfo>;
  usage?: AgentUsage;
  /** 全局执行队列快照 (排队文案用) */
  queue?: { activeKey: string | null; pendingKeys: string[] };
};

/** 会话 Token / 费用用量 (网关 usage_update; used/size 常为 0, 真值在 _meta.usage) */
export type AgentUsage = {
  /** 上下文已用 (网关 used; 为 0 时用最近一轮 totalTokens 兜底展示) */
  used: number;
  /** 上下文窗口 (网关 size; 可能为 0) */
  size: number;
  lastPromptTokens?: number;
  lastCompletionTokens?: number;
  lastTotalTokens?: number;
  /** 本连接累计 total_tokens */
  sessionTotalTokens?: number;
  lastCost?: number;
  sessionCost?: number;
};

type SessionRecord = {
  pid: number;
  lastHeartbeat: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind?: string;
  updatedAt?: number;
};

/** 单个 ACP 连接的全部状态 (per 本地会话一个连接; token 仅内存) */
type ConnState = {
  key: string; // "default" 或 localSessionId
  base: string;
  connectionId: string;
  token: string;
  protocolVersion: number;
  capabilities: AgentCapabilities;
  authMethods: string[];
  activeSessionId: string | null;
  availableModels: ModelInfo[];
  sessionConfig: Record<string, ConfigOptionInfo>;
  usage: AgentUsage | null;
  lastUsedAt: number;
  /** 本连接上已取消的网关会话 (cancel 先于任务开始时标记, 任务进锁后据此放弃) */
  cancelledSids: Set<string>;
  /** 本连接内任务串行队列 (跨会话并行不受影响) */
  queueTail: Promise<unknown>;
  /** 是否正在执行任务 (运行中连接保活, 空闲回收跳过) */
  running: boolean;
};

const SESSIONS_DIR = path.join(os.homedir(), ".workbuddy", "sessions");
const HEARTBEAT_FRESH_MS = 60_000;
/** 连接空闲回收阈值: 会话切走后连接闲置超过该时长即释放, 下次按需重建 */
const RECLAIM_IDLE_MS = 10 * 60_000;

/** 内置兜底模型列表: 网关 config 拉取失败时保证面板可选 (ID 来自 WorkBuddy 配置实测) */
const FALLBACK_MODELS: ModelInfo[] = [
  { modelId: "fast-model", name: "快速" },
  { modelId: "balanced-model", name: "均衡" },
  { modelId: "deep-model", name: "极致" },
  { modelId: "hy4-preview-f", name: "Hy4 preview" },
  { modelId: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { modelId: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { modelId: "glm-5.2", name: "GLM-5.2" },
  { modelId: "kimi-k2.6", name: "Kimi K2.6" },
];

// —— 连接池 (key: "default" | localSessionId) ——
const conns = new Map<string, ConnState>();
/** 网关只挂一条连接。工具授权总线是进程级的, 多连接会互相拒绝。 */
const GATEWAY_KEY = "gateway";

function acpLog(line: string): void {
  snubyLog("acp", line);
}

/** prompt 正文 / 偶发长字段截断上限 */
const ACP_LOG_TEXT_MAX = 200;
/** 单行日志安全上限 */
const ACP_LOG_LINE_MAX = 8_000;

/**
 * 入站可跳过全文的高噪声 sessionUpdate:
 * - agent_message_chunk / agent_thought_chunk: 流式碎字
 * - tool_call_update: 工具入参/结果边拼边推, 单轮可达上千帧
 * - usage_update / session_info_update: 旁路噪音
 * - config_option_update: 常夹带完整模型 options 列表, 单行可达数十 KB;
 *   模型/权限变更看 pref/set_model/set_config 摘要即可, 不必打全文
 */
const ACP_LOG_SKIP_SESSION_UPDATES = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call_update",
  "usage_update",
  "session_info_update",
  "config_option_update",
]);

function clipLogText(s: string, max = ACP_LOG_TEXT_MAX): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(+${s.length - max})`;
}

/** config_option_update 压成一行摘要 (不含模型 options 列表) */
function summarizeConfigOptionUpdate(raw: unknown): string | null {
  const up = (raw as { params?: { update?: { sessionUpdate?: string; configOptions?: ConfigOptionInfo[] } } })
    ?.params?.update;
  if (up?.sessionUpdate !== "config_option_update" || !Array.isArray(up.configOptions)) return null;
  const parts = up.configOptions.map((o) => {
    const n = o.options?.length ?? 0;
    return n > 0 ? `${o.id}=${o.currentValue ?? "-"}(${n}opts)` : `${o.id}=${o.currentValue ?? "-"}`;
  });
  return `<< config_option_update ${parts.join(" ")}`;
}

/** tool_call 起手帧压成一行; tool_call_update 流式增量直接跳过 */
function summarizeToolCallUpdate(raw: unknown): string | null {
  const up = (
    raw as {
      params?: {
        update?: {
          sessionUpdate?: string;
          toolCallId?: string;
          status?: string;
          title?: string;
          kind?: string;
          _meta?: Record<string, unknown>;
          rawInput?: { url?: string; query?: string; prompt?: string };
        };
      };
    }
  )?.params?.update;
  if (up?.sessionUpdate !== "tool_call") return null;
  const name =
    (up._meta?.["codebuddy.ai/toolName"] as string | undefined) ||
    up.title ||
    up.kind ||
    "tool";
  const hint = up.rawInput?.url || up.rawInput?.query || up.rawInput?.prompt || "";
  const detail = hint ? ` detail=${clipLogText(hint, 80)}` : "";
  return `<< tool_call id=${up.toolCallId ?? "-"} name=${name} status=${up.status ?? "-"}${detail}`;
}

/** 入站高噪声帧的一行摘要; 无摘要则返回 null (再走 shouldLog / 全文) */
function summarizeInboundAcp(raw: unknown): string | null {
  return summarizeConfigOptionUpdate(raw) ?? summarizeToolCallUpdate(raw);
}

/** 入站是否值得落盘全文; config/tool_call 改打摘要 */
function shouldLogInboundAcp(raw: unknown): boolean {
  const r = raw as {
    error?: unknown;
    method?: string;
    result?: unknown;
    params?: { update?: { sessionUpdate?: string } };
  };
  if (r?.error) return true;
  if (r?.method === "session/request_permission") return true;
  if (r?.method && r.method !== "session/update") return true;
  const su = r?.params?.update?.sessionUpdate;
  if (typeof su === "string" && ACP_LOG_SKIP_SESSION_UPDATES.has(su)) return false;
  if (su === "tool_call") return false; // 走 summarizeToolCallUpdate
  // result (stopReason 等) / 其它 update 保留全文
  return true;
}

/**
 * 序列化 ACP 收发 JSON 供排障落盘。
 * - 出站 prompt 正文截到 200
 * - availableModels / configOptions[].options 只保留数量与当前值, 不打全表
 */
function formatAcpWireForLog(raw: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, keyHint = ""): unknown => {
    if (v == null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) {
      // 模型清单: 只记条数
      if (keyHint === "availableModels" || keyHint === "options") {
        return `[${v.length} items]`;
      }
      return v.map((x) => walk(x, keyHint));
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walk(val, k);
    }
    return out;
  };
  try {
    const root = raw as { method?: string; params?: { prompt?: unknown } };
    let shaped: unknown = raw;
    if (root?.method === "session/prompt" && root.params && Array.isArray(root.params.prompt)) {
      shaped = {
        ...root,
        params: {
          ...root.params,
          prompt: root.params.prompt.map((p) => {
            if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") {
              return { ...(p as object), text: clipLogText((p as { text: string }).text) };
            }
            return p;
          }),
        },
      };
    }
    const s = JSON.stringify(walk(shaped));
    return s.length > ACP_LOG_LINE_MAX ? `${s.slice(0, ACP_LOG_LINE_MAX)}…(+${s.length - ACP_LOG_LINE_MAX})` : s;
  } catch {
    return String(raw);
  }
}
let defaultKey: string | null = null;
let lastError: string | null = null;
let discovering = false;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** lsof 解析 pid 的 127.0.0.1 监听端口 (优先回环, 拒绝其他地址) */
function resolvePort(pid: number): number | null {
  try {
    const out = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`, {
      encoding: "utf8",
      timeout: 5000,
    });
    for (const line of out.split("\n")) {
      const m = line.match(/(127\.0\.0\.1|localhost):(\d+)/);
      if (m) return Number(m[2]);
    }
    // 无回环条目: 有 *:port 也不接受 (安全约束)
  } catch {
    // pid 已退出或 lsof 失败
  }
  return null;
}

/** 发现存活 WorkBuddy 网关: 进程存活 + 回环端口可解析; 按 heartbeat 新旧排序取最新 */
function discover(): AgentStatus["discovered"] | null {
  if (!fs.existsSync(SESSIONS_DIR)) return null;
  const entries: (SessionRecord & { heartbeatMsAgo: number })[] = [];
  for (const file of fs.readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), "utf8")) as SessionRecord;
      if (!rec || typeof rec.pid !== "number") continue;
      if (!processAlive(rec.pid)) continue;
      const port = resolvePort(rec.pid);
      if (!port) continue;
      entries.push({ ...rec, heartbeatMsAgo: Date.now() - rec.lastHeartbeat });
    } catch {
      // 跳过坏文件
    }
  }
  entries.sort((a, b) => a.heartbeatMsAgo - b.heartbeatMsAgo);
  if (entries.length === 0) return null;
  const best = entries[0];
  return {
    pid: best.pid,
    port: resolvePort(best.pid)!,
    sessionId: best.sessionId,
    cwd: best.cwd,
    heartbeatMsAgo: best.heartbeatMsAgo,
  };
}

/** 读 SSE。onData 返回的 Promise 不阻塞下一次 read。
 *  停读会让网关写不进权限请求, 或把本轮当成客户端已断开。 */
async function readSse(
  res: Response,
  onData: (json: unknown) => void | Promise<void>,
): Promise<void> {
  if (!res.body) throw new Error("网关无响应体");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let eventName = "";
  let dataLines: string[] = [];
  const flush = () => {
    if (eventName === "message" && dataLines.length > 0) {
      let json: unknown;
      try {
        json = JSON.parse(dataLines.join("\n"));
      } catch {
        eventName = "";
        dataLines = [];
        return;
      }
      eventName = "";
      dataLines = [];
      // 排障: 入站关键帧; 高噪声 sessionUpdate 只打摘要或跳过
      const summary = summarizeInboundAcp(json);
      if (summary) acpLog(summary);
      else if (shouldLogInboundAcp(json)) acpLog(`<< ${formatAcpWireForLog(json)}`);
      try {
        const ret = onData(json);
        if (ret && typeof (ret as Promise<void>).then === "function") {
          void (ret as Promise<void>).catch((e) => {
            acpLog(`sse handler error: ${(e as Error).message}`);
          });
        }
      } catch (e) {
        acpLog(`sse handler throw: ${(e as Error).message}`);
      }
      return;
    }
    eventName = "";
    dataLines = [];
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        flush();
      } else if (line.startsWith(":")) {
        // keepalive 注释 (:ok)
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  await flush();
}

async function acpPost(
  cs: ConnState,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  // 排障: 出站 ACP 全量落盘 (prompt 正文截断)
  acpLog(`>> ${formatAcpWireForLog(body)}`);
  return fetch(`${cs.base}/api/v1/acp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", // 必须同时含, 否则 -32000
      "acp-connection-id": cs.connectionId,
      Authorization: `Bearer ${cs.token}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/** 连接是否可能已失效 (错误信息匹配连接级故障) */
function isConnError(msg: string): boolean {
  return /fetch failed|ECONN|socket|超时|HTTP \d|connect/i.test(msg);
}

/** 更新连接活跃时间 + 顺带回收空闲连接 */
function touch(cs: ConnState): void {
  cs.lastUsedAt = Date.now();
  const now = Date.now();
  for (const [k, c] of conns) {
    if (k === defaultKey) continue;
    // 运行中的会话连接保活: 任务未结束不得回收, 保证「切走的任务继续跑」的物理前提
    if (c.running) continue;
    if (now - c.lastUsedAt > RECLAIM_IDLE_MS) {
      conns.delete(k);
    }
  }
}

/** 本连接内任务串行 (跨会话连接互相独立, 不阻塞并行) */
function withConnLock<T>(cs: ConnState, fn: () => Promise<T>): Promise<T> {
  const run = cs.queueTail.then(fn, fn);
  cs.queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 全局串行执行队列。
 * 实测网关为「单活动会话」模型: session/prompt 忽略 sessionId, 按网关活动会话路由;
 * 并发时活动会话漂移 → 后发任务的 load/new 抢占活动会话, 前任务后续执行混入 → 上下文串台。
 * 因此所有会话对齐(load/new)+执行(prompt/set*)必须全局串行, 任何时刻只操作一个网关会话。
 * 排队中的任务支持按 key 取消: token 标记 cancelled, 轮到时跳过并抛「任务已取消」。 */
interface QueueToken {
  cancelled: boolean;
}
const pendingTokens = new Map<string, QueueToken>();
let globalQueueTail: Promise<void> = Promise.resolve();
/** 当前持有全局锁的本地会话 key (running/aligning); 无则 null */
let globalQueueActiveKey: string | null = null;

function enqueueGlobal<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const token: QueueToken = { cancelled: false };
  return new Promise<T>((resolve, reject) => {
    const run = globalQueueTail.then(
      async () => {
        if (pendingTokens.get(key) === token) pendingTokens.delete(key);
        if (token.cancelled) throw new Error("任务已取消");
        globalQueueActiveKey = key;
        try {
          return await fn();
        } finally {
          if (globalQueueActiveKey === key) globalQueueActiveKey = null;
        }
      },
      async () => {
        if (pendingTokens.get(key) === token) pendingTokens.delete(key);
        if (token.cancelled) throw new Error("任务已取消");
        globalQueueActiveKey = key;
        try {
          return await fn();
        } finally {
          if (globalQueueActiveKey === key) globalQueueActiveKey = null;
        }
      },
    );
    globalQueueTail = run.then(
      () => undefined,
      () => undefined,
    );
    pendingTokens.set(key, token);
    run.then(resolve, reject);
  });
}

/** 取消排队中的任务 (标记其 token; 轮到时抛「任务已取消」)。返回是否取消了排队项 */
function cancelQueued(key: string): boolean {
  const t = pendingTokens.get(key);
  if (t) {
    t.cancelled = true;
    return true;
  }
  return false;
}

/** 供 activate / prompt 路由合并持锁: 对齐+执行必须在同一队列项内, 防止中间被他会话插队 */
export function withGlobalAgentLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return enqueueGlobal(key, fn);
}

/** 全局队列快照 (UI 排队文案: 前序会话) */
export function globalQueueSnapshot(): { activeKey: string | null; pendingKeys: string[] } {
  return {
    activeKey: globalQueueActiveKey,
    pendingKeys: [...pendingTokens.keys()],
  };
}

/** 本地会话是否占用队列或正在执行 (删除拦截用) */
export function isLocalSessionBusy(localSessionId: string): boolean {
  if (pendingTokens.has(localSessionId)) return true;
  if (globalQueueActiveKey === localSessionId) return true;
  const cs = conns.get(GATEWAY_KEY);
  return !!cs?.running && globalQueueActiveKey === localSessionId;
}

/**
 * 网关连接上最近完成逻辑上下文对齐的本地会话 id。
 * 切换本地会话后即使 session/load 成功也必须重注入 (见 agent-session-activate)。
 */
let lastLogicalLocalId: string | null = null;

export function resetLogicalSessionMarker(): void {
  if (lastLogicalLocalId) {
    acpLog(`logical marker reset was=${lastLogicalLocalId}`);
  }
  lastLogicalLocalId = null;
}

export function peekLogicalSessionMarker(): string | null {
  return lastLogicalLocalId;
}

export function markLogicalSessionAligned(id: string): void {
  const prev = lastLogicalLocalId;
  lastLogicalLocalId = id;
  if (prev !== id) {
    acpLog(`logical marker ${prev ?? "-"} -> ${id}`);
  }
}

/** 清空连接池与排队 (重连前调用); 返回重连前 running 的本地会话 id */
export function resetAgentConnections(): string[] {
  const interrupted = [...conns.entries()].filter(([, c]) => c.running).map(([k]) => k);
  for (const key of [...pendingTokens.keys()]) {
    cancelQueued(key);
  }
  pendingTokens.clear();
  conns.clear();
  defaultKey = null;
  globalQueueActiveKey = null;
  lastError = null;
  resetLogicalSessionMarker();
  // 网关会话不随 HTTP 连接迁移; 丢掉绑定, 下次发送 session/new + 全量注入
  try {
    clearAllGatewayBindings();
  } catch (e) {
    acpLog(`clearAllGatewayBindings failed: ${(e as Error).message}`);
  }
  return interrupted.filter((k) => k !== "default" && k !== GATEWAY_KEY);
}

function markCancelled(cs: ConnState, sid: string): void {
  cs.cancelledSids.add(sid);
}
function consumeCancelled(cs: ConnState, sid: string): boolean {
  return cs.cancelledSids.delete(sid);
}

/** 消费连接级历史回放: 挂载已运行会话时网关会重放其历史 (session/update 事件流)。
 * 打开 GET 订阅流吃掉回放, 保证后续 POST session/prompt 流是干净的新任务事件。
 * 读满 maxMs 即停 (回放毫秒级发完; 新会话无历史用短时长, load 恢复用稍长时长, 幂等)。 */
async function drainReplayOn(cs: ConnState, maxMs = 1200): Promise<void> {
  try {
    const res = await fetch(`${cs.base}/api/v1/acp`, {
      method: "GET",
      headers: {
        Accept: "application/json, text/event-stream",
        "acp-connection-id": cs.connectionId,
        Authorization: `Bearer ${cs.token}`,
      },
      signal: AbortSignal.timeout(maxMs),
    });
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
    } catch {
      // 超时/中断: 停止消费, 已吃掉能收到的部分
    }
  } catch {
    // 无回放或 GET 不可用: 跳过
  }
}

/** session/new: 在本连接上开独立新会话 (cwd 默认 /tmp) */
async function ensureSessionOn(cs: ConnState, cwd?: string, opts: { force?: boolean } = {}): Promise<string> {
  if (cs.activeSessionId && !opts.force) return cs.activeSessionId;
  const res = await acpPost(cs, {
    jsonrpc: "2.0",
    id: 2,
    method: "session/new",
    params: { cwd: cwd ?? "/tmp", mcpServers: [] },
  });
  const result = await new Promise<{ sessionId?: string; models?: { availableModels?: ModelInfo[] } } | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("session/new 超时")), 15000);
    readSse(res, (json) => {
      const r = json as {
        result?: { sessionId?: string; models?: { availableModels?: ModelInfo[] } };
        error?: { code?: string | number; message?: string };
        method?: string;
        params?: { update?: Record<string, unknown> };
      };
      if (r?.error) {
        clearTimeout(timer);
        reject(new Error(`session/new RPC error: ${r.error.code} ${r.error.message}`));
      } else if (r?.method === "session/update" && r.params?.update) {
        // 实测: session/new 流内会先推 config_option_update (权限/模型/思考/沙箱) 与 usage_update
        const up = r.params.update as { sessionUpdate?: string; configOptions?: ConfigOptionInfo[]; used?: number; size?: number };
        if (up.sessionUpdate === "config_option_update" && Array.isArray(up.configOptions)) {
          for (const o of up.configOptions) {
            cs.sessionConfig[o.id] = o;
            // 新网关: 模型清单在 model 配置的 options 里 (result.models 已不再返回)
            if (o.id === "model" && Array.isArray(o.options)) {
              cs.availableModels = modelsFromConfigOptions(o.options);
            }
          }
        } else if (up.sessionUpdate === "usage_update") {
          applyUsageUpdate(cs, up as Record<string, unknown>);
        }
      } else if (r?.result?.sessionId) {
        // 实测: result 直接带 models.availableModels (模型清单)
        if (Array.isArray(r.result.models?.availableModels)) {
          cs.availableModels = r.result.models!.availableModels!.map(normalizeModelInfo);
        }
        clearTimeout(timer);
        resolve(r.result);
      }
    }).catch(reject);
  }).catch((e: Error) => {
    cs.activeSessionId = null;
    throw new Error(`session/new: ${e.message}`);
  });
  if (!result?.sessionId) throw new Error("session/new 未返回 sessionId");
  cs.activeSessionId = result.sessionId;
  acpLog(`session/new ok sid=${result.sessionId} cwd=${cwd ?? "/tmp"} force=${!!opts.force}`);
  // session/new 挂载会话后, 网关会把历史回放推给首个流通道;
  // 先开 GET 订阅吃掉回放, 保证后续 prompt 流干净 (新会话无历史, 400ms 足够)
  await drainReplayOn(cs, 400);
  await applyAgentPreferencesOn(cs, cs.activeSessionId);
  return cs.activeSessionId;
}

/** 把全局偏好 (模型/权限模式/思考深度/沙箱) 应用到当前网关会话 */
async function applyAgentPreferencesOn(cs: ConnState, sessionId: string): Promise<void> {
  const prefer = getAgentPreference();
  if (!prefer) return;
  try {
    if (prefer.modelId) {
      const cur = cs.sessionConfig.model?.currentValue;
      if (cur !== prefer.modelId) {
        await acpCall(cs, "session/set_model", { sessionId, model: prefer.modelId }, 11);
        if (cs.sessionConfig.model) cs.sessionConfig.model.currentValue = prefer.modelId;
        else {
          cs.sessionConfig.model = {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: prefer.modelId,
          };
        }
        acpLog(`pref model ${cur ?? "-"} -> ${prefer.modelId} (session=${sessionId.slice(0, 8)})`);
      }
    }
    const cfg = prefer.config ?? {};
    for (const id of ["mode", "thought_level", "sandbox"] as const) {
      const value = cfg[id];
      if (!value) continue;
      const cur = cs.sessionConfig[id]?.currentValue;
      if (cur === value) continue;
      const { configOptions } = await acpCall(
        cs,
        "session/set_config_option",
        { sessionId, configId: id, value },
        12,
      );
      if (Array.isArray(configOptions)) {
        for (const o of configOptions) cs.sessionConfig[o.id] = o;
      }
      if (cs.sessionConfig[id]) cs.sessionConfig[id]!.currentValue = value;
      acpLog(`pref ${id} ${cur ?? "-"} -> ${value}`);
    }
  } catch (e) {
    acpLog(`applyAgentPreferences failed: ${(e as Error).message}`);
  }
}

/** session/load: 恢复既有网关会话上下文 (实测需 cwd+mcpServers; 成功返回含 models 的 result)。
 *  返回 null 表示网关拒绝/作废, 调用方应重建新会话。 */
async function loadSessionOn(cs: ConnState, sessionId: string, cwd?: string): Promise<string | null> {
  const res = await acpPost(cs, {
    jsonrpc: "2.0",
    id: 3,
    method: "session/load",
    params: { sessionId, cwd: cwd ?? "/tmp", mcpServers: [] },
  });
  if (!res.ok) {
    lastError = `session/load HTTP ${res.status}`;
    acpLog(`session/load fail sid=${sessionId} http=${res.status}`);
    return null;
  }
  const result = await new Promise<{ sessionId?: string; models?: { availableModels?: ModelInfo[] } } | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("session/load 超时")), 12000);
    readSse(res, (json) => {
      const r = json as {
        result?: { sessionId?: string; models?: { availableModels?: ModelInfo[] } };
        error?: { code?: string | number; message?: string };
        method?: string;
        params?: { update?: Record<string, unknown> };
      };
      if (r?.error) {
        clearTimeout(timer);
        reject(new Error(`session/load RPC error: ${r.error.code} ${r.error.message}`));
      } else if (r?.method === "session/update" && r.params?.update) {
        const up = r.params.update as { sessionUpdate?: string; configOptions?: ConfigOptionInfo[]; used?: number; size?: number };
        if (up.sessionUpdate === "config_option_update" && Array.isArray(up.configOptions)) {
          for (const o of up.configOptions) {
            cs.sessionConfig[o.id] = o;
            // 新网关: 模型清单在 model 配置的 options 里 (result.models 已不再返回)
            if (o.id === "model" && Array.isArray(o.options)) {
              cs.availableModels = modelsFromConfigOptions(o.options);
            }
          }
        } else if (up.sessionUpdate === "usage_update") {
          applyUsageUpdate(cs, up as Record<string, unknown>);
        }
      } else if (r?.result) {
        // 实测: load 成功 result 直接含 models.availableModels
        if (Array.isArray(r.result.models?.availableModels)) {
          cs.availableModels = r.result.models!.availableModels!.map(normalizeModelInfo);
        }
        clearTimeout(timer);
        resolve(r.result);
      }
    }).catch(reject);
  }).catch((e: Error) => {
    lastError = `session/load: ${e.message}`;
    return null;
  });
  if (!result) {
    acpLog(`session/load miss sid=${sessionId}`);
    return null;
  }
  cs.activeSessionId = sessionId;
  acpLog(`session/load ok sid=${sessionId} cwd=${cwd ?? "/tmp"}`);
  // load 恢复后同样吃掉网关历史回放 (恢复历史可能持续数百 ms, 用 1200ms 上限)
  await drainReplayOn(cs, 1200);
  await applyAgentPreferencesOn(cs, sessionId);
  return sessionId;
}

/** 把网关会话对齐到指定本地会话: 有 acpSessionId → load 恢复 (失败则新建);
 *  无 → session/new 新建。返回当前网关会话 id。 (在本连接上操作) */
async function ensureSessionForOn(cs: ConnState, acpSid?: string, cwd?: string): Promise<string> {
  if (acpSid) {
    if (acpSid === cs.activeSessionId) return acpSid;
    const loaded = await loadSessionOn(cs, acpSid, cwd);
    if (loaded) return loaded;
    // 网关拒绝/作废: 重建新会话
    cs.activeSessionId = null;
    return ensureSessionOn(cs, cwd, { force: true });
  }
  // 本地会话无绑定: 必须新建独立网关会话 (即使当前已有别的会话), 保证上下文隔离
  cs.activeSessionId = null;
  return ensureSessionOn(cs, cwd, { force: true });
}

/** 补偿拉取网关会话配置 (sessionConfig/availableModels)。
 *  网关仅对「新连接后首次 session/new」推送 config_option_update;
 *  用一次性 text() 解析拉 options 清单。注意: 探测用的 session/new 会抢走网关活动会话
 *  并把默认 currentValue (如 fast-model/快速) 写进缓存 — 必须恢复活动会话并重新套用偏好,
 *  否则 UI 显示「快速」而日志里刚写过 pref model -> deepseek…。 */
async function refreshConfigOn(cs: ConnState): Promise<void> {
  const resumeSid = cs.activeSessionId;
  const prefer = getAgentPreference();
  const preserved: Record<string, string> = {};
  for (const [id, o] of Object.entries(cs.sessionConfig)) {
    if (o?.currentValue) preserved[id] = o.currentValue;
  }
  if (prefer?.modelId) preserved.model = prefer.modelId;
  if (prefer?.config) {
    for (const [id, v] of Object.entries(prefer.config)) {
      if (v) preserved[id] = v;
    }
  }
  try {
    const res = await acpPost(cs, {
      jsonrpc: "2.0",
      id: 99,
      method: "session/new",
      params: { cwd: "/tmp", mcpServers: [] },
    });
    const text = await res.text();
    for (const l of text.split("\n").filter((x) => x.startsWith("data:"))) {
      try {
        const d = JSON.parse(l.slice(5)) as {
          params?: { update?: { sessionUpdate?: string; configOptions?: ConfigOptionInfo[] } };
        };
        if (d.params?.update?.sessionUpdate === "config_option_update" && Array.isArray(d.params.update.configOptions)) {
          for (const o of d.params.update.configOptions) {
            const prev = cs.sessionConfig[o.id];
            // 合并 options 清单, 但 currentValue 优先保留偏好/探测前的值
            const keep = preserved[o.id] ?? prev?.currentValue;
            cs.sessionConfig[o.id] = keep ? { ...o, currentValue: keep } : o;
            if (o.id === "model" && Array.isArray(o.options)) {
              cs.availableModels = modelsFromConfigOptions(o.options);
            }
          }
        }
      } catch {
        // 坏行忽略
      }
    }
    acpLog(
      `refreshConfig merged options modelCur=${cs.sessionConfig.model?.currentValue ?? "-"} resume=${resumeSid?.slice(0, 8) ?? "-"}`,
    );
  } catch (e) {
    acpLog(`refreshConfig failed: ${(e as Error).message}`);
  }
  // 探测 session/new 会改变网关活动会话; 切回原会话并强制套用偏好
  if (resumeSid) {
    const loaded = await loadSessionOn(cs, resumeSid);
    if (!loaded) {
      acpLog(`refreshConfig resume load miss sid=${resumeSid.slice(0, 8)}; prefs on probe session`);
      if (cs.activeSessionId) await applyAgentPreferencesOn(cs, cs.activeSessionId);
    }
  } else if (cs.activeSessionId) {
    await applyAgentPreferencesOn(cs, cs.activeSessionId);
  }
}

/** 本机回环免 token。关掉一条网关 HTTP 连接, 其 Agent 才会从授权总线上摘掉。 */
async function closeGatewayConnection(base: string, connectionId: string): Promise<void> {
  try {
    const res = await fetch(`${base}/api/v1/acp`, {
      method: "DELETE",
      headers: {
        "acp-connection-id": connectionId,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(3000),
    });
    acpLog(`DELETE connection ${connectionId} -> ${res.status}`);
  } catch (e) {
    acpLog(`DELETE connection ${connectionId} failed: ${(e as Error).message}`);
  }
}

/** 从网关日志收集仍未 revoke 的 connectionId。多出来的 Agent 会在授权时互相拒绝。 */
function leftoverGatewayConnectionIds(): string[] {
  const root = path.join(os.homedir(), ".workbuddy", "logs");
  if (!fs.existsSync(root)) return [];
  let newest: { file: string; mtime: number } | null = null;
  let days: string[] = [];
  try {
    days = fs.readdirSync(root);
  } catch {
    return [];
  }
  for (const day of days) {
    const dir = path.join(root, day);
    let names: string[] = [];
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("__workbuddy_cli_host__") || !name.endsWith(".log")) continue;
      const file = path.join(dir, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (!newest || mtime > newest.mtime) newest = { file, mtime };
    }
  }
  if (!newest) return [];
  let text = "";
  try {
    text = fs.readFileSync(newest.file, "utf8");
  } catch {
    return [];
  }
  const issued = new Set<string>();
  const revoked = new Set<string>();
  for (const m of text.matchAll(/Token issued for connectionId=([0-9a-f-]{36})/g)) issued.add(m[1]);
  for (const m of text.matchAll(/Token revoked for connectionId=([0-9a-f-]{36})/g)) revoked.add(m[1]);
  return [...issued].filter((id) => !revoked.has(id));
}

async function closeLeftoverGatewayConnections(base: string): Promise<number> {
  const ids = leftoverGatewayConnectionIds();
  for (const id of ids) await closeGatewayConnection(base, id);
  return ids.length;
}

/** 建连核心: discover + connect + initialize; 返回新连接状态 */
async function connectCore(key: string): Promise<ConnState> {
  const d = discover();
  if (!d) throw new Error("未发现存活 WorkBuddy 网关 (检查 ~/.workbuddy/sessions 与进程)");
  const base = `http://127.0.0.1:${d.port}`;
  const closed = await closeLeftoverGatewayConnections(base);
  acpLog(`closed ${closed} leftover connections before connect`);
  const res = await fetch(`${base}/api/v1/acp/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`connect 失败: HTTP ${res.status} (port ${d.port}, pid ${d.pid})`);
  const cj = (await res.json()) as { connectionId?: string; sessionToken?: string };
  if (!cj.connectionId || !cj.sessionToken) {
    throw new Error(`connect 响应缺字段: ${JSON.stringify(Object.keys(cj))} (port ${d.port})`);
  }
  const cs: ConnState = {
    key,
    base,
    connectionId: cj.connectionId,
    token: cj.sessionToken,
    protocolVersion: 0,
    capabilities: {},
    authMethods: [],
    activeSessionId: null,
    availableModels: [],
    sessionConfig: {},
    usage: null,
    lastUsedAt: Date.now(),
    cancelledSids: new Set(),
    queueTail: Promise.resolve(),
    running: false,
  };
  // initialize (SSE 流)
  const init = await acpPost(cs, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    },
  });
  if (!init.ok) throw new Error(`initialize 失败: HTTP ${init.status} (port ${d.port})`);
  const initResult = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("initialize 超时")), 8000);
    readSse(init, (json) => {
      const r = json as { result?: Record<string, unknown>; error?: { code?: string | number; message?: string } };
      if (r?.error) {
        clearTimeout(timer);
        reject(new Error(`initialize RPC error: ${r.error.code} ${r.error.message}`));
      } else if (r?.result) {
        clearTimeout(timer);
        resolve(r.result);
      }
    }).catch(reject);
  }).catch((e: Error) => {
    throw new Error(`initialize: ${e.message} (port ${d.port}, pid ${d.pid})`);
  });
  const r = initResult as { protocolVersion?: number; agentCapabilities?: AgentCapabilities; authMethods?: { id: string; name?: string }[] };
  cs.protocolVersion = r.protocolVersion ?? 1;
  cs.capabilities = r.agentCapabilities ?? {};
  cs.authMethods = (r.authMethods ?? []).map((a) => a.id);
  conns.set(GATEWAY_KEY, cs);
  if (!defaultKey) defaultKey = GATEWAY_KEY;
  acpLog(`connected ${cs.connectionId} port ${d.port} as ${key}`);
  return cs;
}

/** 全部本地会话共用一条网关连接。key 只用于兼容旧调用。 */
async function getConnFor(_key: string): Promise<ConnState> {
  const existing = conns.get(GATEWAY_KEY);
  if (existing) {
    touch(existing);
    return existing;
  }
  const cs = await connectCore(GATEWAY_KEY);
  touch(cs);
  return cs;
}

/** 对齐网关会话 (不加全局锁; 调用方须已持 withGlobalAgentLock / enqueueGlobal) */
export async function alignLocalSession(
  localSessionId: string,
  acpSid?: string,
  cwd?: string,
): Promise<string> {
  const cs = await getConnFor(localSessionId);
  return withConnLock(cs, async () => {
    const cur = conns.get(localSessionId) ?? cs;
    return ensureSessionForOn(cur, acpSid, cwd);
  });
}

/** 为指定本地会话对齐网关会话 (全局串行); 返回网关会话 id */
export async function ensureSessionFor(localSessionId: string, acpSid?: string, cwd?: string): Promise<string> {
  return enqueueGlobal(localSessionId, () => alignLocalSession(localSessionId, acpSid, cwd));
}

/** Step 1: 建连。默认连接会先 resetAgentConnections (重连失效全部绑定), 再 discover+connect+initialize。
 *  返回 status; interruptedLocalIds 为重连前 running 的本地会话 (供前端标 interrupted)。 */
export async function connect(key?: string): Promise<AgentStatus & { interruptedLocalIds?: string[] }> {
  lastError = null;
  discovering = true;
  const k = key ?? "default";
  let interruptedLocalIds: string[] = [];
  try {
    if (k === "default") {
      const prev = conns.get(GATEWAY_KEY);
      if (prev) await closeGatewayConnection(prev.base, prev.connectionId);
      // 重连 = 连接级重置: 丢弃内存中的 token/排队 (spec 017 §11)
      interruptedLocalIds = resetAgentConnections();
      await enqueueGlobal(k, async () => {
        const cs = await getConnFor(k);
        try {
          await ensureSessionOn(cs);
          lastError = null;
        } catch (e) {
          lastError = `会话创建失败: ${(e as Error).message}`;
        }
        await refreshConfigOn(cs);
      });
    } else {
      await getConnFor(k);
    }
    defaultKey = k;
    return { ...status(k), interruptedLocalIds };
  } catch (e) {
    lastError = `建连异常: ${(e as Error).message}`;
    return {
      phase: "error",
      lastError,
      discovered: discover() ?? undefined,
      interruptedLocalIds,
    };
  } finally {
    discovering = false;
  }
}

/** 当前状态快照 (绝不含 token); 指定 localSessionId 时返回该会话连接的快照 */
export function status(key?: string): AgentStatus {
  const k = key && key !== "default" ? key : (defaultKey ?? "");
  const cs = (k && conns.get(k)) ?? (conns.size ? conns.values().next().value : undefined);
  const queue = globalQueueSnapshot();
  if (!cs) {
    const d = discover();
    return {
      phase: discovering ? "discovering" : "idle",
      discovered: d ?? undefined,
      lastError: lastError ?? undefined,
      queue,
    };
  }
  touch(cs);
  const d = discover();
  return {
    phase: "connected",
    discovered: d ?? undefined,
    connectionIdMasked: `${cs.connectionId.slice(0, 8)}…${cs.connectionId.slice(-4)}`,
    protocolVersion: cs.protocolVersion,
    capabilities: cs.capabilities,
    authMethods: cs.authMethods,
    acpSessionId: cs.activeSessionId ?? undefined,
    connectedAt: Date.now(),
    models: (cs.availableModels.length
      ? cs.availableModels
      : Object.values(cs.sessionConfig)
          .find((o) => o.id === "model" && Array.isArray(o.options))
          ?.options?.map((opt) => ({
            modelId: opt.value,
            name: opt.name || opt.value,
            description: opt.description,
            credits: opt.credits,
          })) ?? FALLBACK_MODELS
    ).map(normalizeModelInfo),
    sessionConfig: cs.sessionConfig,
    usage: cs.usage ?? undefined,
    queue,
  };
}

/** 确保已有可用连接 (未连时建默认连接) */
export async function ensureConnected(): Promise<AgentStatus> {
  if (!conns.has(defaultKey ?? "default")) {
    const st = await connect();
    if (st.phase !== "connected") throw new Error(st.lastError ?? "连接失败");
  }
  return status();
}

export type PermissionOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type PromptEvent =
  | { type: "chunk"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool"; tool: string; state: string; detail?: string; toolCallId?: string }
  | {
      type: "permission";
      requestId: string | number;
      toolTitle: string;
      toolCallId?: string;
      /** 用户可读的操作摘要, 如命令/URL/路径 */
      detail?: string;
      options: PermissionOption[];
    }
  | { type: "usage"; usage: AgentUsage }
  | { type: "done"; stopReason?: string; id?: unknown };

/** 解析网关 usage_update: top-level used/size 实测常为 0, 真值在 _meta.usage */
function applyUsageUpdate(cs: ConnState, up: Record<string, unknown>): AgentUsage {
  const metaRoot = (up._meta && typeof up._meta === "object" ? up._meta : null) as Record<string, unknown> | null;
  const metaUsage = (metaRoot?.usage && typeof metaRoot.usage === "object" ? metaRoot.usage : null) as
    | Record<string, unknown>
    | null;
  const promptTokens = typeof metaUsage?.prompt_tokens === "number" ? metaUsage.prompt_tokens : undefined;
  const completionTokens =
    typeof metaUsage?.completion_tokens === "number" ? metaUsage.completion_tokens : undefined;
  const totalTokens =
    typeof metaUsage?.total_tokens === "number"
      ? metaUsage.total_tokens
      : promptTokens != null || completionTokens != null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined;
  // 只取顶层 cost.amount (上下文费用); 不用 _meta.usage.credit
  const costObj = up.cost && typeof up.cost === "object" ? (up.cost as Record<string, unknown>) : null;
  const cost = typeof costObj?.amount === "number" ? costObj.amount : undefined;
  const topUsed = typeof up.used === "number" ? up.used : 0;
  const topSize = typeof up.size === "number" ? up.size : 0;
  const prev = cs.usage;
  const next: AgentUsage = {
    used: topUsed > 0 ? topUsed : (totalTokens ?? prev?.used ?? 0),
    size: topSize > 0 ? topSize : (prev?.size ?? 0),
    lastPromptTokens: promptTokens ?? prev?.lastPromptTokens,
    lastCompletionTokens: completionTokens ?? prev?.lastCompletionTokens,
    lastTotalTokens: totalTokens ?? prev?.lastTotalTokens,
    sessionTotalTokens: (prev?.sessionTotalTokens ?? 0) + (totalTokens ?? 0),
    lastCost: cost ?? prev?.lastCost,
    sessionCost: (prev?.sessionCost ?? 0) + (typeof cost === "number" ? cost : 0),
  };
  cs.usage = next;
  return next;
}

/** 当前权限模式是否应自动放行该工具 (bypass 全放; acceptEdits 仅编辑类) */
function shouldAutoAllowByMode(cs: ConnState, toolTitle: string): boolean {
  const mode = cs.sessionConfig.mode?.currentValue ?? "";
  if (/bypass/i.test(mode)) return true;
  if (/acceptEdits|accept_edits|accept-edits/i.test(mode)) {
    return /^(Write|Edit|MultiEdit|NotebookEdit|create_file|edit_file)/i.test(toolTitle.trim()) ||
      /write|edit|写入|编辑/i.test(toolTitle);
  }
  return false;
}

type PermissionDecision =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

type PendingPermission = {
  cs: ConnState;
  localSessionId: string;
  requestId: string | number;
  toolTitle: string;
  toolCallId?: string;
  detail?: string;
  options: PermissionOption[];
  timer: ReturnType<typeof setTimeout>;
  /** SSE 侧 await 此 Promise, 直到前端应答或超时 */
  wait: Promise<void>;
  resolveWait: () => void;
  settled: boolean;
};

/** 从网关 rawInput 抽出用户能看懂的操作摘要 */
function permissionDetailFromRaw(raw: unknown, toolTitle: string): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const command = pick("command", "cmd", "script");
  if (command) return command.length > 400 ? `${command.slice(0, 400)}…` : command;
  const url = pick("url", "uri", "href");
  if (url) return url;
  const filePath = pick("path", "file_path", "filePath", "target", "filename");
  if (filePath) return filePath;
  const query = pick("query", "prompt", "pattern", "content");
  if (query) return query.length > 280 ? `${query.slice(0, 280)}…` : query;
  // 兜底: 取第一个短字符串字段
  for (const v of Object.values(o)) {
    if (typeof v === "string" && v.trim() && v.length < 300) return v.trim();
  }
  return toolTitle && toolTitle !== "工具请求权限" ? "" : "";
}

/** 等待前端应答的权限请求: key = `${localSessionId}::${requestId}`
 *  挂 globalThis, 避免 Next 路由分包导致 Map 实例不一致。 */
const PERMISSION_TIMEOUT_MS = 120_000;
type PermGlobal = { __snubyPendingPermissions?: Map<string, PendingPermission> };
function pendingPermissions(): Map<string, PendingPermission> {
  const g = globalThis as unknown as PermGlobal;
  if (!g.__snubyPendingPermissions) g.__snubyPendingPermissions = new Map();
  return g.__snubyPendingPermissions;
}

function permissionKey(localSessionId: string, requestId: string | number): string {
  return `${localSessionId}::${String(requestId)}`;
}

function pickAutoAllowOption(options: PermissionOption[]): string | null {
  const allowAlways = options.find((o) => /allow_always|allow-always/i.test(o.kind ?? "") || /always/i.test(o.optionId));
  if (allowAlways) return allowAlways.optionId;
  const allowOnce = options.find(
    (o) => /allow_once|allow-once|allow/i.test(o.kind ?? "") || /^allow/i.test(o.optionId) || /允许|同意/.test(o.name),
  );
  if (allowOnce) return allowOnce.optionId;
  return options[0]?.optionId ?? null;
}

async function sendPermissionResult(
  cs: ConnState,
  requestId: string | number,
  decision: PermissionDecision,
): Promise<void> {
  const result =
    decision.outcome === "cancelled"
      ? { outcome: { outcome: "cancelled" as const } }
      : { outcome: { outcome: "selected" as const, optionId: decision.optionId } };
  try {
    // 应答是 JSON-RPC response (无 method); 网关对纯 response 回 202 并 enqueue
    const payload = { jsonrpc: "2.0", id: requestId, result };
    const res = await acpPost(cs, payload);
    const body = await res.text().catch(() => "");
    acpLog(
      `permission answer rpc=${String(requestId)} outcome=${decision.outcome} option=${"optionId" in decision ? decision.optionId : ""} http=${res.status} body=${body.slice(0, 180)}`,
    );
  } catch (e) {
    acpLog(`permission answer failed rpc=${String(requestId)}: ${(e as Error).message}`);
  }
}

function settlePermission(p: PendingPermission): void {
  if (p.settled) return;
  p.settled = true;
  clearTimeout(p.timer);
  p.resolveWait();
}

/** 登记权限请求并返回 wait Promise; 超时自动回 cancelled 并放行 SSE */
function armPermissionWait(
  cs: ConnState,
  localSessionId: string,
  requestId: string | number,
  meta: { toolTitle: string; toolCallId?: string; detail?: string; options: PermissionOption[] },
): Promise<void> {
  const map = pendingPermissions();
  const key = permissionKey(localSessionId, requestId);
  const prev = map.get(key);
  if (prev) {
    settlePermission(prev);
    map.delete(key);
  }
  let resolveWait: () => void = () => {};
  const wait = new Promise<void>((r) => {
    resolveWait = r;
  });
  const pending: PendingPermission = {
    cs,
    localSessionId,
    requestId,
    toolTitle: meta.toolTitle,
    toolCallId: meta.toolCallId,
    detail: meta.detail,
    options: meta.options,
    timer: setTimeout(() => {
      const cur = map.get(key);
      if (!cur || cur.settled) return;
      map.delete(key);
      acpLog(
        `permission timeout local=${localSessionId} rpc=${String(requestId)} tool=${meta.toolTitle} after=${PERMISSION_TIMEOUT_MS}ms`,
      );
      void sendPermissionResult(cur.cs, cur.requestId, { outcome: "cancelled" }).finally(() => {
        settlePermission(cur);
      });
    }, PERMISSION_TIMEOUT_MS),
    wait,
    resolveWait,
    settled: false,
  };
  map.set(key, pending);
  return wait;
}

/** 供前端轮询: NDJSON 在阻塞等待时可能迟迟刷不出去 */
export function listPendingPermissions(localSessionId: string): Array<{
  requestId: string | number;
  toolTitle: string;
  toolCallId?: string;
  detail?: string;
  options: PermissionOption[];
}> {
  return [...pendingPermissions().values()]
    .filter((p) => p.localSessionId === localSessionId && !p.settled)
    .map((p) => ({
      requestId: p.requestId,
      toolTitle: p.toolTitle,
      toolCallId: p.toolCallId,
      detail: p.detail,
      options: p.options,
    }));
}

/** 前端应答权限: 选中 optionId 或取消 */
export async function respondPermission(
  localSessionId: string,
  requestId: string | number,
  decision: PermissionDecision,
): Promise<boolean> {
  const map = pendingPermissions();
  const key = permissionKey(localSessionId, requestId);
  const pending = map.get(key);
  if (!pending || pending.settled) {
    acpLog(
      `permission respond miss local=${localSessionId} rpc=${String(requestId)} settled=${!!pending?.settled}`,
    );
    return false;
  }
  map.delete(key);
  try {
    await sendPermissionResult(pending.cs, pending.requestId, decision);
  } finally {
    settlePermission(pending);
  }
  return true;
}

/** 取消某本地会话上所有未决权限 (任务停止时) */
function cancelPendingPermissions(localSessionId: string): void {
  const map = pendingPermissions();
  for (const [key, p] of [...map]) {
    if (p.localSessionId !== localSessionId && localSessionId !== "*") continue;
    map.delete(key);
    void sendPermissionResult(p.cs, p.requestId, { outcome: "cancelled" }).finally(() => {
      settlePermission(p);
    });
  }
}

/**
 * 拼接会话初始化文本: 工作约定 + 工作区边界 + 可选历史/产物清单。
 * 故意不指向 messages.jsonl: 实测 Agent 会去 Read 该文件然后卡住无输出。
 * 网关 session/new 的 cwd 无效 (进程 cwd 常是 WorkBuddy 临时目录), 必须以绝对路径约定为准。
 */
export function buildSessionSetupText(
  systemPrompt: string,
  workDir: string,
  opts?: {
    recentHistory?: string;
    artifacts?: { name: string; size: number }[];
    sessionId?: string;
    /** standalone=单独注入轮(仅回复已就绪); prefix=拼进用户首条请求(直接办事) */
    mode?: "standalone" | "prefix";
  },
): string {
  const recentHistory = typeof opts === "string" ? opts : opts?.recentHistory;
  const artifacts = typeof opts === "string" ? undefined : opts?.artifacts;
  const sessionId = typeof opts === "string" ? undefined : opts?.sessionId;
  const mode = (typeof opts === "string" ? "standalone" : opts?.mode) ?? "standalone";
  const histBlock = recentHistory?.trim()
    ? `\n本会话近期对话摘录（已内联，这就是你们刚才聊过的内容；勿再去读任何内部日志文件）：\n${recentHistory.trim()}\n`
    : "\n本会话近期尚无对话摘录。\n";
  const artLines =
    artifacts && artifacts.length > 0
      ? artifacts
          .slice(0, 40)
          .map((a) => `- ${workDir}/artifacts/${a.name} (${a.size} bytes)`)
          .join("\n")
      : "- （产物目录目前为空）";
  const sidLine = sessionId ? `- 本地逻辑会话 id = ${sessionId}\n` : "";
  const head =
    mode === "prefix"
      ? `【工作约定 · 请记住以下边界，然后直接处理文末的用户请求；勿单独回复「已就绪」】`
      : `【工作约定 · 请仅记住，无需执行任何操作，也不要回复确认】`;
  const tail =
    mode === "prefix"
      ? `- 新建的文件产物必须写入 ${workDir}/artifacts/（不存在则创建）。\n- 以上是工作边界；请据此处理下面的用户请求，直接开始工作，不要先确认约定。\n- 若要用 shell 查看文件：请先 \`cd ${workDir}\` 或对产物使用绝对路径；切勿只信 \`pwd\`（它常指向空的临时目录）。`
      : `- 新建的文件产物必须写入 ${workDir}/artifacts/（不存在则创建）。\n- 以上内容仅用于记录：请勿执行任何操作、勿读取文件、勿向用户确认；如果你已理解，请只回复「已就绪」三个字并结束本轮。`;
  return `${head}

本会话是一个独立工作会话，与 WorkBuddy 里其他任何项目、工作区、空间都没有关系（例如 OneDockAgentConnector、weimei-crm 等一律与本会话无关）：
${sidLine}- 本会话的工作目录 = ${workDir}（唯一授权工作区；shell 的 pwd / WorkBuddy 临时目录都不是本会话工作区）
- 本会话的产物目录 = ${workDir}/artifacts/（新建文件必须写在这里）
- 进程当前目录经常是 /var/folders/.../workbuddy-host-cli/... 这类临时路径且可能为空，这不代表本会话没有文件；请忽略它
- 读写文件一律使用上面的绝对路径；列目录请用 \`ls ${workDir}/artifacts\` 而非 \`ls\`/\`pwd\`
- 严禁用 Read/Write 打开或修改应用内部存储（任何路径含 agent-sessions、messages.jsonl、meta.json 的文件都不是给你用的）

本会话已有产物文件（请直接使用这些绝对路径）：
${artLines}

请忽略与本会话无关的任何先前上下文：其他项目的工作目录、记忆、约定、产物都不属于本会话。所有工作一律以本会话工作目录 ${workDir} 为基准。严禁读写本会话工作目录以外的任何路径。
${histBlock}
${systemPrompt}

${tail}`;
}

/** 短工作区提醒: 同会话连续发送、跳过全量注入时仍拼进 prompt */
export function buildWorkDirReminder(
  workDir: string,
  artifacts?: { name: string; size?: number }[],
): string {
  const names =
    artifacts && artifacts.length > 0
      ? artifacts
          .slice(0, 24)
          .map((a) => `${workDir}/artifacts/${a.name}`)
          .join("\n- ")
      : "（产物目录目前为空）";
  return `【工作区提醒 · 必读】
本会话工作目录 = ${workDir}
产物目录 = ${workDir}/artifacts/
已有产物：
- ${names}
进程 pwd 若是 /var/folders 或 workbuddy 临时路径请忽略（常为空）。shell 请 \`cd ${workDir}\` 或用上述绝对路径；不要只执行 \`ls\`/\`pwd\`。`;
}

/** 向指定网关会话注入初始化文本 (作为会话首条消息; 走该本地会话的专属连接)
 *  最多等待 45s; 超时/失败返回 false, 不阻塞会话使用。
 *  bypassGlobalQueue: 调用方已持全局锁时必须为 true, 否则会死锁。 */
export async function injectSessionSetup(
  localSessionId: string,
  acpSid: string,
  text: string,
  opts: { bypassGlobalQueue?: boolean } = {},
): Promise<boolean> {
  try {
    await prompt(text, () => {}, {
      acpSessionId: acpSid,
      localSessionId,
      absoluteTimeoutMs: 45_000,
      bypassGlobalQueue: opts.bypassGlobalQueue,
      // 注入约定无 UI: 自动放行工具权限, 避免卡死
      autoAllowPermissions: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** session/prompt: 流式执行, 通过 onEvent 回调逐事件推送。
 *  默认进全局串行队列; bypassGlobalQueue=true 时由调用方持锁 (activate+prompt 合并场景)。
 *  超时策略: 默认「不活跃超时」(距上一次网关响应); 总时长不封顶, 仅用户停止或硬 absoluteTimeoutMs。 */
export async function prompt(
  text: string,
  onEvent: (e: PromptEvent) => void,
  opts: {
    /**
     * 不活跃超时 (ms)。缺省读偏好 (默认 10min); 0 = 禁用。
     * 任意网关响应 (工具/正文/权限/用量等) 都会重置计时。
     */
    inactivityTimeoutMs?: number;
    /** 绝对硬超时 (ms); 仅后台注入等短任务使用。与不活跃超时可并存, 先到先触发。 */
    absoluteTimeoutMs?: number;
    /** @deprecated 请用 absoluteTimeoutMs / inactivityTimeoutMs */
    timeoutMs?: number;
    acpSessionId?: string;
    cwd?: string;
    localSessionId?: string;
    /** 不活跃/硬超时触发时回调: 前端可立即提示, 服务端继续吞流直到自然结束 */
    onTimeout?: () => void;
    /** 调用方已持 withGlobalAgentLock 时置 true, 避免嵌套入队死锁 */
    bypassGlobalQueue?: boolean;
    /** 无前端时自动选 allow 选项 (后台注入等) */
    autoAllowPermissions?: boolean;
  } = {},
): Promise<void> {
  const key = opts.localSessionId ?? "default";
  const run = async () => {
    let cs = await getConnFor(key);
    await withConnLock(cs, async () => {
      cs = conns.get(key) ?? cs;
      const sessionId = await ensureSessionForOn(cs, opts.acpSessionId, opts.cwd);
      if (consumeCancelled(cs, sessionId)) throw new Error("任务已取消");
      cs.running = true;
      // 兼容旧 timeoutMs (= 绝对超时); 用户任务走不活跃超时
      const absoluteMs =
        opts.absoluteTimeoutMs ??
        (opts.inactivityTimeoutMs === undefined && opts.timeoutMs != null ? opts.timeoutMs : undefined);
      const inactivityMs =
        opts.inactivityTimeoutMs !== undefined
          ? opts.inactivityTimeoutMs
          : absoluteMs != null
            ? 0
            : getInactivityTimeoutMs();
      const id = Date.now();
      const toolUrlAcc = new Map<string, string>();
      acpLog(
        `prompt start local=${key} acp=${sessionId} rpc=${id} inactivityMs=${inactivityMs} absoluteMs=${absoluteMs ?? "-"} autoAllow=${!!opts.autoAllowPermissions} textLen=${text.length}`,
      );
      try {
        const res = await acpPost(cs, {
          jsonrpc: "2.0",
          id,
          method: "session/prompt",
          params: { sessionId, prompt: [{ type: "text", text }] },
        });
        if (!res.ok) throw new Error(`prompt HTTP ${res.status}`);
        await new Promise<void>((resolve, reject) => {
          // 防御性吞流: cancel 语义不保证; 超时后丢弃转发直至自然结束
          let discarded = false;
          let settled = false;
          let sawStop = false;
          let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
          let absoluteTimer: ReturnType<typeof setTimeout> | null = null;
          let swallowTimer: ReturnType<typeof setTimeout> | null = null;
          /** 网关常在 stopReason 之后才推 usage_update; 结束后再短等一会避免 Token 栏滞后 */
          let usageGraceTimer: ReturnType<typeof setTimeout> | null = null;
          const clearAllTimers = () => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            if (absoluteTimer) clearTimeout(absoluteTimer);
            if (swallowTimer) clearTimeout(swallowTimer);
            if (usageGraceTimer) clearTimeout(usageGraceTimer);
            inactivityTimer = absoluteTimer = swallowTimer = usageGraceTimer = null;
          };
          const finish = () => {
            if (settled) return;
            settled = true;
            clearAllTimers();
            resolve();
          };
          const emit = (e: PromptEvent): void => {
            if (!discarded) onEvent(e);
          };
          const fireTimeout = (reason: "inactivity" | "absolute", afterMs: number) => {
            if (discarded) return;
            discarded = true;
            clearAllTimers();
            markCancelled(cs, sessionId);
            cancelPendingPermissions(key);
            acpLog(
              `prompt timeout local=${key} acp=${sessionId} rpc=${id} reason=${reason} after=${afterMs}ms`,
            );
            void acpPost(cs, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }).catch(
              () => {},
            );
            opts.onTimeout?.();
            // 网关可能仍在跑: 再等 60s 吞流后强制放行队列
            swallowTimer = setTimeout(() => {
              reject(
                new Error(
                  reason === "inactivity"
                    ? "不活跃超时且网关任务未结束, 已强制放行队列"
                    : "任务超时且网关任务未结束, 已强制放行队列",
                ),
              );
            }, 60_000);
          };
          const armInactivity = () => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            inactivityTimer = null;
            if (discarded || inactivityMs <= 0) return;
            inactivityTimer = setTimeout(() => fireTimeout("inactivity", inactivityMs), inactivityMs);
          };
          const bumpActivity = () => {
            if (discarded) return;
            armInactivity();
          };
          armInactivity();
          if (absoluteMs != null && absoluteMs > 0) {
            absoluteTimer = setTimeout(() => fireTimeout("absolute", absoluteMs), absoluteMs);
          }
          readSse(res, async (json) => {
            const r = json as {
              id?: string | number;
              method?: string;
              result?: { stopReason?: string };
              params?: {
                sessionId?: string;
                toolCall?: {
                  toolCallId?: string;
                  title?: string;
                  kind?: string;
                  status?: string;
                  _meta?: Record<string, unknown>;
                };
                options?: Array<{ optionId?: string; name?: string; kind?: string }>;
                update?: {
                  sessionUpdate?: string;
                  content?: { content?: { text?: string }; text?: string };
                  _meta?: Record<string, unknown>;
                  toolCallId?: string;
                  status?: string;
                  rawInput?: { url?: string; query?: string; prompt?: string };
                  title?: string;
                  configOptions?: ConfigOptionInfo[];
                  used?: number;
                  size?: number;
                };
              };
            };

            // 任意入站帧都算活跃 (含 keepalive 以外的 JSON-RPC)
            bumpActivity();

            // Agent → Client 权限请求: 必须用同 id 回 result
            // 不可 await 用户应答 (停读 SSE 易令网关侧提前 cancelled); 前端弹窗 + GET 轮询应答
            if (r?.method === "session/request_permission" && r.id != null) {
              const options: PermissionOption[] = (r.params?.options ?? [])
                .filter((o) => typeof o?.optionId === "string")
                .map((o) => ({
                  optionId: o.optionId as string,
                  name: o.name || (o.optionId as string),
                  kind: o.kind,
                }));
              const toolTitle =
                r.params?.toolCall?.title ||
                (r.params?.toolCall?._meta?.["codebuddy.ai/toolName"] as string) ||
                "工具请求权限";
              const toolCallId = r.params?.toolCall?.toolCallId;
              const rawInput = (r.params?.toolCall as { rawInput?: unknown } | undefined)?.rawInput;
              const detail = permissionDetailFromRaw(rawInput, toolTitle);
              const autoByMode = shouldAutoAllowByMode(cs, toolTitle);
              if (opts.autoAllowPermissions || autoByMode) {
                const opt = pickAutoAllowOption(options);
                acpLog(
                  `permission auto local=${key} rpc=${String(r.id)} tool=${toolTitle} mode=${cs.sessionConfig.mode?.currentValue ?? ""} reason=${opts.autoAllowPermissions ? "inject" : "mode"} option=${opt ?? "cancel"}`,
                );
                await sendPermissionResult(
                  cs,
                  r.id,
                  opt ? { outcome: "selected", optionId: opt } : { outcome: "cancelled" },
                );
              } else {
                // 登记后继续读 SSE。用户点选走另一条 POST, 不能停住这条流。
                armPermissionWait(cs, key, r.id, { toolTitle, toolCallId, detail, options });
                acpLog(
                  `permission request local=${key} rpc=${String(r.id)} tool=${toolTitle} call=${toolCallId ?? ""} detail=${detail.slice(0, 120)}`,
                );
                emit({
                  type: "permission",
                  requestId: r.id,
                  toolTitle,
                  toolCallId,
                  detail,
                  options,
                });
              }
              return;
            }

            const up = r?.params?.update;
            if (up && typeof up.sessionUpdate === "string") {
              const type = up.sessionUpdate;
              const chunk = up.content?.content?.text ?? up.content?.text ?? "";
              const toolName = (up._meta?.["codebuddy.ai/toolName"] as string) ?? "";
              if (type === "agent_message_chunk") {
                if (chunk) emit({ type: "chunk", text: chunk });
              } else if (type === "agent_thought_chunk") {
                if (chunk) emit({ type: "thought", text: chunk });
              } else if (type === "tool_call" || type === "tool_call_update") {
                const tk = up.toolCallId ?? toolName;
                if (tk) {
                  const prev = toolUrlAcc.get(tk) ?? "";
                  const cur = up.rawInput?.url ?? "";
                  toolUrlAcc.set(tk, cur.length >= prev.length ? cur : prev);
                }
                const acc = tk ? (toolUrlAcc.get(tk) ?? "") : "";
                const rawAny =
                  (up.rawInput && Object.values(up.rawInput).find((v) => typeof v === "string" && v.length > 0)) ?? "";
                const detail = acc || (typeof rawAny === "string" ? rawAny : "") || up.title || "";
                emit({
                  type: "tool",
                  tool: toolName || up.toolCallId || "tool",
                  state: type === "tool_call" ? (up.status ?? "pending") : (up.status ?? "completed"),
                  detail,
                  toolCallId: up.toolCallId ?? undefined,
                });
              } else if (type === "usage_update") {
                const usage = applyUsageUpdate(cs, up as Record<string, unknown>);
                emit({ type: "usage", usage });
                // stop 后等到用量再收尾, 立刻 finish 让前端 Token 栏跟上
                if (sawStop) finish();
              } else if (type === "config_option_update") {
                if (Array.isArray(up.configOptions)) {
                  for (const o of up.configOptions) cs.sessionConfig[o.id] = o;
                }
              }
              return;
            }
            // 仅匹配本轮 prompt id 的 stopReason
            const stopReason =
              r?.result && typeof (r.result as { stopReason?: unknown }).stopReason === "string"
                ? (r.result as { stopReason: string }).stopReason
                : undefined;
            if (stopReason !== undefined && r.id === id && !("outcome" in (r.result as object))) {
              clearAllTimers();
              const map = pendingPermissions();
              let dropped = 0;
              for (const [, p] of [...map]) {
                if (p.localSessionId !== key && key !== "*") continue;
                map.delete(permissionKey(p.localSessionId, p.requestId));
                settlePermission(p);
                dropped += 1;
              }
              acpLog(
                `prompt stop local=${key} acp=${sessionId} rpc=${String(id)} stopReason=${stopReason} droppedPending=${dropped}`,
              );
              // session/cancel 会永久毒化该 ACP 会话的 abortSignal; 必须清绑定, 下次 session/new + 注入历史
              if (stopReason === "cancelled") {
                clearPoisonedAcpBinding(key, cs, sessionId);
              }
              emit({ type: "done", stopReason, id });
              sawStop = true;
              // 再等一小段: 常见顺序是 end_turn 之后才到 usage_update
              usageGraceTimer = setTimeout(() => finish(), 900);
            }
          }).catch((e) => {
            clearAllTimers();
            cancelPendingPermissions(key);
            reject(e);
          });
        });
        touch(cs);
      } catch (e) {
        if (isConnError((e as Error).message)) {
          conns.delete(GATEWAY_KEY);
        }
        throw e;
      } finally {
        cs.running = false;
        // cancelledSids 只对本轮有效; 不清理会让下一轮一进来就误抛「任务已取消」
        cs.cancelledSids.delete(sessionId);
      }
    });
  };
  if (opts.bypassGlobalQueue) return run();
  return enqueueGlobal(key, run);
}

/**
 * session/cancel 后 ACP 会话 abortSignal 永久置位, 后续工具授权会被网关拒绝。
 * 丢掉本地绑定与内存 activeSessionId, 下次发送走 session/new + 历史注入。
 */
function clearPoisonedAcpBinding(key: string, cs: ConnState, sid: string): void {
  if (cs.activeSessionId === sid) cs.activeSessionId = null;
  cs.cancelledSids.delete(sid);
  if (key !== "default") {
    updateSessionGateway(key, { clearAcpSession: true });
  }
  acpLog(`cleared poisoned acp binding local=${key} acp=${sid}`);
}

/** session/cancel (通知, 无响应体等待); 取消指定本地会话连接上的网关会话 */
export async function cancel(localSessionId?: string, sessionId?: string): Promise<void> {
  const key = localSessionId ?? "default";
  // 1) 取消排队中的任务 (标记 token, 轮到时跳过)
  cancelQueued(key);
  // 2) 未决权限一律 cancelled
  cancelPendingPermissions(key);
  // 3) 取消运行中的任务 (标记 + 通知网关) 并清毒化绑定
  const cs = conns.get(GATEWAY_KEY);
  const sid = sessionId ?? cs?.activeSessionId ?? undefined;
  if (!cs || !sid) return;
  markCancelled(cs, sid);
  try {
    await acpPost(cs, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: sid } });
    acpLog(`session/cancel sent local=${key} acp=${sid}`);
  } catch (e) {
    acpLog(`session/cancel fail local=${key} acp=${sid}: ${(e as Error).message}`);
  }
  clearPoisonedAcpBinding(key, cs, sid);
}

/** 通用 RPC 封装: 等首个 result 或 error (通知忽略) */
async function acpCall(
  cs: ConnState,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 8000,
): Promise<{ result?: unknown; configOptions?: ConfigOptionInfo[] }> {
  const res = await acpPost(cs, { jsonrpc: "2.0", id, method, params });
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} 超时`)), timeoutMs);
    readSse(res, (json) => {
      const r = json as {
        result?: { configOptions?: ConfigOptionInfo[] };
        error?: { code?: string | number; message?: string };
      };
      if (r?.error) {
        clearTimeout(timer);
        reject(new Error(`${method}: ${r.error.code} ${r.error.message}`));
      } else if (r?.result) {
        clearTimeout(timer);
        resolve({ result: r.result, configOptions: r.result.configOptions });
      }
    }).catch(reject);
  });
}

/** 在已持全局锁的前提下, 对齐到本地会话绑定的网关会话 (禁止 ensureSessionOn 误建无关会话) */
async function alignKeyToLocalSession(key: string): Promise<{ cs: ConnState; sessionId: string }> {
  const cs = await getConnFor(key);
  if (key === "default") {
    const sessionId = await ensureSessionOn(cs);
    return { cs, sessionId };
  }
  const meta = getSession(key);
  if (!meta) throw new Error("会话不存在");
  const cwd = meta.acpCwd ?? workDirOf(key);
  const sessionId = await ensureSessionForOn(cs, meta.acpSessionId, cwd);
  updateSessionGateway(key, { acpSessionId: sessionId, acpCwd: cwd });
  return { cs: conns.get(key) ?? cs, sessionId };
}

/** session/set_model: 切换会话模型 (实测可用, result 为空对象); 全局串行 + 对齐目标本地会话 */
export async function setModel(modelId: string, localSessionId?: string): Promise<AgentStatus> {
  const key = localSessionId ?? "default";
  return enqueueGlobal(key, async () => {
    const { cs, sessionId } = await alignKeyToLocalSession(key);
    const prev = cs.sessionConfig.model?.currentValue;
    await acpCall(cs, "session/set_model", { sessionId, model: modelId }, 11);
    if (cs.sessionConfig.model) cs.sessionConfig.model.currentValue = modelId;
    const name = cs.sessionConfig.model?.options?.find((o) => o.value === modelId)?.name;
    patchAgentPreference({ modelId, modelName: name ?? modelId });
    acpLog(`set_model ok ${prev ?? "-"} -> ${modelId} name=${name ?? modelId} session=${sessionId.slice(0, 8)}`);
    return status(key);
  });
}

/** session/set_config_option: 通用会话配置 (mode/model/thought_level/sandbox);
 *  实测返回全量 configOptions, 用于刷新本地缓存; 全局串行 + 对齐目标本地会话 */
export async function setConfigOption(configId: string, value: string, localSessionId?: string): Promise<AgentStatus> {
  const key = localSessionId ?? "default";
  return enqueueGlobal(key, async () => {
    const { cs, sessionId } = await alignKeyToLocalSession(key);
    const { configOptions } = await acpCall(cs, "session/set_config_option", { sessionId, configId, value }, 12);
    if (Array.isArray(configOptions)) {
      for (const o of configOptions) cs.sessionConfig[o.id] = o;
    }
    if (configId === "mode" || configId === "thought_level" || configId === "sandbox") {
      patchAgentPreference({ config: { [configId]: value } });
    }
    // 若返回未带全量 options, 至少写回 currentValue, 避免 UI 选了又弹回
    if (cs.sessionConfig[configId]) {
      cs.sessionConfig[configId]!.currentValue = value;
    } else {
      cs.sessionConfig[configId] = {
        id: configId,
        name: configId,
        type: "select",
        currentValue: value,
      };
    }
    acpLog(`set_config ok id=${configId} value=${value} cur=${cs.sessionConfig[configId]?.currentValue ?? ""}`);
    return status(key);
  });
}

/** 语义别名: 一个本地会话的网关态对象 (AgentSessionService 实例)。
 * 详见 docs/specs/015-agent-session.md — ConnState 即该对象, conns Map 即 AgentSessionRegistry。 */
export type AgentSessionService = ConnState;
export type AgentSessionRegistry = Map<string, ConnState>;

/** 诊断信息 (不含 token), 用于 UI 展示 */
export function diagnostic(): Record<string, unknown> {
  return {
    sessionsDir: SESSIONS_DIR,
    discoverResult: discover(),
    connectedCount: conns.size,
    connections: [...conns.keys()].map((k) => ({
      key: k,
      connectionId: conns.get(k)?.connectionId.slice(0, 8),
      acpSessionId: conns.get(k)?.activeSessionId?.slice(0, 8),
    })),
    phase: status().phase,
  };
}
