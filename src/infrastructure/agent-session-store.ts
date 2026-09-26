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
  /** 已注入的工作约定指纹 (sha1); 约定编辑后指纹变化, 下次激活重新注入 */
  sysPromptFp?: string;
  /** 最近一次约定注入是否失败 */
  sysPromptFailed?: boolean;
};

const ROOT = process.env.AGENT_SESSIONS_PATH ?? path.join(process.cwd(), "data", "agent-sessions");
export const SESSIONS_ROOT = ROOT;
const SYSTEM_PROMPT_PATH = path.join(ROOT, "system-prompt.txt");

/** 默认工作约定 (可编辑; 以普通「工作约定」语气注入, 不自称系统级约束以免被拒) */
export const DEFAULT_SYSTEM_PROMPT = `我们之间的工作约定（请在每次回复时遵守）：
1. 所有回复一律使用 Markdown 格式输出。
2. 图片使用标准 Markdown 图片语法：![描述](URL)。
3. 引用或创建的本地文件，给出文件的绝对路径，并用 Markdown 链接格式 [文件名](绝对路径) 引用，方便直接打开。
4. 视频、音频等媒体资源，提供可访问的 URL 或本地绝对路径链接。
5. 默认使用简体中文回复。
6. 任务产物（新建的文件，如文章、图片、表格等）统一写入「当前会话目录的 artifacts/ 子目录」，并在回复中以 Markdown 链接给出绝对路径；不要写入其他项目目录。`;

export function getSystemPrompt(): string {
  try {
    if (existsSync(SYSTEM_PROMPT_PATH)) {
      const t = readFileSync(SYSTEM_PROMPT_PATH, "utf8").trim();
      if (t) return t;
    }
  } catch {
    // 读失败用默认
  }
  return DEFAULT_SYSTEM_PROMPT;
}

const MODEL_PREF_PATH = path.join(ROOT, "model-preference.json");

export interface ModelPreference {
  modelId: string;
  name?: string;
  updatedAt: number;
}

/** 读取用户保存的模型偏好 (全局, 新会话恢复用) */
export function getPreferredModel(): ModelPreference | null {
  try {
    if (!existsSync(MODEL_PREF_PATH)) return null;
    const d = JSON.parse(readFileSync(MODEL_PREF_PATH, "utf8")) as ModelPreference;
    if (!d?.modelId) return null;
    return d;
  } catch {
    return null;
  }
}

/** 保存模型偏好 (切换模型时写入) */
export function setPreferredModel(modelId: string, name?: string): void {
  mkdirSync(ROOT, { recursive: true });
  const d: ModelPreference = { modelId, name, updatedAt: Date.now() };
  writeFileSync(MODEL_PREF_PATH, JSON.stringify(d, null, 2), "utf8");
}

export function setSystemPrompt(text: string): void {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(SYSTEM_PROMPT_PATH, text.trim(), "utf8");
}

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
  gateway: { acpSessionId?: string; acpCwd?: string; sysPromptFp?: string; sysPromptFailed?: boolean },
): AgentSessionMeta | null {
  const meta = getSession(id);
  if (!meta) return null;
  if (gateway.acpSessionId) meta.acpSessionId = gateway.acpSessionId;
  if (gateway.acpCwd) meta.acpCwd = gateway.acpCwd;
  if (gateway.sysPromptFp !== undefined) meta.sysPromptFp = gateway.sysPromptFp;
  if (gateway.sysPromptFailed !== undefined) meta.sysPromptFailed = gateway.sysPromptFailed;
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
