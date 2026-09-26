import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";

// 本地 Agent 会话持久化: 每个会话一个文件夹
//
//   data/agent-sessions/
//     <session-id>/
//       meta.json            # 元信息: id/title/createdAt/updatedAt/acpCwd/model
//       messages.jsonl       # 历史对话: 每行一条消息 { role, text, tools?, error?, ts }
//       artifacts/           # 中间产物与相关资源目录 (预留)
//
// 开发态根目录: <cwd>/data/agent-sessions; 打包态可用 env AGENT_SESSIONS_PATH 覆盖。

export type AgentToolRecord = {
  tool: string;
  detail?: string;
  toolCallId?: string;
  ts?: number;
};

export type AgentMessage = {
  role: "user" | "assistant";
  text: string;
  tools?: AgentToolRecord[];
  error?: boolean;
  ts: number;
};

export type AgentSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 关联的网关会话 (WorkBuddy ACP sessionId); 无则首次发送时创建并回写 */
  acpSessionId?: string;
  acpCwd?: string;
  model?: string;
};

const ROOT = process.env.AGENT_SESSIONS_PATH ?? path.join(process.cwd(), "data", "agent-sessions");

function ensureRoot(): string {
  mkdirSync(ROOT, { recursive: true });
  return ROOT;
}
function dirOf(id: string): string {
  return path.join(ROOT, id);
}
function metaOf(id: string): string {
  return path.join(dirOf(id), "meta.json");
}
function msgsOf(id: string): string {
  return path.join(dirOf(id), "messages.jsonl");
}

function readMeta(id: string): AgentSessionMeta | null {
  try {
    return JSON.parse(readFileSync(metaOf(id), "utf8")) as AgentSessionMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: AgentSessionMeta): void {
  writeFileSync(metaOf(meta.id), JSON.stringify(meta, null, 2), "utf8");
}

/** 会话列表 (按最近更新倒序) */
export function listSessions(): AgentSessionMeta[] {
  ensureRoot();
  const out: AgentSessionMeta[] = [];
  for (const name of readdirSync(ROOT)) {
    if (!existsSync(path.join(ROOT, name, "meta.json"))) continue;
    const meta = readMeta(name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新建会话 (生成唯一 id, 创建 artifacts 目录) */
export function createSession(acpCwd?: string, model?: string): AgentSessionMeta {
  ensureRoot();
  let id = "";
  do {
    id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  } while (existsSync(dirOf(id)));
  mkdirSync(path.join(dirOf(id), "artifacts"), { recursive: true });
  const now = Date.now();
  const meta: AgentSessionMeta = {
    id,
    title: `会话 ${new Date(now).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    createdAt: now,
    updatedAt: now,
    acpCwd,
    model,
  };
  writeMeta(meta);
  return meta;
}

export function getSession(id: string): AgentSessionMeta | null {
  return readMeta(id);
}

/** 读取历史消息 (按写入顺序) */
export function readMessages(id: string): AgentMessage[] {
  const p = msgsOf(id);
  if (!existsSync(p)) return [];
  const out: AgentMessage[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as AgentMessage);
    } catch {
      // 单行损坏跳过, 不阻塞其他消息
    }
  }
  return out;
}

/** 追加一条消息; 未设标题时用首条用户消息截断生成 */
export function appendMessage(id: string, msg: AgentMessage): void {
  const meta = getSession(id);
  if (!meta) return;
  appendFileSync(msgsOf(id), `${JSON.stringify(msg)}\n`, "utf8");
  meta.updatedAt = Date.now();
  if (!meta.title.startsWith("会话 ") && !meta.title.startsWith("「")) {
    // 已有自定义标题, 保留
  } else if (msg.role === "user") {
    const t = msg.text.replace(/\s+/g, " ").trim();
    if (t) meta.title = t.length > 24 ? `${t.slice(0, 24)}…` : t;
  }
  writeMeta(meta);
}

/** 回写网关会话绑定 (acpSessionId/acpCwd) */
export function updateSessionGateway(
  id: string,
  gateway: { acpSessionId?: string; acpCwd?: string },
): AgentSessionMeta | null {
  const meta = getSession(id);
  if (!meta) return null;
  if (gateway.acpSessionId) meta.acpSessionId = gateway.acpSessionId;
  if (gateway.acpCwd) meta.acpCwd = gateway.acpCwd;
  meta.updatedAt = Date.now();
  writeMeta(meta);
  return meta;
}

export function renameSession(id: string, title: string): AgentSessionMeta | null {
  const meta = getSession(id);
  if (!meta) return null;
  meta.title = title.trim() || meta.title;
  meta.updatedAt = Date.now();
  writeMeta(meta);
  return meta;
}

export function deleteSession(id: string): boolean {
  if (!existsSync(dirOf(id))) return false;
  rmSync(dirOf(id), { recursive: true, force: true });
  return true;
}

/** 会话文件夹内已写入的产物文件 (供展示/清理) */
export function listArtifacts(id: string): { name: string; size: number; mtime: number }[] {
  const d = path.join(dirOf(id), "artifacts");
  if (!existsSync(d)) return [];
  return readdirSync(d).map((name) => {
    const st = statSync(path.join(d, name));
    return { name, size: st.size, mtime: st.mtimeMs };
  });
}
