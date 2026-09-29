import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { snubyLog } from "@/infrastructure/snuby-log";
import { userDataPath } from "@/infrastructure/user-data-paths";

// 本地 Agent 会话持久化 (AgentSessionRepository): 每会话一个目录
//
//   ~/snuby-workspace-data/agent-sessions/
//     system-prompt.txt · model-preference.json · agent-preference.json
//     <session-id>/
//       meta.json · messages.jsonl · artifacts/   # 网关 cwd = 本目录
//
// 覆盖: AGENT_SESSIONS_PATH / SNUBY_USER_DATA

export type AgentToolRecord = {
  tool: string;
  state?: string;
  detail?: string;
  toolCallId?: string;
  /** 首次见到该 toolCall 的时间 */
  ts?: number;
  /** 最近一次更新时间 (用于耗时) */
  endTs?: number;
};

export type AgentMessage = {
  role: "user" | "assistant";
  text: string;
  tools?: AgentToolRecord[];
  error?: boolean;
  ts: number;
  /** 自动附带的信息 (如工作约定/会话工作目录/模型), 排障用 */
  extra?: { title: string; text: string }[];
  /** 用户附带资源 (落在会话 resources/ 下, 历史可引用绝对路径) */
  resources?: { name: string; path: string; kind: "image" | "file" }[];
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
  /** @deprecated 历史字段, 读写忽略 */
  bindingPurged?: boolean;
  /** @deprecated 历史字段, 读写忽略 */
  abortPurged?: boolean;
};

const ROOT = process.env.AGENT_SESSIONS_PATH ?? userDataPath("agent-sessions");
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
const AGENT_PREF_PATH = path.join(ROOT, "agent-preference.json");

export interface ModelPreference {
  modelId: string;
  name?: string;
  updatedAt: number;
}

/** 全局共享偏好: 模型 + 权限模式/思考深度/沙箱。所有逻辑会话发送时对齐到同一套。 */
export interface AgentPreference {
  modelId?: string;
  modelName?: string;
  config?: Partial<Record<"mode" | "thought_level" | "sandbox", string>>;
  /**
   * 任务不活跃超时 (ms): 距上一次网关响应超过该时长则客户端超时。
   * 缺省 / 非法 → DEFAULT_INACTIVITY_TIMEOUT_MS; 0 表示不启用不活跃超时。
   */
  inactivityTimeoutMs?: number;
  updatedAt: number;
}

/** 默认不活跃超时: 10 分钟 */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
/** 设置页允许范围: 1–60 分钟 */
export const INACTIVITY_TIMEOUT_MIN_MS = 60 * 1000;
export const INACTIVITY_TIMEOUT_MAX_MS = 60 * 60 * 1000;

/** 规范化不活跃超时; undefined → 默认; 0 → 禁用; 其余夹到合法区间 */
export function normalizeInactivityTimeoutMs(raw: unknown): number {
  if (raw === 0 || raw === "0") return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_INACTIVITY_TIMEOUT_MS;
  if (n === 0) return 0;
  return Math.min(INACTIVITY_TIMEOUT_MAX_MS, Math.max(INACTIVITY_TIMEOUT_MIN_MS, Math.round(n)));
}

/** 当前生效的不活跃超时 (读偏好, 带默认) */
export function getInactivityTimeoutMs(): number {
  const d = getAgentPreference();
  if (d?.inactivityTimeoutMs === undefined) return DEFAULT_INACTIVITY_TIMEOUT_MS;
  return normalizeInactivityTimeoutMs(d.inactivityTimeoutMs);
}

/** 读取全局 Agent 偏好 (兼容旧 model-preference.json) */
export function getAgentPreference(): AgentPreference | null {
  try {
    if (existsSync(AGENT_PREF_PATH)) {
      const d = JSON.parse(readFileSync(AGENT_PREF_PATH, "utf8")) as AgentPreference;
      if (d && typeof d === "object") return d;
    }
  } catch {
    // fall through
  }
  try {
    if (!existsSync(MODEL_PREF_PATH)) return null;
    const d = JSON.parse(readFileSync(MODEL_PREF_PATH, "utf8")) as ModelPreference;
    if (!d?.modelId) return null;
    return { modelId: d.modelId, modelName: d.name, updatedAt: d.updatedAt };
  } catch {
    return null;
  }
}

/** 合并写入全局 Agent 偏好 */
export function patchAgentPreference(patch: {
  modelId?: string;
  modelName?: string;
  config?: Partial<Record<"mode" | "thought_level" | "sandbox", string>>;
  inactivityTimeoutMs?: number;
}): AgentPreference {
  mkdirSync(ROOT, { recursive: true });
  const prev = getAgentPreference() ?? { updatedAt: 0 };
  const next: AgentPreference = {
    modelId: patch.modelId ?? prev.modelId,
    modelName: patch.modelName ?? prev.modelName,
    config: { ...(prev.config ?? {}), ...(patch.config ?? {}) },
    inactivityTimeoutMs:
      patch.inactivityTimeoutMs !== undefined
        ? normalizeInactivityTimeoutMs(patch.inactivityTimeoutMs)
        : prev.inactivityTimeoutMs,
    updatedAt: Date.now(),
  };
  if (next.config && Object.keys(next.config).length === 0) delete next.config;
  writeFileSync(AGENT_PREF_PATH, JSON.stringify(next, null, 2), "utf8");
  // 同步旧文件, 避免其他读路径落空
  if (next.modelId) {
    writeFileSync(
      MODEL_PREF_PATH,
      JSON.stringify({ modelId: next.modelId, name: next.modelName, updatedAt: next.updatedAt }, null, 2),
      "utf8",
    );
  }
  return next;
}

/** 读取用户保存的模型偏好 (全局, 新会话恢复用) */
export function getPreferredModel(): ModelPreference | null {
  const d = getAgentPreference();
  if (!d?.modelId) return null;
  return { modelId: d.modelId, name: d.modelName, updatedAt: d.updatedAt };
}

/** 保存模型偏好 (切换模型时写入) */
export function setPreferredModel(modelId: string, name?: string): void {
  patchAgentPreference({ modelId, modelName: name });
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
/** 会话工作目录 (= sessions/<id>; 网关 cwd / artifacts 父目录) */
export function workDirOf(id: string): string {
  return dirOf(id);
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
    if (name.startsWith(".")) continue;
    if (!existsSync(path.join(ROOT, name, "meta.json"))) continue;
    const meta = readMeta(name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新建会话 (生成唯一 id, 会话目录 + artifacts) */
export function createSession(acpCwd?: string, model?: string): AgentSessionMeta {
  ensureRoot();
  let id = "";
  do {
    id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  } while (existsSync(dirOf(id)));
  const wd = workDirOf(id);
  mkdirSync(path.join(wd, "artifacts"), { recursive: true });
  mkdirSync(path.join(wd, "resources"), { recursive: true });
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

export function getSession(id: string): AgentSessionMeta | null {
  return readMeta(id);
}

/** 分页读取结果: messages 升序(时间正序); nextCursor 为更早数据的起始字节偏移, 0 表示无更多; hasMore 是否还有更早 */
export type MessagePage = {
  messages: AgentMessage[];
  nextCursor: number;
  hasMore: boolean;
};

const TAIL_CHUNK = 256 * 1024; // 尾部倒读起始窗口
/** 单次读取上限: 避免历史里超大行把整文件读进内存 */
const TAIL_MAX = 8 * 1024 * 1024;

type LineEntry = { msg: AgentMessage; off: number };

/** 落盘/回读一律丢掉 tools (仅运行时内存展示, 不进历史) */
function stripMessageTools(msg: AgentMessage): AgentMessage {
  if (!msg.tools) return msg;
  const { tools: _drop, ...rest } = msg;
  return rest;
}

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
    let win = Math.min(TAIL_CHUNK, TAIL_MAX);
    let start = Math.max(0, end - win);
    let entries: LineEntry[] = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      start = Math.max(0, end - win);
      const buf = Buffer.alloc(end - start);
      readSync(fd, buf, 0, buf.length, start);
      entries = scanLines(buf.toString("utf8"), start);
      if (entries.length >= limit + 1 || start === 0 || win >= TAIL_MAX) break;
      win = Math.min(win * 2, TAIL_MAX);
    }
    const tail = entries.slice(-limit);
    // nextCursor: 本次返回最旧一条的行起点偏移 — 下次从该起点之前继续读取(不含已返回的这条), 不重不漏
    // 若因 TAIL_MAX 截断导致窗口内消息不足, 仍用 oldest.off 作为游标 (可能 >0)
    const older = tail.length ? tail[0].off : start > 0 ? start : 0;
    return {
      messages: tail.map((e) => stripMessageTools(e.msg)),
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
  // tools 不落盘: 仅运行时 UI 展示
  const clean = stripMessageTools(msg);
  appendFileSync(msgsOf(id), `${JSON.stringify(clean)}\n`, "utf8");
  meta.updatedAt = Date.now();
  if (!meta.title.startsWith("会话 ") && !meta.title.startsWith("「")) {
    // 已有自定义标题, 保留
  } else if (clean.role === "user") {
    const t = clean.text.replace(/\s+/g, " ").trim();
    if (t) meta.title = t.length > 24 ? `${t.slice(0, 24)}…` : t;
  }
  writeMeta(meta);
}

/** 回写网关会话绑定 (acpSessionId/acpCwd) */
export function updateSessionGateway(
  id: string,
  gateway: {
    acpSessionId?: string;
    acpCwd?: string;
    sysPromptFp?: string;
    sysPromptFailed?: boolean;
    /** 网关会话作废时丢掉绑定 (重连 clearAll / load 失败 / session/cancel 毒化后) */
    clearAcpSession?: boolean;
  },
): AgentSessionMeta | null {
  const meta = getSession(id);
  if (!meta) return null;
  if (gateway.clearAcpSession) {
    meta.acpSessionId = undefined;
    meta.sysPromptFp = undefined;
    meta.sysPromptFailed = undefined;
  }
  if (gateway.acpSessionId) meta.acpSessionId = gateway.acpSessionId;
  if (gateway.acpCwd) meta.acpCwd = gateway.acpCwd;
  if (gateway.sysPromptFp !== undefined) meta.sysPromptFp = gateway.sysPromptFp;
  if (gateway.sysPromptFailed !== undefined) meta.sysPromptFailed = gateway.sysPromptFailed;
  // 注意: 不更新 updatedAt — 列表时间 = 最近一条消息时间, 激活/绑定不算消息活动
  writeMeta(meta);
  return meta;
}

/**
 * 重连后调用: 丢掉全部本地会话的网关绑定与约定指纹。
 * 网关 cwd 无效, 上下文也不随 HTTP 连接迁移; 下次发送必须 session/new + 重新注入。
 */
export function clearAllGatewayBindings(): number {
  ensureRoot();
  let n = 0;
  for (const name of readdirSync(ROOT)) {
    if (!existsSync(metaOf(name))) continue;
    const meta = readMeta(name);
    if (!meta) continue;
    if (!meta.acpSessionId && !meta.sysPromptFp && !meta.sysPromptFailed) continue;
    meta.acpSessionId = undefined;
    meta.sysPromptFp = undefined;
    meta.sysPromptFailed = undefined;
    writeMeta(meta);
    n += 1;
  }
  snubyLog("session", `cleared gateway bindings count=${n}`);
  return n;
}

export function renameSession(id: string, title: string): AgentSessionMeta | null {
  const meta = getSession(id);
  if (!meta) return null;
  meta.title = title.trim() || meta.title;
  // 不更新 updatedAt — 重命名不算消息活动
  writeMeta(meta);
  return meta;
}

/** 删除本地会话的全部落盘数据: sessions/<id>/ (含 artifacts) */
export function deleteSession(id: string): boolean {
  const sid = id.trim();
  if (!sid || sid.includes("/") || sid.includes("\\") || sid.includes("..")) return false;
  const sessionDir = dirOf(sid);
  if (!existsSync(sessionDir)) {
    snubyLog("session", `delete miss id=${sid}`);
    return false;
  }
  try {
    rmSync(sessionDir, { recursive: true, force: true });
  } catch (e) {
    snubyLog("session", `delete fail id=${sid}: ${(e as Error).message}`);
    return false;
  }
  const left = existsSync(sessionDir);
  snubyLog("session", `delete ok id=${sid} left=${left}`);
  return !left;
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
 * 越界写入审计 (软隔离兜底): 扫兄弟会话目录近期新写入。
 * 忽略本会话目录、点文件、以及 Snuby 自管的 meta/messages (切换会话/落盘会写这些, 不是 Agent 越界)。
 * 真正要抓的是 Agent 写到了别的会话 artifacts/ 或会话根下的产物文件。
 */
export function auditWorkspaceViolations(
  id: string,
  opts?: { cutoffMs?: number; sinceMs?: number },
): { path: string; mtime: number; size: number }[] {
  const out: { path: string; mtime: number; size: number }[] = [];
  const cutoff = opts?.sinceMs ?? Date.now() - (opts?.cutoffMs ?? 5 * 60_000);
  const ownWork = workDirOf(id);
  const isBookkeeping = (name: string) =>
    name.startsWith(".") || name === "meta.json" || name === "messages.jsonl";
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (isBookkeeping(name)) continue;
      const p = path.join(dir, name);
      if (p === ownWork) continue;
      try {
        const st = statSync(p);
        if (st.isDirectory()) {
          walk(p);
          continue;
        }
        if (st.mtimeMs > cutoff) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
      } catch {
        // 不可读/已删除忽略
      }
    }
  };
  if (!existsSync(ROOT)) return out;
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith(".") || isBookkeeping(name)) continue;
    const p = path.join(ROOT, name);
    try {
      if (!statSync(p).isDirectory()) continue;
      if (p === ownWork) continue;
      walk(p);
    } catch {
      /* ignore */
    }
  }
  return out;
}
