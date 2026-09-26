// WorkBuddy 本机 ACP 网关客户端 (服务端单例)
// 协议依据: ~/Workbuddy/.../workbuddy-acp-integration-prompt.md (2026-09-26 实测)
// - 发现: ~/.workbuddy/sessions/*.json 的 pid → lsof 解析 127.0.0.1 监听端口
// - 建连: POST /api/v1/acp/connect → connectionId + sessionToken (仅内存)
// - 调用: POST /api/v1/acp 标准 JSON-RPC 2.0, 响应为 SSE 流 (:ok keepalive + event: message)
// 安全: 仅 127.0.0.1/localhost; token 永不落盘/出服务端; 权限请求默认拒绝。

import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

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

// —— 模块级单例 (next start 长驻进程内共享; token 仅内存) ——
let conn: {
  base: string;
  connectionId: string;
  token: string;
  protocolVersion: number;
  capabilities: AgentCapabilities;
  authMethods: string[];
} | null = null;
let acpSessionId: string | null = null;
let lastError: string | null = null;
let discovering = false;
// —— 会话级能力缓存 (session/new / config 通知填充, 用于 UI 展示与设置) ——
let availableModels: ModelInfo[] = [];
let sessionConfig: Record<string, ConfigOptionInfo> = {};
let usage: { used: number; size: number } | null = null;

const SESSIONS_DIR = path.join(os.homedir(), ".workbuddy", "sessions");
const HEARTBEAT_FRESH_MS = 60_000;

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
  base: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}/api/v1/acp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", // 必须同时含, 否则 -32000
      "acp-connection-id": conn!.connectionId,
      Authorization: `Bearer ${conn!.token}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/** Step 1: 发现 + connect + initialize, 建立连接单例 */
export async function connect(): Promise<AgentStatus> {
  lastError = null;
  discovering = true;
  try {
    const d = discover();
    if (!d) {
      lastError = "未发现存活 WorkBuddy 网关 (检查 ~/.workbuddy/sessions 与进程)";
      return { phase: "error", lastError };
    }
    const base = `http://127.0.0.1:${d.port}`;
    const res = await fetch(`${base}/api/v1/acp/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      lastError = `connect 失败: HTTP ${res.status} (port ${d.port}, pid ${d.pid})`;
      return { phase: "error", discovered: d, lastError };
    }
    const cj = (await res.json()) as { connectionId?: string; sessionToken?: string };
    if (!cj.connectionId || !cj.sessionToken) {
      lastError = `connect 响应缺字段: ${JSON.stringify(Object.keys(cj))} (port ${d.port})`;
      return { phase: "error", discovered: d, lastError };
    }
    conn = {
      base,
      connectionId: cj.connectionId,
      token: cj.sessionToken,
      protocolVersion: 0,
      capabilities: {},
      authMethods: [],
    };
    // 网关可能已重启: 旧网关的会话 ID 在新网关无意义, 清空让后续按本地会话重新映射
    acpSessionId = null;
    // initialize (SSE 流)
    const init = await acpPost(base, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
    });
    if (!init.ok) {
      lastError = `initialize 失败: HTTP ${init.status} (port ${d.port})`;
      conn = null;
      return { phase: "error", discovered: d, lastError };
    }
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
      lastError = `initialize: ${e.message} (port ${d.port}, pid ${d.pid})`;
      conn = null;
      return null;
    });
    if (!initResult) return { phase: "error", discovered: d, lastError };

    const r = initResult as { protocolVersion?: number; agentCapabilities?: AgentCapabilities; authMethods?: { id: string; name?: string }[] };
    conn.protocolVersion = r.protocolVersion ?? 1;
    conn.capabilities = r.agentCapabilities ?? {};
    conn.authMethods = (r.authMethods ?? []).map((a) => a.id);

    acpSessionId = null; // 新连接重置会话
    availableModels = [];
    sessionConfig = {};
    usage = null;
    // 建会话拉取模型/配置 (models/sessionConfig 在 session/new 时才有),
    // 失败不阻塞连接本身, 记入 lastError
    try {
      await ensureSession();
      lastError = null;
    } catch (e) {
      lastError = `会话创建失败: ${(e as Error).message}`;
    }
    return status();
  } catch (e) {
    lastError = `建连异常: ${(e as Error).message}`;
    return { phase: "error", lastError };
  } finally {
    discovering = false;
  }
}

/** 当前状态快照 (绝不含 token) */
export function status(): AgentStatus {
  if (!conn) {
    const d = discover();
    return {
      phase: discovering ? "discovering" : "idle",
      discovered: d ?? undefined,
      lastError: lastError ?? undefined,
    };
  }
  const d = discover();
  return {
    phase: "connected",
    discovered: d ?? undefined,
    connectionIdMasked: `${conn.connectionId.slice(0, 8)}…${conn.connectionId.slice(-4)}`,
    protocolVersion: conn.protocolVersion,
    capabilities: conn.capabilities,
    authMethods: conn.authMethods,
    acpSessionId: acpSessionId ?? undefined,
    connectedAt: Date.now(),
    models: availableModels,
    sessionConfig,
    usage: usage ?? undefined,
  };
}

/** 确保已连接 (断连/未连时自动重连) */
export async function ensureConnected(): Promise<AgentStatus> {
  if (!conn) {
    const st = await connect();
    if (st.phase !== "connected") throw new Error(st.lastError ?? "连接失败");
  }
  return status();
}

/** session/new (默认开独立新会话 cwd=/tmp, 避免挂到 WorkBuddy 已运行会话导致历史回放噪声;
 *  传入 cwd 且该目录对应已运行会话时网关会挂载并回放, 需容忍乱序) */
export async function ensureSession(cwd?: string, opts: { force?: boolean } = {}): Promise<string> {
  if (acpSessionId && !opts.force) return acpSessionId;
  const st = await ensureConnected();
  if (!st.discovered) throw new Error("网关信息缺失");
  const res = await acpPost(conn!.base, {
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
          for (const o of up.configOptions) sessionConfig[o.id] = o;
        } else if (up.sessionUpdate === "usage_update" && typeof up.used === "number" && typeof up.size === "number") {
          usage = { used: up.used, size: up.size };
        }
      } else if (r?.result?.sessionId) {
        // 实测: result 直接带 models.availableModels (模型清单)
        if (Array.isArray(r.result.models?.availableModels)) {
          availableModels = r.result.models!.availableModels!;
        }
        clearTimeout(timer);
        resolve(r.result);
      }
    }).catch(reject);
  }).catch((e: Error) => {
    acpSessionId = null;
    throw new Error(`session/new: ${e.message}`);
  });
  if (!result?.sessionId) throw new Error("session/new 未返回 sessionId");
  acpSessionId = result.sessionId;
  // session/new 挂载会话后, 网关会把历史回放推给首个流通道;
  // 先开 GET 订阅吃掉回放, 保证后续 prompt 流干净 (幂等, 无回放快速退出)
  await drainReplay();
  return acpSessionId;
}

/** session/load: 恢复既有网关会话上下文 (实测需 cwd+mcpServers; 成功返回含 models 的 result)。
 *  返回 null 表示网关拒绝/作废, 调用方应重建新会话。 */
export async function loadSession(sessionId: string, cwd?: string): Promise<string | null> {
  const st = await ensureConnected();
  if (!st.discovered) throw new Error("网关信息缺失");
  const res = await acpPost(conn!.base, {
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
          for (const o of up.configOptions) sessionConfig[o.id] = o;
        } else if (up.sessionUpdate === "usage_update" && typeof up.used === "number" && typeof up.size === "number") {
          usage = { used: up.used, size: up.size };
        }
      } else if (r?.result) {
        // 实测: load 成功 result 直接含 models.availableModels
        if (Array.isArray(r.result.models?.availableModels)) {
          availableModels = r.result.models!.availableModels!;
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
  acpSessionId = sessionId;
  await drainReplay();
  return sessionId;
}

/** 把网关会话对齐到指定本地会话: 有 acpSessionId → load 恢复 (失败则新建);
 *  无 → session/new 新建。返回当前网关会话 id。 */
export async function ensureSessionFor(acpSid?: string, cwd?: string): Promise<string> {
  if (acpSid) {
    if (acpSid === acpSessionId) return acpSid;
    const loaded = await loadSession(acpSid, cwd);
    if (loaded) return loaded;
    // 网关拒绝/作废: 重建新会话
    acpSessionId = null;
    return ensureSession(cwd, { force: true });
  }
  // 本地会话无绑定: 必须新建独立网关会话 (即使当前已有别的会话), 保证上下文隔离
  acpSessionId = null;
  return ensureSession(cwd, { force: true });
}

export type PromptEvent =
  | { type: "chunk"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool"; tool: string; state: string; detail?: string; toolCallId?: string }
  | { type: "done"; stopReason?: string; id?: unknown };

/** 消费连接级历史回放: 挂载已运行会话时网关会重放其历史 (session/update 事件流)。
 * 打开 GET 订阅流吃掉回放, 保证后续 POST session/prompt 流是干净的新任务事件。
 * 读满 4s 即停 (回放毫秒级发完, 4s 足够; 无回放时超时快速退出, 幂等)。 */
async function drainReplay(): Promise<void> {
  if (!conn) return;
  try {
    const res = await fetch(`${conn.base}/api/v1/acp`, {
      method: "GET",
      headers: {
        Accept: "application/json, text/event-stream",
        "acp-connection-id": conn.connectionId,
        Authorization: `Bearer ${conn.token}`,
      },
      signal: AbortSignal.timeout(4000),
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

/** session/prompt: 流式执行, 通过 onEvent 回调逐事件推送; 返回最终 result */
export async function prompt(
  text: string,
  onEvent: (e: PromptEvent) => void,
  opts: { timeoutMs?: number; acpSessionId?: string; cwd?: string } = {},
): Promise<void> {
  const sessionId = await ensureSessionFor(opts.acpSessionId, opts.cwd);
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const id = Date.now();
  // 实测: rawInput.url 为增量片段, 需按 toolCallId 累积
  const toolUrlAcc = new Map<string, string>();
  const res = await acpPost(conn!.base, {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: { sessionId, prompt: [{ type: "text", text }] },
  });
  if (!res.ok) throw new Error(`prompt HTTP ${res.status}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void cancel(sessionId).catch(() => {});
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
          usage = { used: up.used, size: up.size };
        }
      } else if (type === "config_option_update") {
        // 会话配置选项 (mode/model/thought_level/sandbox) 刷新
        if (Array.isArray(up.configOptions)) {
          for (const o of up.configOptions) sessionConfig[o.id] = o;
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
}

/**
 * 拼接会话初始化文本: 工作约定 + 本会话历史记忆位置说明
 * (以普通语气注入, 避免被识别为「伪系统指令」而拒绝长期遵循)
 */
export function buildSessionSetupText(systemPrompt: string, sessionDir: string): string {
  return `【工作约定 · 请仅记住，无需执行任何操作，也不要回复确认】

本会话是一个独立工作会话，与 WorkBuddy 里其他任何项目、工作区、空间都没有关系（例如 OneDockAgentConnector、weimei-crm 等一律与本会话无关）：
- 本会话的工作目录 = ${sessionDir}
- 本会话的历史记录 = ${sessionDir}/messages.jsonl（每行一条 JSON：{role: user|assistant, text, tools?}）
- 本会话的产物目录 = ${sessionDir}/artifacts/（新建的文件必须写在这里）
- 本会话的元信息 = ${sessionDir}/meta.json

请忽略与本会话无关的任何先前上下文：其他项目的工作目录、记忆、约定、产物都不属于本会话，不要把它们当作本会话的工作依据。所有工作上下文一律以本会话目录为准；涉及文件读写、任务执行、回答问题时，都以本会话目录和下面的约定为基准。

${systemPrompt}

- 如果用户让你继续之前的工作，你可以直接读取 messages.jsonl 回顾历史、查看 artifacts/ 里的产物。
- 新建的文件产物（文章、图片、表格等）必须写入 ${sessionDir}/artifacts/ 子目录（不存在则创建），不得写入其他项目目录（例如 OneDockAgentConnector 等与本会话无关的工作区）。
- 以上内容仅用于记录，请勿执行、勿读取文件、勿向用户确认，直接等用户下一条消息即可。`;
}

/**
 * 向指定网关会话注入初始化文本（作为会话首条消息）
 * 最多等待 45s; 超时/失败返回 false, 不阻塞会话使用
 */
export async function injectSessionSetup(acpSid: string, text: string): Promise<boolean> {
  try {
    await prompt(text, () => {}, { acpSessionId: acpSid, timeoutMs: 45_000 });
    return true;
  } catch {
    return false;
  }
}

/** session/cancel (通知, 无响应体等待) */
export async function cancel(sessionId?: string): Promise<void> {
  const sid = sessionId ?? acpSessionId;
  if (!sid || !conn) return;
  try {
    await acpPost(conn.base, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: sid } });
  } catch {
    // 取消失败静默
  }
}

/** 通用 RPC 封装: 等首个 result 或 error (通知忽略) */
async function acpCall(
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 8000,
): Promise<{ result?: unknown; configOptions?: ConfigOptionInfo[] }> {
  if (!conn) throw new Error("未连接网关");
  const res = await acpPost(conn.base, { jsonrpc: "2.0", id, method, params });
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
export async function setModel(modelId: string): Promise<AgentStatus> {
  const sessionId = await ensureSession();
  await acpCall("session/set_model", { sessionId, model: modelId }, 11);
  if (sessionConfig.model) sessionConfig.model.currentValue = modelId;
  return status();
}

/** session/set_config_option: 通用会话配置 (mode/model/thought_level/sandbox);
 *  实测返回全量 configOptions, 用于刷新本地缓存 */
export async function setConfigOption(configId: string, value: string): Promise<AgentStatus> {
  const sessionId = await ensureSession();
  const { configOptions } = await acpCall("session/set_config_option", { sessionId, configId, value }, 12);
  if (Array.isArray(configOptions)) {
    for (const o of configOptions) sessionConfig[o.id] = o;
  }
  return status();
}

/** 诊断信息 (不含 token), 用于 UI 展示 */
export function diagnostic(): Record<string, unknown> {
  return {
    sessionsDir: SESSIONS_DIR,
    discoverResult: discover(),
    connected: !!conn,
    phase: status().phase,
  };
}
