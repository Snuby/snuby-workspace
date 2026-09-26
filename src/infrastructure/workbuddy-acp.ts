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
export async function ensureSession(cwd?: string): Promise<string> {
  if (acpSessionId) return acpSessionId;
  const st = await ensureConnected();
  if (!st.discovered) throw new Error("网关信息缺失");
  const res = await acpPost(conn!.base, {
    jsonrpc: "2.0",
    id: 2,
    method: "session/new",
    params: { cwd: cwd ?? "/tmp", mcpServers: [] },
  });
  const result = await new Promise<{ sessionId?: string } | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("session/new 超时")), 15000);
    readSse(res, (json) => {
      const r = json as { result?: { sessionId?: string }; error?: { code?: string | number; message?: string } };
      if (r?.error) {
        clearTimeout(timer);
        reject(new Error(`session/new RPC error: ${r.error.code} ${r.error.message}`));
      } else if (r?.result?.sessionId) {
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

export type PromptEvent =
  | { type: "chunk"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool"; tool: string; state: string; detail?: string }
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
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const sessionId = await ensureSession();
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const id = Date.now();
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
        params?: { update?: { sessionUpdate?: string; content?: { content?: { text?: string }; text?: string }; _meta?: Record<string, unknown>; toolCallId?: string; status?: string } };
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
        onEvent({
          type: "tool",
          tool: toolName || up.toolCallId || "tool",
          state: type === "tool_call" ? (up.status ?? "pending") : (up.status ?? "completed"),
        });
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

/** 诊断信息 (不含 token), 用于 UI 展示 */
export function diagnostic(): Record<string, unknown> {
  return {
    sessionsDir: SESSIONS_DIR,
    discoverResult: discover(),
    connected: !!conn,
    phase: status().phase,
  };
}
