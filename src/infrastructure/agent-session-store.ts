import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";

// 本地 Agent 会话持久化 (AgentSessionRepository): 每个会话一个聚合目录, 内部数据与工作区物理分离
//
//   data/agent-sessions/                       # 内部数据 (WorkBuddy 不可见)
//     <session-id>/
//       meta.json            # 元信息: id/title/createdAt/updatedAt/acpCwd/model/acpSessionId
//       messages.jsonl       # 历史对话: 每行一条消息 { role, text, tools?, error?, ts }
//     system-prompt.txt      # 全局工作约定 (所有会话注入)
//     model-preference.json  # 模型偏好 (新会话恢复)
//
//   data/agent-workspaces/                      # 工作区 (WorkBuddy 唯一授权区域 = 网关 cwd)
//     <session-id>/
//       artifacts/           # 任务产物 (必须写在这里)
//
// 开发态根目录: <cwd>/data/agent-sessions; 打包态可用 env AGENT_SESSIONS_PATH / AGENT_WORKSPACES_PATH 覆盖。

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
  /** 自动附带的信息 (如工作约定/会话工作目录/模型), 排障用 */
  extra?: { title: string; text: string }[];
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
/** 工作区根: 每个会话一个子目录, 作为注入给 WorkBuddy 的网关 cwd 与产物目录 (与内部数据物理分离) */
const WORKSPACES_ROOT = process.env.AGENT_WORKSPACES_PATH ?? path.join(process.cwd(), "data", "agent-workspaces");
export const WORKSPACES_PATH = WORKSPACES_ROOT;
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
/** 会话工作区目录 (WorkBuddy 唯一授权区域; 网关 cwd 指向这里) */
export function workDirOf(id: string): string {
  return path.join(WORKSPACES_ROOT, id);
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
  migrateWorkspaces();
  ensureRoot();
  const out: AgentSessionMeta[] = [];
  for (const name of readdirSync(ROOT)) {
    if (!existsSync(path.join(ROOT, name, "meta.json"))) continue;
    const meta = readMeta(name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新建会话 (生成唯一 id, 创建工作区与 artifacts) */
export function createSession(acpCwd?: string, model?: string): AgentSessionMeta {
  migrateWorkspaces();
  ensureRoot();
  let id = "";
  do {
    id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  } while (existsSync(dirOf(id)));
  const wd = workDirOf(id);
  mkdirSync(path.join(wd, "artifacts"), { recursive: true });
  const now = Date.now();
  const meta: AgentSessionMeta = {
    id,
    title: `会话 ${new Date(now).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    createdAt: now,
    updatedAt: now,
    acpCwd: acpCwd ?? wd,
    model,
  };
  writeMeta(meta);
  return meta;
}

/** 一次性迁移: 把历史会话的 artifacts 从 sessions/<id> 迁入 workspaces/<id>,
 *  并把 meta.acpCwd 对齐到新工作区 (旧值指向 sessions/<id>)。幂等, 惰性执行一次。 */
let migrated = false;
export function migrateWorkspaces(): void {
  if (migrated) return;
  migrated = true;
  try {
    mkdirSync(WORKSPACES_ROOT, { recursive: true });
    ensureRoot();
    if (!existsSync(ROOT)) return;
    for (const name of readdirSync(ROOT)) {
      const oldArt = path.join(ROOT, name, "artifacts");
      if (!existsSync(oldArt)) continue;
      try {
        const wd = workDirOf(name);
        mkdirSync(path.join(wd, "artifacts"), { recursive: true });
        for (const f of readdirSync(oldArt)) {
          const src = path.join(oldArt, f);
          const dst = path.join(wd, "artifacts", f);
          if (!existsSync(dst)) renameSync(src, dst);
        }
        rmSync(oldArt, { recursive: true, force: true });
        const meta = readMeta(name);
        if (meta && meta.acpCwd !== wd) {
          meta.acpCwd = wd;
          writeMeta(meta);
        }
      } catch {
        // 单个会话迁移失败不影响其他会话
      }
    }
  } catch {
    // 迁移失败不影响运行; 下次惰性重试由 migrated 标志控制, 必要时手动触发
  }
}

export function getSession(id: string): AgentSessionMeta | null {
  migrateWorkspaces();
  return readMeta(id);
}

/** 分页读取结果: messages 升序(时间正序); nextCursor 为更早数据的起始字节偏移, 0 表示无更多; hasMore 是否还有更早 */
export type MessagePage = {
  messages: AgentMessage[];
  nextCursor: number;
  hasMore: boolean;
};

const TAIL_CHUNK = 256 * 1024; // 尾部倒读起始窗口

type LineEntry = { msg: AgentMessage; off: number };

/** 逐行扫描窗口文本: 返回有效消息 + 其绝对字节偏移; 首段残行(窗口起点在行中)自动跳过 */
function scanLines(text: string, base: number): LineEntry[] {
  const out: LineEntry[] = [];
  const n = text.length;
  let i = 0;
  if (base > 0 && text[0] !== "\n") {
    const nl = text.indexOf("\n");
    if (nl === -1) return out; // 整个窗口是同一行的残段
    i = nl + 1;
  }
  while (i < n) {
    const nl = text.indexOf("\n", i);
    const line = nl === -1 ? text.slice(i) : text.slice(i, nl);
    if (line.trim()) {
      try {
        out.push({ msg: JSON.parse(line) as AgentMessage, off: base + i });
      } catch {
        // 坏行(窗口边缘切到行中)跳过
      }
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  return out;
}

/**
 * 分页读取历史消息 — 渐进式加载, 不整读大文件:
 * 从文件尾部(或 cursor 字节偏移)向前倍增读取窗口, 逐行扫描并记录精确字节偏移。
 *  - limit: 返回条数 (默认 50)
 *  - cursor: 字节游标 (来自上次返回的 nextCursor, 指向"更早首条"的行起点); 省略 = 取文件尾部最近 limit 条
 * 返回 messages(升序) + nextCursor(更早首条的行起点偏移; 0=无更多) + hasMore
 */
export function readMessages(id: string, opts?: { limit?: number; cursor?: number }): MessagePage {
  const p = msgsOf(id);
  if (!existsSync(p)) return { messages: [], nextCursor: 0, hasMore: false };
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const size = statSync(p).size;
  if (size === 0) return { messages: [], nextCursor: 0, hasMore: false };
  const end = Math.max(0, Math.min(opts?.cursor === undefined ? size : opts.cursor, size));
  const fd = openSync(p, "r");
  try {
    let win = TAIL_CHUNK;
    let start = Math.max(0, end - win);
    let entries: LineEntry[] = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      start = Math.max(0, end - win);
      const buf = Buffer.alloc(end - start);
      readSync(fd, buf, 0, buf.length, start);
      entries = scanLines(buf.toString("utf8"), start);
      if (entries.length >= limit + 1 || start === 0) break;
      win *= 2;
    }
    const tail = entries.slice(-limit);
    // nextCursor: 本次返回最旧一条的行起点偏移 — 下次从该起点之前继续读取(不含已返回的这条), 不重不漏
    const older = tail.length ? tail[0].off : 0;
    return {
      messages: tail.map((e) => e.msg),
      nextCursor: older,
      hasMore: older > 0,
    };
  } finally {
    closeSync(fd);
  }
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
  // 注意: 不更新 updatedAt — 列表时间 = 最近一条消息时间, 激活/绑定不算消息活动
  writeMeta(meta);
  return meta;
}

export function renameSession(id: string, title: string): AgentSessionMeta | null {
  const meta = getSession(id);
  if (!meta) return null;
  meta.title = title.trim() || meta.title;
  // 不更新 updatedAt — 重命名不算消息活动
  writeMeta(meta);
  return meta;
}

export function deleteSession(id: string): boolean {
  if (!existsSync(dirOf(id))) return false;
  rmSync(dirOf(id), { recursive: true, force: true });
  rmSync(workDirOf(id), { recursive: true, force: true });
  return true;
}

/** 会话工作区内已写入的产物文件 (供展示/清理) */
export function listArtifacts(id: string): { name: string; size: number; mtime: number }[] {
  const d = path.join(workDirOf(id), "artifacts");
  if (!existsSync(d)) return [];
  return readdirSync(d).map((name) => {
    const st = statSync(path.join(d, name));
    return { name, size: st.size, mtime: st.mtimeMs };
  });
}

/**
 * 越界写入审计 (软隔离兜底): 扫描本会话工作区/内部目录之外的所有会话目录,
 * 返回最近 cutoffMs 内有新写入的文件清单。若 WorkBuddy 未遵守「产物只写工作区」的约定,
 * 其越界写入会落在兄弟会话目录上, 此处即可发现。
 */
export function auditWorkspaceViolations(
  id: string,
  opts?: { cutoffMs?: number },
): { path: string; mtime: number; size: number }[] {
  migrateWorkspaces();
  const out: { path: string; mtime: number; size: number }[] = [];
  const cutoff = Date.now() - (opts?.cutoffMs ?? 5 * 60_000);
  const skip = new Set([dirOf(id), workDirOf(id)]);
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (skip.has(p)) continue;
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (st.mtimeMs > cutoff) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
      } catch {
        // 不可读/已删除忽略
      }
    }
  };
  walk(ROOT); // 兄弟会话内部目录 (messages.jsonl 等)
  walk(WORKSPACES_ROOT); // 兄弟工作区
  return out;
}
