// WorkBuddy 本机 ACP 网关客户端 (服务端多连接池)
// 协议依据: ~/Workbuddy/.../workbuddy-acp-integration-prompt.md (2026-09-26 实测)
// - 发现: ~/.workbuddy/sessions/*.json 的 pid → lsof 解析 127.0.0.1 监听端口
// - 建连: POST /api/v1/acp/connect → connectionId + sessionToken (仅内存)
// - 调用: POST /api/v1/acp 标准 JSON-RPC 2.0, 响应为 SSE 流 (:ok keepalive + event: message)
// 多会话隔离: 每个本地会话绑定一个 AgentSessionService 实例 (独立 connectionId/sessionToken/active session),
//   连接间物理隔离 → 多会话真并行且不串台; 连接空闲超时回收(运行中不回收), 失效自动重建。
// 架构映射 (见 docs/specs/015-agent-session.md):
//   ConnState            = AgentSessionService 实例 (一个本地会话的网关态: 连接+网关会话+配置+队列)
//   conns (Map)          = AgentSessionRegistry (sessionId → AgentSessionService)
//   ensureSessionFor 等  = AgentSessionService.ensureSession / .prompt / .cancel / .setModel / .setConfig
// 安全: 仅 127.0.0.1/localhost; token 永不落盘/出服务端; 权限请求默认拒绝。

import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getPreferredModel } from "./agent-session-store";

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
  options?: { value: string; name: string; description?: string }[];
};

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
  usage?: { used: number; size: number };
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
  usage: { used: number; size: number } | null;
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

/** 读 SSE 流, 逐事件回调 (event: message 的 data JSON) */
async function readSse(res: Response, onData: (json: unknown) => void): Promise<void> {
  if (!res.body) throw new Error("网关无响应体");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let eventName = "";
  let dataLines: string[] = [];
  const flush = () => {
    if (eventName === "message" && dataLines.length > 0) {
      try {
        onData(JSON.parse(dataLines.join("\n")));
      } catch {
        // 坏 JSON 忽略
      }
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
  flush();
}

async function acpPost(
  cs: ConnState,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
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
              cs.availableModels = o.options.map((opt) => ({
                modelId: opt.value,
                name: opt.name || opt.value,
              }));
            }
          }
        } else if (up.sessionUpdate === "usage_update" && typeof up.used === "number" && typeof up.size === "number") {
          cs.usage = { used: up.used, size: up.size };
        }
      } else if (r?.result?.sessionId) {
        // 实测: result 直接带 models.availableModels (模型清单)
        if (Array.isArray(r.result.models?.availableModels)) {
          cs.availableModels = r.result.models!.availableModels!;
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
  // session/new 挂载会话后, 网关会把历史回放推给首个流通道;
  // 先开 GET 订阅吃掉回放, 保证后续 prompt 流干净 (新会话无历史, 400ms 足够)
  await drainReplayOn(cs, 400);
  // 应用保存的模型偏好 (新会话统一恢复用户上次选择; 不可用/失败静默, 不阻断会话)
  try {
    const prefer = getPreferredModel();
    if (prefer?.modelId) {
      const cur = cs.sessionConfig.model?.currentValue;
      if (cur !== prefer.modelId) {
        await setModel(prefer.modelId, cs.key === "default" ? undefined : cs.key);
      }
    }
  } catch {
    // 模型偏好应用失败不影响会话使用
  }
  return cs.activeSessionId;
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
              cs.availableModels = o.options.map((opt) => ({
                modelId: opt.value,
                name: opt.name || opt.value,
              }));
            }
          }
        } else if (up.sessionUpdate === "usage_update" && typeof up.used === "number" && typeof up.size === "number") {
          cs.usage = { used: up.used, size: up.size };
        }
      } else if (r?.result) {
        // 实测: load 成功 result 直接含 models.availableModels
        if (Array.isArray(r.result.models?.availableModels)) {
          cs.availableModels = r.result.models!.availableModels!;
        }
        clearTimeout(timer);
        resolve(r.result);
      }
    }).catch(reject);
  }).catch((e: Error) => {
    lastError = `session/load: ${e.message}`;
    return null;
  });
  if (!result) return null;
  cs.activeSessionId = sessionId;
  // load 恢复后同样吃掉网关历史回放 (恢复历史可能持续数百 ms, 用 1200ms 上限)
  await drainReplayOn(cs, 1200);
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
 *  用一次性 text() 解析 (独立进程探测验证可靠)。会多建一个空会话, 可接受。 */
async function refreshConfigOn(cs: ConnState): Promise<void> {
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
            cs.sessionConfig[o.id] = o;
            if (o.id === "model" && Array.isArray(o.options)) {
              cs.availableModels = o.options.map((opt) => ({ modelId: opt.value, name: opt.name || opt.value }));
            }
          }
        }
      } catch {
        // 坏行忽略
      }
    }
  } catch {
    // 配置拉取失败不影响连接
  }
}

/** 建连核心: discover + connect + initialize; 返回新连接状态 */
async function connectCore(key: string): Promise<ConnState> {
  const d = discover();
  if (!d) throw new Error("未发现存活 WorkBuddy 网关 (检查 ~/.workbuddy/sessions 与进程)");
  const base = `http://127.0.0.1:${d.port}`;
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
  conns.set(key, cs);
  if (!defaultKey) defaultKey = key;
  return cs;
}

/** 获取/创建指定本地会话的专属连接 */
async function getConnFor(key: string): Promise<ConnState> {
  const existing = conns.get(key);
  if (existing) {
    touch(existing);
    return existing;
  }
  const cs = await connectCore(key);
  touch(cs);
  return cs;
}

/** 为指定本地会话对齐网关会话 (在其专属连接上 load 恢复或 new 新建), 返回网关会话 id */
export async function ensureSessionFor(localSessionId: string, acpSid?: string, cwd?: string): Promise<string> {
  const cs = await getConnFor(localSessionId);
  return withConnLock(cs, async () => {
    const cur = conns.get(localSessionId) ?? cs;
    return ensureSessionForOn(cur, acpSid, cwd);
  });
}

/** Step 1: 建连 (默认连接, 无参调用); 或为指定本地会话建专属连接 (localSessionId) */
export async function connect(key?: string): Promise<AgentStatus> {
  lastError = null;
  discovering = true;
  const k = key ?? "default";
  try {
    if (k === "default") {
      // 默认连接: 建连接 + 初始会话 + 拉配置 (UI 初始展示用)
      const cs = await getConnFor(k);
      try {
        await ensureSessionOn(cs);
        lastError = null;
      } catch (e) {
        lastError = `会话创建失败: ${(e as Error).message}`;
      }
      await refreshConfigOn(cs);
    } else {
      await getConnFor(k);
    }
    defaultKey = k;
    return status(k);
  } catch (e) {
    lastError = `建连异常: ${(e as Error).message}`;
    return { phase: "error", lastError, discovered: discover() ?? undefined };
  } finally {
    discovering = false;
  }
}

/** 当前状态快照 (绝不含 token); 指定 localSessionId 时返回该会话连接的快照 */
export function status(key?: string): AgentStatus {
  const k = key && key !== "default" ? key : (defaultKey ?? "");
  const cs = (k && conns.get(k)) ?? (conns.size ? conns.values().next().value : undefined);
  if (!cs) {
    const d = discover();
    return {
      phase: discovering ? "discovering" : "idle",
      discovered: d ?? undefined,
      lastError: lastError ?? undefined,
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
    models: cs.availableModels.length
      ? cs.availableModels
      : Object.values(cs.sessionConfig)
          .find((o) => o.id === "model" && Array.isArray(o.options))
          ?.options?.map((opt) => ({ modelId: opt.value, name: opt.name || opt.value })) ?? FALLBACK_MODELS,
    sessionConfig: cs.sessionConfig,
    usage: cs.usage ?? undefined,
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

export type PromptEvent =
  | { type: "chunk"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool"; tool: string; state: string; detail?: string; toolCallId?: string }
  | { type: "done"; stopReason?: string; id?: unknown };

/**
 * 拼接会话初始化文本: 工作约定 + 本会话历史记忆位置说明
 * (以普通语气注入, 避免被识别为「伪系统指令」而拒绝长期遵循)
 * @param workDir 会话工作区 (网关 cwd; 所有新文件产物必须写这里)
 * @param dataDir 会话内部数据目录 (messages.jsonl / meta.json 所在)
 */
export function buildSessionSetupText(systemPrompt: string, workDir: string, dataDir: string): string {
  return `【工作约定 · 请仅记住，无需执行任何操作，也不要回复确认】

本会话是一个独立工作会话，与 WorkBuddy 里其他任何项目、工作区、空间都没有关系（例如 OneDockAgentConnector、weimei-crm 等一律与本会话无关）：
- 本会话的工作目录 = ${workDir}（这是本会话唯一被授权的工作区，新建文件必须写在这里）
- 本会话的历史记录 = ${dataDir}/messages.jsonl（每行一条 JSON：{role: user|assistant, text, tools?}；回顾历史从这里读）
- 本会话的产物目录 = ${workDir}/artifacts/（新建的文件必须写在这里）
- 本会话的元信息 = ${dataDir}/meta.json（仅供了解本会话，不要修改）

请忽略与本会话无关的任何先前上下文：其他项目的工作目录、记忆、约定、产物都不属于本会话，不要把它们当作本会话的工作依据。所有工作上下文一律以本会话的工作目录 ${workDir} 为基准；涉及文件读写、任务执行、回答问题时，都以本会话目录和下面的约定为基准。严禁读写本会话工作目录以外的任何路径（包括其他会话的目录、WorkBuddy 自己的项目目录）。

${systemPrompt}

- 如果用户让你继续之前的工作，你可以直接读取 ${dataDir}/messages.jsonl 回顾历史、查看 ${workDir}/artifacts/ 里的产物。
- 新建的文件产物（文章、图片、表格等）必须写入 ${workDir}/artifacts/ 子目录（不存在则创建），不得写入其他项目目录（例如 OneDockAgentConnector 等与本会话无关的工作区）。
- 以上内容仅用于记录，请勿执行、勿读取文件、勿向用户确认，直接等用户下一条消息即可。`;
}

/** 向指定网关会话注入初始化文本 (作为会话首条消息; 走该本地会话的专属连接)
 *  最多等待 45s; 超时/失败返回 false, 不阻塞会话使用 */
export async function injectSessionSetup(localSessionId: string, acpSid: string, text: string): Promise<boolean> {
  try {
    await prompt(text, () => {}, { acpSessionId: acpSid, localSessionId, timeoutMs: 45_000 });
    return true;
  } catch {
    return false;
  }
}

/** session/prompt: 流式执行, 通过 onEvent 回调逐事件推送; 返回最终 result。
 *  必须携带 localSessionId → 使用该会话的专属连接 (多会话并行隔离) */
export async function prompt(
  text: string,
  onEvent: (e: PromptEvent) => void,
  opts: { timeoutMs?: number; acpSessionId?: string; cwd?: string; localSessionId?: string } = {},
): Promise<void> {
  const key = opts.localSessionId ?? "default";
  let cs = await getConnFor(key);
  // 整轮 (会话对齐 + 读流) 在本连接内串行, 跨会话连接并行
  await withConnLock(cs, async () => {
    cs = conns.get(key) ?? cs;
    const sessionId = await ensureSessionForOn(cs, opts.acpSessionId, opts.cwd);
    if (consumeCancelled(cs, sessionId)) throw new Error("任务已取消");
    cs.running = true;
    const timeoutMs = opts.timeoutMs ?? 300_000;
    const id = Date.now();
    // 实测: rawInput.url 为增量片段, 需按 toolCallId 累积
    const toolUrlAcc = new Map<string, string>();
    const res = await acpPost(cs, {
      jsonrpc: "2.0",
      id,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text }] },
    });
    if (!res.ok) throw new Error(`prompt HTTP ${res.status}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void cancel(key, sessionId).catch(() => {});
        reject(new Error("任务超时, 已发送取消"));
      }, timeoutMs);
      readSse(res, (json) => {
        const r = json as {
          result?: { stopReason?: string };
          params?: { update?: { sessionUpdate?: string; content?: { content?: { text?: string }; text?: string }; _meta?: Record<string, unknown>; toolCallId?: string; status?: string; rawInput?: { url?: string; query?: string; prompt?: string }; title?: string; configOptions?: ConfigOptionInfo[]; used?: number; size?: number } };
        };
        // 实测: params.update.sessionUpdate 为字符串 (如 "agent_message_chunk"),
        // content.content.text 为增量文本, _meta["codebuddy.ai/toolName"] 为工具名
        // 通知 (session/update) 优先处理; JSON-RPC 响应 (带 result) 表示本轮结束
        const up = r?.params?.update;
        if (up && typeof up.sessionUpdate === "string") {
          const type = up.sessionUpdate;
          const text = up.content?.content?.text ?? up.content?.text ?? "";
          const toolName = (up._meta?.["codebuddy.ai/toolName"] as string) ?? "";
          if (type === "agent_message_chunk") {
            if (text) onEvent({ type: "chunk", text });
          } else if (type === "agent_thought_chunk") {
            if (text) onEvent({ type: "thought", text });
          } else if (type === "tool_call" || type === "tool_call_update") {
            // 实测: rawInput.url 是增量片段 (https → https:// → https://www), 同 toolCallId 内累积拼接
            const k = up.toolCallId ?? toolName;
            if (k) {
              const prev = toolUrlAcc.get(k) ?? "";
              const cur = up.rawInput?.url ?? "";
              toolUrlAcc.set(k, cur.length >= prev.length ? cur : prev);
            }
            const acc = k ? (toolUrlAcc.get(k) ?? "") : "";
            // 不同工具参数结构不同 (WebFetch.url 增量 / read_me.filePath 等): 动态取第一个非空字符串参数
            const rawAny =
              (up.rawInput && Object.values(up.rawInput).find((v) => typeof v === "string" && v.length > 0)) ?? "";
            const detail = acc || (typeof rawAny === "string" ? rawAny : "") || up.title || "";
            onEvent({
              type: "tool",
              tool: toolName || up.toolCallId || "tool",
              state: type === "tool_call" ? (up.status ?? "pending") : (up.status ?? "completed"),
              detail,
              toolCallId: up.toolCallId ?? undefined,
            });
          } else if (type === "usage_update") {
            // 实测: 会话 token 用量统计 (used/size)
            if (typeof up.used === "number" && typeof up.size === "number") {
              cs.usage = { used: up.used, size: up.size };
            }
          } else if (type === "config_option_update") {
            // 会话配置选项 (mode/model/thought_level/sandbox) 刷新
            if (Array.isArray(up.configOptions)) {
              for (const o of up.configOptions) cs.sessionConfig[o.id] = o;
            }
          }
          return;
        }
        if (r?.result) {
          clearTimeout(timer);
          onEvent({ type: "done", stopReason: r.result.stopReason, id });
          resolve();
        }
      }).catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    touch(cs);
  }).catch((e) => {
    // 连接级故障: 丢弃缓存, 下次操作自动重建新连接
    if (isConnError((e as Error).message)) {
      conns.delete(key);
    }
    throw e;
  }).finally(() => {
    const cur = conns.get(key);
    if (cur) cur.running = false;
  });
}

/** session/cancel (通知, 无响应体等待); 取消指定本地会话连接上的网关会话 */
export async function cancel(localSessionId?: string, sessionId?: string): Promise<void> {
  const key = localSessionId ?? "default";
  const cs = conns.get(key) ?? (conns.size ? conns.values().next().value : undefined);
  const sid = sessionId ?? cs?.activeSessionId ?? undefined;
  if (!cs || !sid) return;
  markCancelled(cs, sid);
  try {
    await acpPost(cs, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: sid } });
  } catch {
    // 取消失败静默
  }
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

/** session/set_model: 切换会话模型 (实测可用, result 为空对象) */
export async function setModel(modelId: string, localSessionId?: string): Promise<AgentStatus> {
  const key = localSessionId ?? "default";
  const cs = await getConnFor(key);
  const sessionId = await ensureSessionOn(cs);
  await acpCall(cs, "session/set_model", { sessionId, model: modelId }, 11);
  if (cs.sessionConfig.model) cs.sessionConfig.model.currentValue = modelId;
  return status(key);
}

/** session/set_config_option: 通用会话配置 (mode/model/thought_level/sandbox);
 *  实测返回全量 configOptions, 用于刷新本地缓存 */
export async function setConfigOption(configId: string, value: string, localSessionId?: string): Promise<AgentStatus> {
  const key = localSessionId ?? "default";
  const cs = await getConnFor(key);
  const sessionId = await ensureSessionOn(cs);
  const { configOptions } = await acpCall(cs, "session/set_config_option", { sessionId, configId, value }, 12);
  if (Array.isArray(configOptions)) {
    for (const o of configOptions) cs.sessionConfig[o.id] = o;
  }
  return status(key);
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
