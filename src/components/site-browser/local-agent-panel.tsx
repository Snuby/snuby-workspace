"use client";

// 实验室 · 本地 Agent — WorkBuddy ACP 网关协作测试 demo
// 连接可视化: 网关发现 → 建连 → initialize → 会话, 分阶段可见状态
// 协作演示: 发送任务, WorkBuddy 回复经 ACP SSE 流式渲染 (打字机效果)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useClickOutside } from "@/lib/use-click-outside";
import { openInSystemBrowser } from "@/lib/open-external";
import { setAgentRunningCount } from "@/infrastructure/agent-run-presence";
import PreviewModal, {
  PreviewIconBtn,
  PreviewWebview,
} from "@/components/ui/preview-modal";
import {
  LinkPreviewModal,
  type LinkView,
} from "@/components/preview/link-preview-modal";

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
  models?: { modelId: string; name: string; description?: string; credits?: string }[];
  sessionConfig?: Record<
    string,
    { id: string; name: string; description?: string; currentValue?: string; options?: { value: string; name: string; description?: string }[] }
  >;
  usage?: {
    used: number;
    size: number;
    lastPromptTokens?: number;
    lastCompletionTokens?: number;
    lastTotalTokens?: number;
    sessionTotalTokens?: number;
    lastCost?: number;
    sessionCost?: number;
  };
};

function fmtTokens(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtCost(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return n >= 1 ? n.toFixed(2) : n.toFixed(3);
}


type ToolEv = { tool: string; state: string; detail?: string; toolCallId?: string; ts?: number; endTs?: number };

const TOOL_DETAIL_MAX = 240;

function clipToolDetail(s: string | undefined): string {
  if (!s) return "";
  return s.length > TOOL_DETAIL_MAX ? `${s.slice(0, TOOL_DETAIL_MAX)}…` : s;
}

/** 流式 tool 更新按 toolCallId 合并, 避免数千次 push 把历史撑爆 */
function upsertTool(tools: ToolEv[], ev: { tool?: string; state?: string; detail?: string; toolCallId?: string }): void {
  const id = ev.toolCallId ?? "";
  const detail = clipToolDetail(ev.detail);
  const now = Date.now();
  const idx = id ? tools.findIndex((t) => t.toolCallId === id) : -1;
  if (idx >= 0) {
    const prev = tools[idx];
    tools[idx] = {
      ...prev,
      tool: ev.tool || prev.tool,
      state: ev.state || prev.state,
      detail: detail || prev.detail,
      endTs: now,
    };
    return;
  }
  tools.push({
    tool: ev.tool ?? "",
    state: ev.state ?? "",
    detail,
    toolCallId: id,
    ts: now,
    endTs: now,
  });
}
/** 本地会话元信息 (磁盘持久化) */
type SessionInfo = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  acpSessionId?: string;
  /** 本地会话工作目录 (与注入给 WorkBuddy 的约定一致) */
  acpCwd?: string;
};

/** 会话维度的网关态 (per-session): 从 AgentStatus 拆出的非全局字段。
 * 全局字段 (phase/discovered/lastError) 保留在 status; 这里只放「归属于某个会话」的状态。 */
type GatewayInfo = {
  connectionIdMasked?: string;
  protocolVersion?: number;
  acpSessionId?: string;
  authMethods?: string[];
  models?: AgentStatus["models"];
  sessionConfig?: AgentStatus["sessionConfig"];
  usage?: AgentStatus["usage"];
};

/** 会话视图态 (AgentSessionUi): 该会话的内存消息缓存与分页游标。
 * 切走/切回不重拉磁盘: 已加载的直接复用; LRU 超限淘汰非活跃项 (运行中不淘汰)。 */
type SessionUi = {
  msgs: Msg[];
  cursor: number | null;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  lastUsed: number;
};

/** 会话视图 LRU 上限: 内存中最多保留的会话消息缓存数 (超出淘汰最久未用; 运行中强制保活) */
const UI_CACHE_MAX = 10;

/** 磁盘存储的消息形态 (messages.jsonl 单行) */
type StoredMsg = {
  role: "user" | "assistant";
  text: string;
  tools?: { tool: string; state?: string; detail?: string; toolCallId?: string; ts?: number; endTs?: number }[];
  error?: boolean;
  interrupted?: boolean;
  ts: number;
  extra?: { title: string; text: string }[];
  resources?: MsgResource[];
};

type MsgResource = { name: string; path: string; kind: "image" | "file" };

/** 磁盘消息 → 面板消息 */
function storedToMsg(m: StoredMsg): Msg {
  return {
    id: m.ts,
    role: m.role === "user" ? "user" : "agent",
    text: m.text,
    tools: (m.tools ?? []).map((t) => ({
      tool: t.tool,
      state: t.state ?? "",
      detail: clipToolDetail(t.detail),
      toolCallId: t.toolCallId ?? "",
      ts: t.ts ?? 0,
      endTs: t.endTs ?? t.ts ?? 0,
    })),
    error: m.error,
    interrupted: m.interrupted,
    extra: m.extra,
    resources: m.resources,
    streaming: false,
    finishedAt: m.ts,
    ts: m.ts,
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
  /** 超时等附属说明; 有正文时不覆盖 text, 单独展示红条 */
  errorNote?: string;
  interrupted?: boolean;
  startedAt?: number;
  finishedAt?: number;
  ts?: number;
  extra?: { title: string; text: string }[];
  /** 用户附带资源 (会话 resources/ 绝对路径) */
  resources?: MsgResource[];
};

const PHASE_META: Record<Phase, { label: string; color: string; dot: string }> = {
  idle: { label: "未连接", color: "bg-ink-faint/20 text-ink-faint", dot: "bg-ink-faint" },
  discovering: { label: "正在发现网关…", color: "bg-ink-faint/20 text-ink-faint", dot: "bg-ink-faint animate-pulse" },
  connecting: { label: "正在建立连接…", color: "bg-accent-soft text-accent-deep", dot: "bg-accent animate-pulse" },
  connected: { label: "已连接 WorkBuddy 网关", color: "bg-down-soft text-down", dot: "bg-down" },
  error: { label: "连接失败", color: "bg-up-soft text-up", dot: "bg-up" },
};

/** 徽章文案: idle 时区分「未发现」与「已发现但未连接」 */
function phaseBadge(
  phase: Phase,
  discovered?: AgentStatus["discovered"],
): { label: string; color: string; dot: string } {
  if (phase === "idle") {
    if (discovered) {
      return {
        label: "已检测到网关，未连接",
        color: "bg-accent-soft text-accent-deep",
        dot: "bg-accent",
      };
    }
    return {
      label: "未检测到 WorkBuddy 网关",
      color: "bg-ink-faint/20 text-ink-faint",
      dot: "bg-ink-faint",
    };
  }
  return PHASE_META[phase];
}

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

/** 工具名 → 用户可读说明 */
const TOOL_LABEL: Record<string, string> = {
  Bash: "运行终端命令",
  Shell: "运行终端命令",
  WebFetch: "访问网页",
  WebSearch: "搜索网页",
  Read: "读取文件",
  Write: "写入文件",
  Edit: "编辑文件",
  Glob: "查找文件",
  Grep: "搜索文件内容",
  AskUserQuestion: "向你提问",
};

function friendlyToolLabel(title: string): string {
  const t = title.trim();
  if (!t) return "使用工具";
  if (TOOL_LABEL[t]) return TOOL_LABEL[t];
  const key = Object.keys(TOOL_LABEL).find((k) => t.toLowerCase().includes(k.toLowerCase()));
  return key ? TOOL_LABEL[key] : t;
}

function friendlyOptionLabel(o: { optionId: string; name: string; kind?: string }): string {
  const id = `${o.optionId} ${o.kind ?? ""} ${o.name}`.toLowerCase();
  if (/allow_always|allow-always|always/.test(id)) return "本会话始终允许";
  if (/allow_once|allow-once|allow_session/.test(id) || /^allow$/.test(o.optionId)) return "允许一次";
  if (/reject|deny|skip|取消|拒绝/.test(id)) return "拒绝";
  // 网关已给中文名则直接用
  if (/[\u4e00-\u9fff]/.test(o.name)) return o.name;
  return o.name || o.optionId;
}

// 输入框自动撑开: 最多 MAX_ROWS 行, 超出才滚动
const INPUT_MAX_ROWS = 6;
const INPUT_LINE_H = 20; // 13px 字号 + line-height
const INPUT_MAX_H = INPUT_MAX_ROWS * INPUT_LINE_H + 16; // 上下 padding py-2 = 16px

/** 编辑框草稿: 按会话暂存, 切模块/切会话/面板重挂均可恢复 (不落盘到磁盘) */
const INPUT_DRAFT_SS_KEY = "snuby.agent.inputDrafts";
const inputDraftMem = new Map<string, string>();

function readInputDraft(sid: string): string {
  if (inputDraftMem.has(sid)) return inputDraftMem.get(sid) ?? "";
  try {
    const all = JSON.parse(sessionStorage.getItem(INPUT_DRAFT_SS_KEY) || "{}") as Record<string, string>;
    const v = typeof all[sid] === "string" ? all[sid] : "";
    inputDraftMem.set(sid, v);
    return v;
  } catch {
    return "";
  }
}

function writeInputDraft(sid: string, text: string): void {
  inputDraftMem.set(sid, text);
  try {
    const raw = sessionStorage.getItem(INPUT_DRAFT_SS_KEY);
    const all = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    if (text) all[sid] = text;
    else delete all[sid];
    sessionStorage.setItem(INPUT_DRAFT_SS_KEY, JSON.stringify(all));
  } catch {
    // sessionStorage 不可用时仍保留内存暂存
  }
}

export default function LocalAgentPanel() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const inputValueRef = useRef("");
  inputValueRef.current = input;
  /** 待发送附件 (本地绝对路径; Electron 直接取 file.path, 否则先上传到会话 attachments/) */
  type PendingAttach = {
    id: string;
    name: string;
    kind: "image" | "file";
    path?: string;
    previewUrl?: string;
    file?: File;
  };
  const [attachments, setAttachments] = useState<PendingAttach[]>([]);
  /** 输入框上方待发送图片的轻量预览 */
  const [attachImgPreview, setAttachImgPreview] = useState<{ url: string; name: string } | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const filePickRef = useRef<HTMLInputElement | null>(null);
  const imagePickRef = useRef<HTMLInputElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  /** 运行中/排队中的会话 (全局串行: 同时可有多个 queued, 至多一个真正执行) */
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  /** 排队提示: sessionId -> 前序会话标题 */
  const [queueHint, setQueueHint] = useState<Record<string, string | null>>({});
  /** 每个运行会话的流式累积状态: sessionId -> RunState */
  type RunState = {
    sessionId: string;
    msgId: number;
    text: string;
    tools: ToolEv[];
    thinking: boolean;
    error?: boolean;
    interrupted?: boolean;
    streaming: boolean;
    startedAt: number;
    ac: AbortController;
    /** 仍在全局队列等待 (尚未收到 running) */
    queued?: boolean;
    /** 超时等附属说明 (保留已流出正文) */
    errorNote?: string;
  };
  const runsRef = useRef<Map<string, RunState>>(new Map());
  /** 正在预览的本地 markdown 文档 (点击 📄 打开) */
  const [preview, setPreview] = useState<DocPreview | null>(null);
  /** 预览导航: stack + index, 支持前进/后退 */
  const [linkNav, setLinkNav] = useState<{ stack: LinkView[]; index: number }>({ stack: [], index: 0 });
  const linkView = linkNav.stack.length
    ? linkNav.stack[Math.min(linkNav.index, linkNav.stack.length - 1)] ?? null
    : null;
  const previewCanBack = linkNav.index > 0;
  const previewCanForward = linkNav.index < linkNav.stack.length - 1;
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; src: string; name: string } | null>(null);
  const [ctxToast, setCtxToast] = useState<string | null>(null);
  /** 本地会话: 列表 / 当前会话 / 历史加载中 */
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [histLoaded, setHistLoaded] = useState(false);
  /** 侧栏标题就地编辑 */
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editTitleRef = useRef<HTMLInputElement | null>(null);
  /** 侧栏 ⋯ 菜单 / 删除确认 */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  useClickOutside(sessionMenuRef, menuFor !== null, () => setMenuFor(null));
  /** per-session 视图缓存 (AgentSessionRegistry 前端侧): sessionId -> SessionUi */
  const uiRef = useRef<Map<string, SessionUi>>(new Map());
  /** per-session 网关态: sessionId -> GatewayInfo (status 拆分: 非全局字段归会话) */
  const gwRef = useRef<Map<string, GatewayInfo>>(new Map());
  /** 连接级共享: 模型/配置/用量 (单 ACP 连接, 新建会话继承, 避免模型选择消失) */
  const sharedGwRef = useRef<GatewayInfo | null>(null);
  /** 当前激活会话的网关态视图 (渲染用) */
  const [gw, setGw] = useState<GatewayInfo | null>(null);
  /** 越界写入审计提示 (任务结束后检测到其他会话目录被写) */
  const [auditWarn, setAuditWarn] = useState<string | null>(null);
  /** 流式中的最新 agent 消息 (供结束落盘) */
  /** currentId 的 ref 镜像 (供异步流式闭包读取最新值) */
  const currentIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0); // 会话加载代际号: 切会话/清空列表时递增, 过期的异步加载结果直接丢弃, 防止快速切换时渲染串台
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);
  /** 流式自动滚底开关: 用户上滚查看历史时暂停跟随, 滚回底部自动恢复 */
  const followRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  /** 消息滚动容器 (渐进加载: 滚到顶部拉更早历史) */
  const msgBoxRef = useRef<HTMLDivElement | null>(null);
  /** 是否正在 prepend 更早历史 (抑制自动滚底, 保持视口) */
  const prependRef = useRef(false);
  /** 历史加载(切会话/首屏)标记: 该次 msgs 变化由加载函数手动瞬跳到底, 不触发平滑滚动 */
  const histPendingRef = useRef(false);
  /** 分页游标: 当前已加载消息中最早的字节偏移; null=未加载 */
  const [msgCursor, setMsgCursor] = useState<number | null>(null);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 状态信息下拉 */
  const infoRef = useRef<HTMLDivElement | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  /** 模型外其余会话配置 (权限/思考深度/沙箱等) 对话框 */
  const [configOpen, setConfigOpen] = useState(false);
  /** 网关工具权限请求 (Always Ask 时弹窗) */
  const [permAsk, setPermAsk] = useState<{
    requestId: string | number;
    localSessionId: string;
    toolTitle: string;
    toolCallId?: string;
    detail?: string;
    options: { optionId: string; name: string; kind?: string }[];
    /** 网关已结束本轮 (勿再应答), 弹窗留到用户关闭, 避免「闪一下消失」 */
    stale?: boolean;
    /** 网关已用该 stopReason 结束本轮 */
    stopReason?: string;
  } | null>(null);
  const [permBusy, setPermBusy] = useState(false);
  const permAnsweredRef = useRef(false);

  // 任务运行中轮询未决权限 (NDJSON 在服务端阻塞等待时可能迟迟刷不出 permission 事件)
  useEffect(() => {
    setAgentRunningCount(runningIds.size);
  }, [runningIds]);
  useEffect(() => () => setAgentRunningCount(0), []);

  useEffect(() => {
    if (runningIds.size === 0) return;
    let alive = true;
    const tick = async () => {
      for (const sid of runningIds) {
        if (!alive) return;
        try {
          const r = await fetch(`/api/agent/permission?localSessionId=${encodeURIComponent(sid)}`, {
            cache: "no-store",
          });
          const j = (await r.json()) as {
            pending?: {
              requestId: string | number;
              toolTitle: string;
              toolCallId?: string;
              detail?: string;
              options: { optionId: string; name: string; kind?: string }[];
            }[];
          };
          const p = j.pending?.[0];
          if (p) {
            setPermAsk((prev) => {
              if (prev && prev.localSessionId === sid && String(prev.requestId) === String(p.requestId)) {
                return prev.detail || !p.detail ? prev : { ...prev, detail: p.detail };
              }
              permAnsweredRef.current = false;
              return {
                requestId: p.requestId,
                localSessionId: sid,
                toolTitle: p.toolTitle,
                toolCallId: p.toolCallId,
                detail: p.detail,
                options: p.options ?? [],
              };
            });
            return;
          }
          setPermAsk((prev) => {
            if (!prev || prev.localSessionId !== sid || prev.stale || permAnsweredRef.current) return prev;
            return { ...prev, stale: true };
          });
        } catch {
          // 忽略
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runningIds]);

  useClickOutside(infoRef, infoOpen, () => setInfoOpen(false));

  /** 点击 📄 打开本地 markdown 文档: 拉取文本并内联预览 */
  const openDoc = useCallback((path: string, title: string, opts?: { push?: boolean }) => {
    const next: LinkView = { kind: "file", path, title, loading: true };
    setLinkNav((prev) => {
      if (!opts?.push || !prev.stack.length) return { stack: [next], index: 0 };
      const cur = Math.min(prev.index, prev.stack.length - 1);
      return { stack: [...prev.stack.slice(0, cur + 1), next], index: cur + 1 };
    });
  }, []);

  /** 链接点击: http(s) → webview 弹窗; 本地路径 → 文件弹窗 */
  const openLink = useCallback((raw: string, opts?: { push?: boolean }) => {
    const url = raw.replace(/^file:\/\//, "");
    let next: LinkView | null = null;
    if (/^https?:\/\//i.test(url)) {
      next = { kind: "url", url, title: url };
    } else if (/^(\/Users\/|\/home\/|\/private\/|\/tmp\/)/.test(url)) {
      const name = url.split("/").pop() ?? url;
      next = { kind: "file", path: url, title: name, loading: true };
    } else {
      window.open(url, "_blank", "noopener");
      return;
    }
    setLinkNav((prev) => {
      if (!opts?.push || !prev.stack.length) return { stack: [next!], index: 0 };
      const cur = Math.min(prev.index, prev.stack.length - 1);
      return { stack: [...prev.stack.slice(0, cur + 1), next!], index: cur + 1 };
    });
  }, []);

  /** 预览内跳转: 截断前进历史后压入 */
  const openDocInPreview = useCallback(
    (path: string, title: string) => openDoc(path, title, { push: true }),
    [openDoc],
  );
  const openLinkInPreview = useCallback(
    (raw: string) => openLink(raw, { push: true }),
    [openLink],
  );
  const previewGoBack = useCallback(() => {
    setLinkNav((prev) => ({ ...prev, index: Math.max(0, prev.index - 1) }));
  }, []);
  const previewGoForward = useCallback(() => {
    setLinkNav((prev) => ({
      ...prev,
      index: Math.min(prev.stack.length - 1, prev.index + 1),
    }));
  }, []);
  const closePreview = useCallback(() => setLinkNav({ stack: [], index: 0 }), []);

  /** 「📄 文件名」补偿定位: 用当前会话工作目录做候选 (产物都写在工作区) */
  const docHints = useMemo(() => {
    const s = sessions.find((x) => x.id === currentId);
    return s?.acpCwd ? [s.acpCwd] : [];
  }, [sessions, currentId]);

  const phase = status?.phase ?? "idle";

  /** 把右键菜单里的 src 还原成可 fetch 的地址 (勿把 /Users/... 当同源路径) */
  const resolveImageFetchUrl = (src: string): string => {
    if (
      src.startsWith("blob:") ||
      src.startsWith("data:") ||
      src.startsWith("/api/") ||
      /^https?:\/\//i.test(src)
    ) {
      return src;
    }
    const cleaned = src.replace(/^file:\/\//, "");
    if (cleaned.startsWith("/")) {
      return `/api/local-file?path=${encodeURIComponent(cleaned)}`;
    }
    return src;
  };

  /** 图片右键: 拦截 → 自定义菜单 (下载/复制); 非图片保留浏览器默认菜单 */
  const onCtxMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const img = t.closest("img");
    if (!img) {
      setCtxMenu(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const src = img.getAttribute("src") ?? "";
    const dataPath = img.getAttribute("data-local-path") ?? "";
    let name = img.getAttribute("alt") || "";
    let real = src;
    if (dataPath) {
      real = dataPath;
      name = name || dataPath.split("/").pop() || "image.png";
    } else if (src.startsWith("/api/local-file")) {
      try {
        real = decodeURIComponent(new URL(src, window.location.origin).searchParams.get("path") ?? src);
      } catch {
        real = src;
      }
      name = name || real.split("/").pop() || "image.png";
    } else if (src.startsWith("blob:")) {
      name = name || "image.png";
      real = src; // fetch blob: 直接可用
    } else {
      try {
        name = name || new URL(src, window.location.origin).pathname.split("/").pop() || "image.png";
      } catch {
        name = name || "image.png";
      }
    }
    if (!/\.\w{2,5}$/i.test(name)) name = `${name}.png`;
    setCtxMenu({ x: e.clientX, y: e.clientY, src: real, name });
  };

  /** 下载图片: 同源/blob fetch → a[download]; 失败则新窗口打开 */
  const downloadImage = useCallback(async () => {
    const m = ctxMenu;
    if (!m) return;
    try {
      const url = resolveImageFetchUrl(m.src);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m.name || "image.png";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      setCtxMenu(null);
      setCtxToast("已开始下载");
      window.setTimeout(() => setCtxToast(null), 2000);
    } catch {
      setCtxMenu(null);
      setCtxToast("下载失败");
      window.setTimeout(() => setCtxToast(null), 2000);
      try {
        window.open(resolveImageFetchUrl(m.src), "_blank");
      } catch {
        /* ignore */
      }
    }
  }, [ctxMenu]);

  /** 复制图片: fetch → canvas 转 png → 写剪贴板 */
  const copyImage = useCallback(async () => {
    const m = ctxMenu;
    if (!m) return;
    try {
      const url = resolveImageFetchUrl(m.src);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      // Chromium: image/png 可直接写剪贴板; 其它类型走 canvas 转 png
      if (blob.type === "image/png") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        const img = new Image();
        const obj = URL.createObjectURL(blob);
        img.src = obj;
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("图片解码失败"));
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const cx = canvas.getContext("2d");
        if (!cx) throw new Error("canvas 不可用");
        cx.drawImage(img, 0, 0);
        URL.revokeObjectURL(obj);
        const png = await new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("转码失败"))), "image/png"),
        );
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      }
      setCtxMenu(null);
      setCtxToast("图片已复制到剪贴板");
      window.setTimeout(() => setCtxToast(null), 2000);
    } catch {
      setCtxMenu(null);
      setCtxToast("复制失败");
      window.setTimeout(() => setCtxToast(null), 2000);
    }
  }, [ctxMenu]);

  /** 切会话/首屏: 恢复自动跟随并滚到底 (双 rAF + 定时兜底), 无动画 */
  const scrollBottomStable = useCallback(() => {
    followRef.current = true;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }));
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }));
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 200);
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 600);
  }, []);

  /** 从 AgentStatus 提取会话维度网关态 (全局字段留在 status) */
  const toGw = (st: AgentStatus | null | undefined): GatewayInfo | null =>
    st
      ? {
          connectionIdMasked: st.connectionIdMasked,
          protocolVersion: st.protocolVersion,
          acpSessionId: st.acpSessionId,
          authMethods: st.authMethods,
          models: st.models,
          sessionConfig: st.sessionConfig,
          usage: st.usage,
        }
      : null;

  /** 会话视图缓存读写 (Registry): 不存在则创建空 Ui */
  const uiOf = (id: string): SessionUi => {
    const m = uiRef.current;
    let u = m.get(id);
    if (!u) {
      u = { msgs: [], cursor: null, hasMore: false, loaded: false, loading: false, lastUsed: 0 };
      m.set(id, u);
    }
    return u;
  };
  /** LRU 触达 + 超限淘汰 (运行中会话保活不淘汰; keepId 永不被淘汰) */
  const evictUi = (keepId: string) => {
    const m = uiRef.current;
    if (m.size <= UI_CACHE_MAX) return;
    const idle = [...m.entries()]
      .filter(([k, u]) => k !== keepId && !runningIds.has(k) && u.loaded)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k] of idle.slice(0, m.size - UI_CACHE_MAX)) m.delete(k);
  };
  /** 提交消息变更到会话缓存; 若该会话是激活会话则同步渲染视图 */
  const commitMsgs = (id: string, updater: (prev: Msg[]) => Msg[]) => {
    const u = uiOf(id);
    u.msgs = updater(u.msgs);
    u.lastUsed = Date.now();
    evictUi(id);
    if (id === currentIdRef.current) setMsgs(u.msgs);
  };
  /** 提交分页游标变更到会话缓存; 激活会话则同步渲染 */
  const commitPage = (id: string, patch: Partial<Pick<SessionUi, "cursor" | "hasMore" | "loaded" | "loading">>) => {
    const u = uiOf(id);
    if (patch.cursor !== undefined) u.cursor = patch.cursor;
    if (patch.hasMore !== undefined) u.hasMore = patch.hasMore;
    if (patch.loaded !== undefined) u.loaded = patch.loaded;
    if (patch.loading !== undefined) u.loading = patch.loading;
    u.lastUsed = Date.now();
    evictUi(id);
    if (id === currentIdRef.current) {
      setMsgCursor(u.cursor);
      setHasMoreMsgs(u.hasMore);
    }
  };
  /** 合并运行中任务的流式半成品到会话缓存 (切回继续渲染, 不中断) */
  const mergeRunIntoView = (id: string) => {
    const run = runsRef.current.get(id);
    if (!run) return;
    const u = uiOf(id);
    if (u.msgs.some((m) => m.id === run.msgId)) return;
    u.msgs = [
      ...u.msgs,
      {
        id: run.msgId,
        role: "agent",
        text: run.text,
        tools: run.tools,
        thinking: run.thinking,
        error: run.error,
        interrupted: run.interrupted,
        streaming: true,
        startedAt: run.startedAt,
        ts: run.startedAt,
      },
    ];
    if (id === currentIdRef.current) setMsgs(u.msgs);
  };
  /** 合并连接级网关态: 新建会话无缓存时继承 shared, 避免模型选择消失 */
  const mergeGw = (incoming: GatewayInfo | null | undefined, fallback?: GatewayInfo | null): GatewayInfo => {
    const base = fallback ?? sharedGwRef.current ?? {};
    const g = incoming ?? {};
    const hasCfg = !!g.sessionConfig && Object.keys(g.sessionConfig).length > 0;
    const merged: GatewayInfo = {
      ...base,
      ...g,
      sessionConfig: hasCfg ? g.sessionConfig : base.sessionConfig,
      models: g.models?.length ? g.models : base.models,
      usage: g.usage ?? base.usage,
    };
    if (merged.sessionConfig && Object.keys(merged.sessionConfig).length > 0) {
      sharedGwRef.current = merged;
    }
    return merged;
  };

  /** 拉取网关态并写入会话缓存; 模型/配置按连接级合并继承 */
  const loadGw = async (id: string) => {
    try {
      const r = await fetch(`/api/agent/status?sid=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = (await r.json()) as { status: AgentStatus };
      const merged = mergeGw(toGw(j.status));
      gwRef.current.set(id, merged);
      if (id === currentIdRef.current) setGw(merged);
    } catch {
      // 忽略; 下次激活/任务时再刷新
    }
  };
  /** 加载会话消息到缓存并设为激活视图; 缓存命中直接复用 (不重拉磁盘) */
  const loadIntoUi = async (id: string, opts?: { scroll?: boolean }) => {
    const u = uiOf(id);
    if (u.loaded && !u.loading) {
      // 缓存命中: 直接激活视图
      histPendingRef.current = true;
      setMsgs(u.msgs);
      setMsgCursor(u.cursor);
      setHasMoreMsgs(u.hasMore);
      u.lastUsed = Date.now();
      evictUi(id);
      mergeRunIntoView(id);
      if (opts?.scroll) scrollBottomStable();
      return;
    }
    if (u.loading) return; // 正在加载, 避免并发重复拉取
    u.loading = true;
    u.lastUsed = Date.now();
    const seq = ++loadSeqRef.current;
    try {
      const r = await fetch(`/api/agent/sessions/${id}/messages?limit=50`, { cache: "no-store" });
      const j = (await r.json()) as { messages: StoredMsg[]; nextCursor?: number; hasMore?: boolean };
      if (seq !== loadSeqRef.current) return; // 期间切了会话, 丢弃过期加载
      u.msgs = (j.messages ?? []).map(storedToMsg);
      u.cursor = typeof j.nextCursor === "number" ? j.nextCursor : null;
      u.hasMore = !!j.hasMore;
      u.loaded = true;
      mergeRunIntoView(id);
      u.lastUsed = Date.now();
      evictUi(id);
      if (id === currentIdRef.current) {
        histPendingRef.current = true;
        setMsgs(u.msgs);
        setMsgCursor(u.cursor);
        setHasMoreMsgs(u.hasMore);
        if (opts?.scroll) scrollBottomStable();
      }
    } catch {
      // 网络失败忽略; 缓存保持未加载, 下次切换再试
    } finally {
      u.loading = false;
    }
  };

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

  // 会话列表先亮出来; 最近会话历史异步加载, 不堵侧栏
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/agent/sessions", { cache: "no-store" });
        const j = (await r.json()) as { sessions: SessionInfo[] };
        const list = j.sessions ?? [];
        setSessions(list);
        setHistLoaded(true);
        if (list.length) {
          setCurrentId(list[0].id);
          void loadIntoUi(list[0].id, { scroll: true });
        } else {
          void createLocalSession();
        }
      } catch {
        setHistLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 新建本地会话 */
  const createLocalSession = async () => {
    try {
      const r = await fetch("/api/agent/sessions", { method: "POST" });
      const j = (await r.json()) as { session: SessionInfo };
      setSessions((x) => [j.session, ...x]);
      // 同步 ref, 避免紧接着 loadGw 时仍指向旧会话导致 setGw 被跳过
      currentIdRef.current = j.session.id;
      setCurrentId(j.session.id);
      ++loadSeqRef.current;
      const u = uiOf(j.session.id);
      u.msgs = [];
      u.cursor = null;
      u.hasMore = false;
      u.loaded = true;
      u.lastUsed = Date.now();
      setMsgs([]);
      setMsgCursor(null);
      setHasMoreMsgs(false);
      // 继承连接级模型/配置, 再拉一次状态 (新建会话本身没有独立网关态)
      const seeded = mergeGw(null, sharedGwRef.current ?? gw);
      gwRef.current.set(j.session.id, seeded);
      setGw(seeded);
      if (phase === "connected") void loadGw(j.session.id);
    } catch {
      // 落盘失败不阻塞本地会话
    }
  };

  /** 切换本地会话: 纯视图操作 (AC-7) — 不触发网关 activate/load; 对齐仅在发送时 */
  const switchSession = async (id: string) => {
    if (id === currentId) return;
    currentIdRef.current = id;
    setCurrentId(id);
    // 先展示已有/继承的网关态, 避免切换瞬间模型选择消失
    const cached = gwRef.current.get(id);
    setGw(mergeGw(cached ?? null, sharedGwRef.current ?? gw));
    await loadIntoUi(id, { scroll: true });
    // 仅刷新网关态缓存 (status?sid=, 只读, 不改网关活动会话)
    if (phase === "connected") void loadGw(id);
  };

  /** 开始编辑会话标题 */
  const beginRename = (id: string, title: string) => {
    setEditingTitleId(id);
    setEditTitle(title);
    requestAnimationFrame(() => {
      editTitleRef.current?.focus();
      editTitleRef.current?.select();
    });
  };

  /** 提交重命名; 空标题视为取消 */
  const commitRename = async (id: string) => {
    const next = editTitle.trim();
    setEditingTitleId(null);
    const prev = sessions.find((s) => s.id === id)?.title ?? "";
    if (!next || next === prev) return;
    // 乐观更新
    setSessions((all) => all.map((s) => (s.id === id ? { ...s, title: next } : s)));
    try {
      const r = await fetch(`/api/agent/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!r.ok) {
        setSessions((all) => all.map((s) => (s.id === id ? { ...s, title: prev } : s)));
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(j.error ?? "重命名失败");
        return;
      }
      const j = (await r.json()) as { session?: SessionInfo };
      if (j.session?.title) {
        setSessions((all) => all.map((s) => (s.id === id ? { ...s, title: j.session!.title } : s)));
      }
    } catch {
      setSessions((all) => all.map((s) => (s.id === id ? { ...s, title: prev } : s)));
      alert("重命名失败：本地服务无响应");
    }
  };

  /** 打开删除确认 (AC-9: 运行/排队中拦截) */
  const askRemoveSession = (id: string) => {
    setMenuFor(null);
    if (runningIds.has(id) || runsRef.current.has(id)) {
      alert("会话任务进行中或排队中，请先停止/取消后再删除");
      return;
    }
    setDeleteConfirmId(id);
  };

  /** 确认后删除本地会话 */
  const removeSession = async (id: string) => {
    setDeleteConfirmId(null);
    if (runningIds.has(id) || runsRef.current.has(id)) {
      alert("会话任务进行中或排队中，请先停止/取消后再删除");
      return;
    }
    try {
      const r = await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
      if (r.status === 409) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(j.error ?? "会话忙碌中，无法删除");
        return;
      }
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(j.error ?? "删除失败");
        return;
      }
    } catch {
      alert("删除失败：本地服务无响应");
      return;
    }
    uiRef.current.delete(id);
    gwRef.current.delete(id);
    setQueueHint((prev) => {
      if (!(id in prev)) return prev;
      const n = { ...prev };
      delete n[id];
      return n;
    });
    // 以服务端列表为准, 避免本地过滤与磁盘不一致
    let rest = sessions.filter((x) => x.id !== id);
    try {
      const lr = await fetch("/api/agent/sessions", { cache: "no-store" });
      const lj = (await lr.json()) as { sessions?: SessionInfo[] };
      if (Array.isArray(lj.sessions)) rest = lj.sessions;
    } catch {
      // 用本地过滤结果
    }
    setSessions(rest);
    if (id === currentId) {
      if (rest.length) void switchSession(rest[0].id);
      else void createLocalSession();
    }
  };

  /** 对话后把该会话顶到列表前 (与服务端 updatedAt 排序一致) */
  const bumpSessionActivity = (sid: string, userText?: string) => {
    const now = Date.now();
    setSessions((list) => {
      const next = list.map((s) => {
        if (s.id !== sid) return s;
        let title = s.title;
        // 与 appendMessage 同规则: 默认「会话 …」标题用首条用户消息截断
        if (userText && (title.startsWith("会话 ") || title.startsWith("「"))) {
          const t = userText.replace(/\s+/g, " ").trim();
          if (t) title = t.length > 24 ? `${t.slice(0, 24)}…` : t;
        }
        return { ...s, updatedAt: now, title };
      });
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  /** 落盘一条消息到指定会话 (tools 仅内存展示, 不写盘) */
  const persist = (sid: string, role: "user" | "assistant", msg: Partial<Msg>) => {
    if (!sid) return;
    void fetch(`/api/agent/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role,
        text: msg.text ?? "",
        error: msg.error,
        interrupted: msg.interrupted,
        ts: Date.now(),
        extra: msg.extra,
        resources: msg.resources,
      }),
    });
    bumpSessionActivity(sid, role === "user" ? msg.text : undefined);
  };

  /** 在系统文件管理器中打开当前会话工作目录 */
  const openSessionFolder = async () => {
    const cwd = sessions.find((s) => s.id === currentId)?.acpCwd;
    if (!cwd) {
      setCtxToast("当前会话尚无工作目录");
      window.setTimeout(() => setCtxToast(null), 2000);
      return;
    }
    try {
      const r = await fetch("/api/agent/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: cwd }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    } catch (e) {
      setCtxToast(e instanceof Error ? e.message : "打开文件夹失败");
      window.setTimeout(() => setCtxToast(null), 2000);
    }
  };

  /** 渐进加载: 拉取当前会话更早的历史 (IM 式上拉) */
  const loadMoreMsgs = async () => {
    if (!currentId || loadingMore || !hasMoreMsgs || msgCursor === null) return;
    setLoadingMore(true);
    const box = msgBoxRef.current;
    const prevScrollTop = box?.scrollTop ?? 0;
    const prevScrollHeight = box?.scrollHeight ?? 0;
    try {
      const seq = loadSeqRef.current;
      const r = await fetch(`/api/agent/sessions/${currentId}/messages?limit=50&cursor=${msgCursor}`, { cache: "no-store" });
      const j = (await r.json()) as { messages: StoredMsg[]; nextCursor?: number; hasMore?: boolean };
      if (seq !== loadSeqRef.current) return; // 期间切了会话, 丢弃过期分页
      const older = (j.messages ?? []).map(storedToMsg);
      prependRef.current = true;
      commitMsgs(currentId, (prev) => [...older, ...prev]);
      commitPage(currentId, {
        cursor: typeof j.nextCursor === "number" ? j.nextCursor : null,
        hasMore: !!j.hasMore,
      });
      // 补偿滚动位置: 内容增高后保持视口不跳动
      requestAnimationFrame(() => {
        const el = msgBoxRef.current;
        if (el) el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
      });
    } catch {
      // 忽略; 下次滚动再试
    } finally {
      setLoadingMore(false);
    }
  };

  /** 消息容器滚动: 滚到顶部附近触发加载更早历史; 滚出底部区域暂停流式自动跟随 */
  const onMsgScroll = () => {
    const el = msgBoxRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 48 && !loadingMore && hasMoreMsgs) void loadMoreMsgs();
  };

  /** 相对时间 */
  const fmtRel = (ts: number) => {
    const d = Date.now() - ts;
    if (d < 60_000) return "刚刚";
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
    return `${Math.floor(d / 86_400_000)}d`;
  };

  /** 消息时间: 跨天显示 日期+时分, 当天显示 时分秒 */
  const fmtClock = (ts?: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const hm = d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return hm;
    return `${d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${hm}`;
  };

  const connect = async () => {
    setBusy(true);
    setStatus((s) => ({ ...(s ?? {}), phase: "connecting" }) as AgentStatus);
    try {
      // AC-8: 重连前中断本地仍在跑的展示流 (不静默重放)
      for (const [sid, run] of [...runsRef.current.entries()]) {
        run.interrupted = true;
        run.streaming = false;
        run.ac.abort();
        commitMsgs(sid, (all) =>
          all.map((m) =>
            m.id === run.msgId
              ? { ...m, streaming: false, interrupted: true, text: run.text, finishedAt: Date.now() }
              : m,
          ),
        );
        persist(sid, "assistant", { text: run.text, tools: run.tools, interrupted: true });
        runsRef.current.delete(sid);
      }
      setRunningIds(new Set());
      setQueueHint({});

      const r = await fetch("/api/agent/connect", { method: "POST" });
      const j = (await r.json()) as {
        status: AgentStatus;
        interruptedLocalIds?: string[];
      };
      setStatus(j.status);
      if (currentIdRef.current) void loadGw(currentIdRef.current);
    } catch {
      setStatus((s) => ({ ...(s ?? {}), phase: "error", lastError: "本地服务无响应" }) as AgentStatus);
    } finally {
      setBusy(false);
    }
  };

  const send = async (text?: string) => {
    const sid = currentId;
    const task = (text ?? input).trim();
    if ((!task && attachments.length === 0) || !sid || runningIds.has(sid)) return;

    // 一律落到会话 resources/: 有 File 上传; 仅有绝对路径则服务端复制
    const resolved: MsgResource[] = [];
    for (const a of attachments) {
      try {
        const fd = new FormData();
        fd.set("sessionId", sid);
        if (a.file) {
          fd.set("file", a.file, a.name);
        } else if (a.path) {
          fd.set("sourcePath", a.path);
        } else {
          continue;
        }
        const r = await fetch("/api/agent/attachments", { method: "POST", body: fd });
        const j = (await r.json()) as { ok?: boolean; path?: string; name?: string; error?: string };
        if (!r.ok || !j.path) throw new Error(j.error || "上传失败");
        resolved.push({ name: j.name || a.name, path: j.path, kind: a.kind });
      } catch (e) {
        setCtxToast(e instanceof Error ? e.message : "附件上传失败");
        return;
      }
    }

    let promptText = task;
    if (resolved.length) {
      const lines = resolved.map((f) =>
        f.kind === "image" ? `- 图片 [${f.name}](${f.path})` : `- 文件 [${f.name}](${f.path})`,
      );
      const block = `【用户附带资源 · 已保存在会话 resources/ · 请用 Read 读取绝对路径】\n${lines.join("\n")}`;
      promptText = task ? `${task}\n\n${block}` : block;
    }

    setInput("");
    writeInputDraft(sid, "");
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
    setAttachImgPreview(null);
    setAttachMenuOpen(false);
    setRunningIds((prev) => new Set(prev).add(sid));
    const id = Date.now();
    // extra 仅 UI/落盘排障用, 不会发给网关。勿塞「工作约定」全文:
    // 约定只在 activate 时注入一次; 若写入每条 messages.jsonl, Agent 读历史会反复看到并易卡在 Read。
    const extra: { title: string; text: string }[] = [];
    const cwd = sessions.find((sd) => sd.id === sid)?.acpCwd ?? "";
    if (cwd) extra.push({ title: "会话工作目录", text: cwd });
    const mdl = gwRef.current.get(sid)?.sessionConfig?.model?.currentValue;
    if (mdl) extra.push({ title: "会话模型", text: mdl });
    // 气泡展示用户原文; 附件用 resources 字段回显缩略图/文件卡
    const bubbleText = task;
    commitMsgs(sid, (prev) => [
      ...prev,
      {
        id,
        role: "user",
        text: bubbleText,
        ts: id,
        extra: extra.length ? extra : undefined,
        resources: resolved.length ? resolved : undefined,
      },
    ]);
    persist(sid, "user", {
      text: bubbleText,
      ...(extra.length ? { extra } : {}),
      ...(resolved.length ? { resources: resolved } : {}),
    });
    const agentMsg: Msg = {
      id: id + 1,
      role: "agent",
      text: "",
      streaming: true,
      startedAt: Date.now(),
      ts: Date.now(),
    };
    commitMsgs(sid, (prev) => [...prev, agentMsg]);
    const ac = new AbortController();
    const run: RunState = {
      sessionId: sid,
      msgId: agentMsg.id,
      text: "",
      tools: [],
      thinking: false,
      streaming: true,
      startedAt: Date.now(),
      ac,
      queued: true,
    };
    runsRef.current.set(sid, run);
    const update = (fn: (r: RunState) => void) => {
      fn(run);
      commitMsgs(sid, (all) =>
        all.map((m) =>
          m.id === agentMsg.id
            ? {
                ...m,
                text: run.text,
                tools: run.tools,
                thinking: run.thinking,
                error: run.error,
                errorNote: run.errorNote,
                streaming: run.streaming,
              }
            : m,
        ),
      );
    };
    try {
      const res = await fetch("/api/agent/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: promptText, localSessionId: sid }),
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
          let ev: {
            type: string;
            text?: string;
            tool?: string;
            state?: string;
            detail?: string;
            toolCallId?: string;
            error?: string;
            preserveText?: boolean;
            aheadTitle?: string | null;
            aheadKey?: string | null;
            requestId?: string | number;
            toolTitle?: string;
            stopReason?: string;
            options?: { optionId: string; name: string; kind?: string }[];
            usage?: AgentStatus["usage"];
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "usage" && ev.usage) {
            for (const [id, prev] of gwRef.current) {
              gwRef.current.set(id, { ...prev, usage: ev.usage });
            }
            if (currentIdRef.current) {
              setGw((g) => ({ ...(g ?? {}), usage: ev.usage }));
            }
            continue;
          }
          if (ev.type === "permission" && ev.requestId != null) {
            permAnsweredRef.current = false;
            setPermAsk({
              requestId: ev.requestId,
              localSessionId: sid,
              toolTitle: ev.toolTitle || "工具请求权限",
              toolCallId: ev.toolCallId,
              detail: ev.detail,
              options: ev.options ?? [],
            });
            continue;
          }
          if (ev.type === "queued") {
            run.queued = true;
            const hint =
              ev.aheadTitle && ev.aheadKey
                ? `排队中（前序：会话「${ev.aheadTitle}」）`
                : "排队中…";
            setQueueHint((prev) => ({ ...prev, [sid]: hint }));
            update((r) => {
              if (!r.text) r.text = "";
            });
          } else if (ev.type === "running") {
            run.queued = false;
            setQueueHint((prev) => {
              const n = { ...prev };
              delete n[sid];
              return n;
            });
          } else if (ev.type === "chunk") {
            update((r) => {
              r.text += ev.text ?? "";
              r.thinking = false;
            });
          } else if (ev.type === "thought") {
            update((r) => {
              r.thinking = true;
            });
          } else if (ev.type === "tool") {
            update((r) => {
              upsertTool(r.tools, ev);
            });
          } else if (ev.type === "done") {
            if (permAnsweredRef.current) {
              setPermAsk((p) => (p?.localSessionId === sid ? null : p));
            } else {
              setPermAsk((p) =>
                p?.localSessionId === sid ? { ...p, stale: true, stopReason: ev.stopReason } : p,
              );
            }
            update((r) => {
              r.streaming = false;
              r.thinking = false;
              // 用户停止 / 排队取消: 灰标「已取消」, 不走红字异常
              if (ev.stopReason === "cancelled") {
                r.interrupted = true;
                r.error = false;
                r.errorNote = undefined;
              }
            });
          } else if (ev.type === "error") {
            if (permAnsweredRef.current) {
              setPermAsk((p) => (p?.localSessionId === sid ? null : p));
            }
            const note = ev.error ?? "任务执行失败";
            // 兼容旧流: 「任务已取消」当中断而非异常
            if (note === "任务已取消") {
              update((r) => {
                r.streaming = false;
                r.interrupted = true;
                r.error = false;
                r.errorNote = undefined;
              });
            } else {
              update((r) => {
                r.streaming = false;
                r.error = true;
                // 不活跃超时等: 保留已流出正文, 红条单独展示
                if (ev.preserveText && r.text.trim()) {
                  r.errorNote = note;
                } else if (!r.text.trim()) {
                  r.text = note;
                  r.errorNote = undefined;
                } else {
                  r.errorNote = note;
                }
              });
            }
          }
        }
      }
      void loadGw(sid);
      // 网关 usage_update 偶发晚于 done; 短延迟再拉一次, 避免 Token 栏停在上一轮
      window.setTimeout(() => void loadGw(sid), 500);
      window.setTimeout(() => void loadGw(sid), 1200);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        update((r) => {
          r.streaming = false;
          r.error = true;
          r.text = (e as Error).message;
        });
      } else {
        update((r) => {
          r.streaming = false;
          r.interrupted = true;
        });
      }
    } finally {
      runsRef.current.delete(sid);
      setRunningIds((prev) => {
        const n = new Set(prev);
        n.delete(sid);
        return n;
      });
      setQueueHint((prev) => {
        const n = { ...prev };
        delete n[sid];
        return n;
      });
      commitMsgs(sid, (all) =>
        all.map((m) =>
          m.id === agentMsg.id
            ? {
                ...m,
                text: run.text,
                tools: run.tools,
                error: run.error,
                errorNote: run.errorNote,
                interrupted: run.interrupted,
                streaming: false,
                thinking: false,
                finishedAt: Date.now(),
              }
            : m,
        ),
      );
      if (run.interrupted) persist(sid, "assistant", { text: run.text, tools: run.tools, interrupted: true });
      else if (run.error) {
        const persistText =
          run.text.trim() || run.errorNote || "任务执行失败";
        persist(sid, "assistant", { text: persistText, tools: run.tools, error: true });
      } else if (run.text.trim()) persist(sid, "assistant", { text: run.text, tools: run.tools });
      void (async () => {
        try {
          const ar = await fetch("/api/agent/audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // 只扫本轮任务开始后的写入, 避免其他会话 meta/落盘误报
            body: JSON.stringify({ id: sid, sinceMs: run.startedAt }),
          });
          const aj = (await ar.json()) as { violations?: { path: string; mtime: number; size: number }[] };
          if (aj.violations?.length) {
            setAuditWarn(
              `⚠ 检测到 ${aj.violations.length} 处工作区越界写入: WorkBuddy 可能把产物写到了其他会话目录（见控制台/审计接口）`,
            );
          } else {
            setAuditWarn(null);
          }
        } catch {
          // 审计失败静默
        }
      })();
    }
  };

  const stop = async () => {
    const sid = currentId;
    const run = sid ? runsRef.current.get(sid) : undefined;
    run?.ac.abort();
    setPermAsk(null);
    try {
      await fetch("/api/agent/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localSessionId: sid ?? undefined }),
      });
    } catch {
      // 忽略
    }
  };

  /** 应答网关 session/request_permission */
  const answerPermission = async (optionId: string | null) => {
    if (!permAsk || permBusy) return;
    if (permAsk.stale) {
      setPermAsk(null);
      return;
    }
    setPermBusy(true);
    permAnsweredRef.current = true;
    let expired = false;
    try {
      const res = await fetch("/api/agent/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localSessionId: permAsk.localSessionId,
          requestId: permAsk.requestId,
          ...(optionId ? { optionId } : { cancelled: true }),
        }),
      });
      if (res.status === 404) {
        expired = true;
        permAnsweredRef.current = false;
      }
    } catch {
      // 网络失败: 服务端超时后会自行 cancelled
    } finally {
      setPermBusy(false);
      if (expired) setPermAsk((p) => (p ? { ...p, stale: true } : p));
      else setPermAsk(null);
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
        body: JSON.stringify({ model: modelId, localSessionId: currentId ?? undefined }),
      });
      const j = (await r.json()) as { ok: boolean; status?: AgentStatus; error?: string };
      if (j.ok && j.status) {
        // 全局偏好: 所有会话缓存同步模型当前值
        setStatus((s) => ({ ...(s ?? {}), phase: j.status?.phase ?? "connected", lastError: j.status?.lastError }));
        const merged = mergeGw(toGw(j.status));
        for (const id of gwRef.current.keys()) gwRef.current.set(id, merged);
        if (currentId) {
          gwRef.current.set(currentId, merged);
          setGw(merged);
        }
      } else alert(j.error ?? "切换模型失败");
    } catch {
      alert("切换模型失败: 本地服务无响应");
    } finally {
      setBusy(false);
    }
  };

  /** 通用配置项: POST /api/agent/set-config (权限模式/思考深度/沙箱) — 全局共享 */
  const applyConfig = async (configId: string, value: string) => {
    if (!value) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agent/set-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, value, localSessionId: currentId ?? undefined }),
      });
      const j = (await r.json()) as { ok: boolean; status?: AgentStatus; error?: string };
      if (j.ok && j.status) {
        setStatus((s) => ({ ...(s ?? {}), phase: j.status?.phase ?? "connected", lastError: j.status?.lastError }));
        const merged = mergeGw(toGw(j.status));
        for (const id of gwRef.current.keys()) gwRef.current.set(id, merged);
        if (currentId) {
          gwRef.current.set(currentId, merged);
          setGw(merged);
        }
      } else alert(j.error ?? "设置失败");
    } catch {
      alert("设置失败: 本地服务无响应");
    } finally {
      setBusy(false);
    }
  };

  // 流式自动滚底 (用户上滚查看历史时暂停跟随; 历史加载/更早历史 prepend 时不平滑滚动)
  useEffect(() => {
    if (prependRef.current) {
      prependRef.current = false;
      return;
    }
    if (histPendingRef.current) {
      histPendingRef.current = false;
      return;
    }
    if (followRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // 按会话恢复/切换草稿; 卸载时再写一次防丢
  useEffect(() => {
    if (currentId) setInput(readInputDraft(currentId));
    else setInput("");
    setAttachments((prev) => {
      for (const a of prev) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return [];
    });
    setAttachImgPreview(null);
    setAttachMenuOpen(false);
    setModelMenuOpen(false);
  }, [currentId]);
  useEffect(() => {
    return () => {
      const sid = currentIdRef.current;
      if (sid) writeInputDraft(sid, inputValueRef.current);
    };
  }, []);

  // 附件 / 模型上拉菜单: 点击外部关闭
  useEffect(() => {
    if (!attachMenuOpen && !modelMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (attachMenuOpen && attachMenuRef.current && !attachMenuRef.current.contains(t)) {
        setAttachMenuOpen(false);
      }
      if (modelMenuOpen && modelMenuRef.current && !modelMenuRef.current.contains(t)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachMenuOpen, modelMenuOpen]);

  // 待发送图片预览: Esc 关闭
  useEffect(() => {
    if (!attachImgPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAttachImgPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [attachImgPreview]);

  const addFilesFromList = (list: FileList | File[] | null, forceKind?: "image" | "file") => {
    if (!list || list.length === 0) return;
    const next: PendingAttach[] = [];
    for (const file of Array.from(list)) {
      const isImg = forceKind === "image" || (forceKind !== "file" && /^image\//.test(file.type));
      const electronPath = (file as File & { path?: string }).path;
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name || (isImg ? "粘贴图片.png" : "附件"),
        kind: isImg ? "image" : "file",
        path: electronPath && electronPath.startsWith("/") ? electronPath : undefined,
        previewUrl: isImg ? URL.createObjectURL(file) : undefined,
        // 始终保留 File: 发送时上传到会话 resources/, 历史统一引用
        file,
      });
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 12));
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit?.previewUrl) {
        URL.revokeObjectURL(hit.previewUrl);
        setAttachImgPreview((cur) => (cur?.url === hit.previewUrl ? null : cur));
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  // 输入框自动撑高: 内容增高 → 高度跟随, 达到上限后滚动
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_H)}px`;
  }, [input]);

  const pm = phaseBadge(phase, status?.discovered);
  const caps = status?.capabilities;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface">
      {auditWarn && (
        <div className="flex items-center justify-between gap-3 border-b border-up/30 bg-up-soft px-4 py-1.5 text-[11.5px] text-up">
          <span>{auditWarn}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setAuditWarn(null)}
            className="shrink-0 rounded px-1.5 text-up/80 transition-colors hover:bg-up/10 hover:text-up"
          >
            ✕
          </button>
        </div>
      )}
      <div className="relative flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <div
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${pm.color}`}
        >
          <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
          {pm.label}
        </div>
        {runningIds.size > 0 && (
          <div
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent-deep"
            title={
              currentId && queueHint[currentId]
                ? queueHint[currentId]!
                : "本地 Agent 正在执行任务；切到其他模块后仍会继续"
            }
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            {currentId && queueHint[currentId] ? "排队中" : "任务进行中"}
            {runningIds.size > 1 ? ` · ${runningIds.size}` : ""}
          </div>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-x-4 self-stretch text-[11.5px] text-ink-muted">
          {status?.discovered ? (
            <>
              <span className="whitespace-nowrap">
                网关 <b className="font-semibold text-ink">{status.discovered.pid}</b> ·{" "}
                <b className="font-semibold text-ink">127.0.0.1:{status.discovered.port}</b>
              </span>
              <span className="whitespace-nowrap">
                心跳{" "}
                {status.discovered.heartbeatMsAgo < 600_000
                  ? `${Math.round(status.discovered.heartbeatMsAgo / 1000)}s 前`
                  : "未知（连接可用）"}
              </span>
            </>
          ) : (
            <span>未发现 ~/.workbuddy/sessions 存活网关，请先启动 WorkBuddy</span>
          )}
          {status?.lastError && (
            <div className="mt-1.5 rounded bg-up-soft px-2 py-1.5 text-[11.5px] leading-snug text-up">
              {status.lastError}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* ACP 参数 / 目录 / 约定 / 状态 — 模型与 Token 已下移到输入框底栏 */}
          {phase === "connected" && (gw?.sessionConfig || gw?.models?.length) ? (
            <button
              type="button"
              aria-label="ACP 参数"
              title="ACP 参数（权限模式 / 思考深度 / 沙箱等）"
              onClick={() => setConfigOpen(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
              </svg>
            </button>
          ) : null}
          {/* 打开会话工作目录 (Finder / 资源管理器) */}
          <button
            type="button"
            aria-label="打开工作目录"
            title={docHints[0] ? `打开工作目录\n${docHints[0]}` : "打开工作目录"}
            disabled={!docHints[0]}
            onClick={() => void openSessionFolder()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
            </svg>
          </button>
          {/* 预览本会话 messages.jsonl */}
          <button
            type="button"
            aria-label="查看消息列表"
            title={
              docHints[0]
                ? `查看消息列表\n${docHints[0]}/messages.jsonl`
                : "查看消息列表（需先有会话）"
            }
            disabled={!docHints[0]}
            onClick={() => {
              const cwd = docHints[0];
              if (!cwd) return;
              openDoc(`${cwd}/messages.jsonl`, "messages.jsonl");
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
              <path d="M8 6h13" />
              <path d="M8 12h13" />
              <path d="M8 18h13" />
              <path d="M3 6h.01" />
              <path d="M3 12h.01" />
              <path d="M3 18h.01" />
            </svg>
          </button>
          {/* 状态信息按钮: 未连接也可查看发现态 (进程/心跳); 已连接再补会话与能力 */}
          <div className="relative">
            <button
              type="button"
              aria-label="网关状态信息"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
            >
              <IconInfo className="h-[15px] w-[15px]" />
            </button>
            {infoOpen ? (
              <div
                ref={infoRef}
                className="absolute right-0 top-[36px] z-50 w-[360px] rounded-lg border border-line bg-white p-3.5 shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-ink">网关状态</span>
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
                  <InfoRow label="连接状态" value={pm.label} />
                  {status?.discovered ? (
                    <>
                      <InfoRow label="网关进程" value={`${status.discovered.pid} · 127.0.0.1:${status.discovered.port}`} mono />
                      <InfoRow
                        label="心跳"
                        value={
                          status.discovered.heartbeatMsAgo < 600_000
                            ? `${Math.round(status.discovered.heartbeatMsAgo / 1000)}s 前`
                            : "未知"
                        }
                      />
                    </>
                  ) : (
                    <InfoRow label="发现" value="未找到 ~/.workbuddy/sessions 存活网关" />
                  )}
                  {phase === "connected" && gw?.connectionIdMasked ? (
                    <InfoRow label="连接 ID" value={gw.connectionIdMasked} mono />
                  ) : null}
                  {phase === "connected" && gw?.protocolVersion ? (
                    <InfoRow label="协议版本" value={`v${gw.protocolVersion}`} />
                  ) : null}
                  {phase === "connected" && gw?.acpSessionId ? (
                    <InfoRow label="ACP 会话" value={`${gw.acpSessionId.slice(0, 8)}…${gw.acpSessionId.slice(-4)}`} mono />
                  ) : null}
                  {status?.lastError ? <InfoRow label="最近错误" value={status.lastError} /> : null}
                </div>
                {phase === "connected" && caps ? (
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
                        ...(gw?.authMethods ?? []).map((a) => `auth:${a}`),
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
      <div className="flex min-h-0 flex-1">

      {/* ── 会话侧栏 (磁盘持久化的本地会话) ── */}
      <aside className="flex h-full w-[216px] shrink-0 flex-col border-r border-line bg-surface">
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
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
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
                onClick={() => {
                  if (editingTitleId === sd.id) return;
                  void switchSession(sd.id);
                }}
                onKeyDown={(e) => {
                  if (editingTitleId === sd.id) return;
                  if (e.key === "Enter") void switchSession(sd.id);
                }}
                className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] ${
                  sd.id === currentId ? "bg-accent-soft font-medium text-accent-deep" : "text-ink hover:bg-black/5"
                }`}
                title={editingTitleId === sd.id ? undefined : `${sd.title}\n悬停右侧 ⋯ 可重命名或删除`}
              >
                <SessionIcon
                  className={[
                    "h-3.5 w-3.5 shrink-0",
                    sd.id === currentId ? "text-accent" : "text-ink-faint",
                    runningIds.has(sd.id) ? "text-accent" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
                {editingTitleId === sd.id ? (
                  <input
                    ref={editTitleRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitRename(sd.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingTitleId(null);
                      }
                    }}
                    onBlur={() => void commitRename(sd.id)}
                    className="min-w-0 flex-1 rounded border border-accent/40 bg-white px-1 py-0.5 text-[12.5px] font-medium text-ink outline-none"
                  />
                ) : (
                  <span
                    className="min-w-0 flex-1 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginRename(sd.id, sd.title);
                    }}
                  >
                    {sd.title}
                  </span>
                )}
                {runningIds.has(sd.id) && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    {queueHint[sd.id] ? "排队中" : "运行中"}
                  </span>
                )}
                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{fmtRel(sd.updatedAt)}</span>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={`管理会话 ${sd.title}`}
                    disabled={editingTitleId === sd.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === sd.id ? null : sd.id);
                    }}
                    className={`${
                      menuFor === sd.id ? "flex" : "hidden group-hover:flex"
                    } h-4 w-4 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
                      <circle cx="12" cy="5" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="12" cy="19" r="1.6" />
                    </svg>
                  </button>
                  {menuFor === sd.id ? (
                    <div
                      ref={sessionMenuRef}
                      className="absolute right-0 top-full z-50 mt-1 w-[120px] rounded-lg border border-line bg-white p-1 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuFor(null);
                          beginRename(sd.id, sd.title);
                        }}
                        className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-black/5"
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        disabled={runningIds.has(sd.id)}
                        onClick={() => askRemoveSession(sd.id)}
                        className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-surface">
      {/* ── 协作演示区 (IM 气泡: 白底 / Agent 左灰泡 / 用户右浅蓝泡) ── */}
      <div ref={msgBoxRef} onScroll={onMsgScroll} onContextMenu={onCtxMenu} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
                  disabled={runningIds.has(currentId ?? "")}
                  className="rounded-full border border-line bg-page px-3 py-1.5 text-[12px] text-accent-deep hover:bg-accent-soft disabled:opacity-40"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto space-y-5" style={{ width: "min(max(980px, 88vw), 100%)" }}>
            {msgs.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="flex justify-end gap-2.5">
                    <div className="flex max-w-[min(640px,78%)] flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 px-0.5">
                        <span className="text-[11px] font-medium text-ink-faint">我</span>
                        <span className="text-[10px] tabular-nums text-ink-faint">{fmtClock(m.ts)}</span>
                      </div>
                      <div className="group flex items-end justify-end gap-1.5">
                        <CopyBtn text={m.text} />
                        <div className="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-[0_1px_2px_rgba(28,31,36,0.04)]">
                          {m.resources && m.resources.length > 0 ? (
                            <div className={`flex flex-wrap gap-2 ${m.text ? "mb-2" : ""}`}>
                              {m.resources.map((r) =>
                                r.kind === "image" ? (
                                  <button
                                    key={r.path}
                                    type="button"
                                    title={r.path}
                                    onClick={() => openDoc(r.path, r.name)}
                                    className="block overflow-hidden rounded-xl border border-line/60 bg-white"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={`/api/local-file?path=${encodeURIComponent(r.path)}`}
                                      alt={r.name}
                                      className="max-h-[220px] max-w-[280px] object-contain"
                                    />
                                  </button>
                                ) : (
                                  <button
                                    key={r.path}
                                    type="button"
                                    title={r.path}
                                    onClick={() => openDoc(r.path, r.name)}
                                    className="flex max-w-[240px] items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-page"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0 text-ink-muted">
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                                      <path d="M14 2v6h6" />
                                    </svg>
                                    <span className="min-w-0 truncate">{r.name}</span>
                                  </button>
                                ),
                              )}
                            </div>
                          ) : null}
                          {m.text ? <div className="whitespace-pre-wrap break-words">{m.text}</div> : null}
                          {!m.text && !(m.resources && m.resources.length) ? (
                            <span className="text-ink-faint">…</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <Avatar who="user" />
                  </div>
                ) : (
                  <div className="flex justify-start gap-2.5">
                    <Avatar who="agent" />
                    <div className="flex min-w-0 max-w-[min(720px,85%)] flex-1 flex-col items-start gap-1">
                      <div className="flex items-center gap-1.5 px-0.5">
                        <span className="text-[11px] font-medium text-ink-muted">本地 Agent</span>
                        <span className="text-[10px] tabular-nums text-ink-faint">{fmtClock(m.ts)}</span>
                        {m.streaming && (
                          <span className="text-[11px] text-accent">
                            {m.thinking ? "思考中…" : "正在生成…"}
                          </span>
                        )}
                        {m.interrupted && (
                          <span
                            className="rounded bg-black/[0.06] px-1.5 py-px text-[10px] font-medium text-ink-muted"
                            title="任务已被手动取消（本地停止），已产出的内容已保留"
                          >
                            已取消
                          </span>
                        )}
                      </div>
                      <ToolStrip m={m} />
                      <div className="group flex w-full items-start gap-1.5">
                        <div className="inline-block max-w-full rounded-2xl bg-page px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-[0_1px_2px_rgba(28,31,36,0.04)]">
                      {(() => {
                        const errOnly =
                          !!m.error &&
                          !m.errorNote &&
                          /^(任务超时|不活跃超时|任务执行失败)/.test((m.text ?? "").trim());
                        const body = errOnly ? "" : m.text;
                        const banner =
                          m.errorNote ||
                          (errOnly ? m.text : m.error && body.trim() ? "本轮异常结束（已保留上方内容）" : null);
                        return (
                          <>
                            {body ? (
                              <>
                                {renderMd(body, openDoc, docHints, openLink)}
                                {m.streaming ? <span className="animate-pulse">▍</span> : null}
                              </>
                            ) : m.streaming ? (
                              <span className="animate-pulse">▍</span>
                            ) : !banner ? (
                              "…"
                            ) : null}
                            {banner ? (
                              <div
                                className={`rounded-md border border-up/40 bg-up-soft px-2.5 py-1.5 text-[12px] text-up ${
                                  body.trim() ? "mt-2" : ""
                                }`}
                              >
                                {banner}
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                        </div>
                        <CopyBtn text={m.text} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── 输入区 (Cursor 风格作曲框: 附件条 + 文本 + 底栏工具) ── */}
      <div className="border-t border-line bg-surface px-5 py-3.5">
        {currentId && queueHint[currentId] && (
          <div className="mx-auto mb-2 text-[11.5px] text-accent-deep" style={{ width: "min(max(820px, 80vw), 100%)" }}>
            {queueHint[currentId]}
            <span className="ml-2 text-ink-faint">可点「取消排队」放弃</span>
          </div>
        )}
        <div
          className="relative mx-auto rounded-2xl border border-line bg-page shadow-[0_1px_2px_rgba(28,31,36,0.04)] focus-within:border-accent/50"
          style={{ width: "min(max(820px, 80vw), 100%)" }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (phase !== "connected" || runningIds.has(currentId ?? "")) return;
            addFilesFromList(e.dataTransfer.files);
          }}
        >
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-b border-line/70 px-3 pt-2.5">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="group/att relative flex max-w-[180px] items-center gap-1.5 rounded-lg border border-line bg-surface px-1.5 py-1 text-[11.5px] text-ink"
                >
                  {a.kind === "image" && a.previewUrl ? (
                    <button
                      type="button"
                      title={`预览 ${a.name}`}
                      aria-label={`预览 ${a.name}`}
                      onClick={() => setAttachImgPreview({ url: a.previewUrl!, name: a.name })}
                      className="shrink-0 overflow-hidden rounded ring-accent/0 transition hover:ring-2 hover:ring-accent/40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.previewUrl} alt="" className="h-7 w-7 object-cover" />
                    </button>
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-hover text-ink-muted">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                        <path d="M14 2v6h6" />
                      </svg>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={a.path || a.name}>
                    {a.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除 ${a.name}`}
                    onClick={() => removeAttachment(a.id)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-hover hover:text-ink"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3 w-3">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v);
              if (currentId) writeInputDraft(currentId, v);
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (const it of Array.from(items)) {
                if (it.kind === "file") {
                  const f = it.getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length) {
                e.preventDefault();
                addFilesFromList(files);
              }
            }}
            onKeyDown={(e) => {
              // 输入法组字中按 Enter 是确认候选, 不要当成发送
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              phase !== "connected"
                ? "请先连接 WorkBuddy 网关"
                : currentId && queueHint[currentId]
                  ? queueHint[currentId]!
                  : "给本地 Agent 派个任务… (Enter 发送, Shift+Enter 换行)"
            }
            disabled={phase !== "connected" || runningIds.has(currentId ?? "")}
            rows={1}
            style={{ maxHeight: INPUT_MAX_H }}
            className="min-h-[44px] w-full resize-none overflow-y-auto bg-transparent px-3.5 pb-1.5 pt-3 text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <div className="flex items-center gap-1 px-2.5 pb-2 pt-0.5">
            <div className="relative" ref={attachMenuRef}>
              <button
                type="button"
                title="添加文件或图片"
                disabled={phase !== "connected" || runningIds.has(currentId ?? "")}
                onClick={() => {
                  setModelMenuOpen(false);
                  setAttachMenuOpen((v) => !v);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
              {attachMenuOpen ? (
                <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 min-w-[148px] overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      filePickRef.current?.click();
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-ink-muted">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                      <path d="M14 2v6h6" />
                    </svg>
                    添加文件
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      imagePickRef.current?.click();
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-ink-muted">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    添加图片
                  </button>
                </div>
              ) : null}
              <input
                ref={filePickRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFilesFromList(e.target.files, "file");
                  e.target.value = "";
                }}
              />
              <input
                ref={imagePickRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  addFilesFromList(e.target.files, "image");
                  e.target.value = "";
                }}
              />
            </div>
            {phase === "connected" && (gw?.models?.length || gw?.sessionConfig?.model) ? (
              <div className="relative" ref={modelMenuRef}>
                <button
                  type="button"
                  title="切换模型"
                  disabled={busy}
                  onClick={() => {
                    setAttachMenuOpen(false);
                    setModelMenuOpen((v) => !v);
                  }}
                  className="flex h-7 max-w-[180px] items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
                >
                  <span className="truncate">
                    {gw.models?.find((m) => m.modelId === gw.sessionConfig?.model?.currentValue)?.name ||
                      gw.sessionConfig?.model?.options?.find((o) => o.value === gw.sessionConfig?.model?.currentValue)
                        ?.name ||
                      gw.sessionConfig?.model?.currentValue ||
                      "选择模型"}
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 shrink-0">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {modelMenuOpen ? (
                  <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 max-h-[280px] min-w-[260px] overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-xl">
                    {(
                      gw.models?.map((m) => ({
                        value: m.modelId,
                        label: m.name,
                        credits: m.credits || (/^x\d+(\.\d+)?$/i.test(m.description ?? "") ? m.description : undefined),
                      })) ??
                      gw.sessionConfig?.model?.options?.map((o) => ({
                        value: o.value,
                        label: o.name || o.value,
                        credits:
                          (o as { credits?: string }).credits ||
                          (/^x\d+(\.\d+)?$/i.test(o.description ?? "") ? o.description : undefined),
                      })) ??
                      []
                    ).map((opt) => {
                      const active = opt.value === (gw.sessionConfig?.model?.currentValue ?? "");
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={[
                            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                            active ? "bg-accent-soft" : "hover:bg-accent-soft/60",
                          ].join(" ")}
                          onClick={() => {
                            setModelMenuOpen(false);
                            void applyModel(opt.value);
                          }}
                        >
                          <ModelListIcon name={opt.label} className="h-4 w-4 shrink-0 text-ink-muted" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{opt.label}</span>
                          {opt.credits ? (
                            <span className="shrink-0 text-[11.5px] tabular-nums text-ink-faint">{opt.credits}</span>
                          ) : null}
                          {active ? (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4 shrink-0 text-accent"
                              aria-hidden
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          ) : (
                            <span className="h-4 w-4 shrink-0" aria-hidden />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {phase === "connected" &&
            gw?.usage &&
            (gw.usage.lastTotalTokens || gw.usage.sessionTotalTokens || gw.usage.used || gw.usage.lastCost) ? (
              <span
                className="hidden max-w-[220px] truncate text-[10.5px] tabular-nums text-ink-faint sm:inline"
                title={
                  [
                    gw.usage.lastPromptTokens != null
                      ? `本轮提示 ${fmtTokens(gw.usage.lastPromptTokens)}`
                      : null,
                    gw.usage.lastCompletionTokens != null
                      ? `本轮补全 ${fmtTokens(gw.usage.lastCompletionTokens)}`
                      : null,
                    gw.usage.sessionTotalTokens != null
                      ? `本连接累计 ${fmtTokens(gw.usage.sessionTotalTokens)}`
                      : null,
                    gw.usage.size > 0
                      ? `上下文 ${fmtTokens(gw.usage.used)} / ${fmtTokens(gw.usage.size)}`
                      : gw.usage.lastPromptTokens != null
                        ? `上下文 ${fmtTokens(gw.usage.lastPromptTokens)}`
                        : null,
                    gw.usage.lastCost != null && gw.usage.lastCost > 0
                      ? `cost ${fmtCost(gw.usage.lastCost)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Token 用量"
                }
              >
                Token{" "}
                <b className="font-medium text-ink-muted">
                  {fmtTokens(gw.usage.lastTotalTokens ?? gw.usage.used)}
                </b>
                {gw.usage.size > 0 ? (
                  <span>
                    {" "}
                    · {fmtTokens(gw.usage.used)}/{fmtTokens(gw.usage.size)}
                  </span>
                ) : null}
                {fmtCost(gw.usage.lastCost) ? <span> · {fmtCost(gw.usage.lastCost)}</span> : null}
              </span>
            ) : null}
            <div className="flex-1" />
            {runningIds.has(currentId ?? "") ? (
              <button
                type="button"
                onClick={stop}
                title={currentId && queueHint[currentId] ? "取消排队" : "停止"}
                className="flex h-8 items-center gap-1.5 rounded-full bg-up px-3 text-[12px] font-medium text-white hover:opacity-90"
              >
                {currentId && queueHint[currentId] ? "取消排队" : "停止"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={
                  phase !== "connected" ||
                  runningIds.has(currentId ?? "") ||
                  (!input.trim() && attachments.length === 0)
                }
                title="发送"
                aria-label="发送"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-deep disabled:opacity-35"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
        </div>
      </div>
      {/* ── 工具权限授权对话框 (session/request_permission) ── */}
      {permAsk && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/35">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="需要你的授权"
            className="flex w-[480px] max-w-[92vw] flex-col rounded-xl border border-line bg-white shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">需要你的授权</span>
            </div>
            <div className="space-y-3 px-4 py-4">
              <p className="text-[13px] leading-relaxed text-ink">
                Agent 想要
                <span className="font-medium"> {friendlyToolLabel(permAsk.toolTitle)}</span>
              </p>
              {permAsk.detail ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-page px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink">
                  {permAsk.detail}
                </pre>
              ) : (
                <p className="text-[11.5px] text-ink-faint">未提供具体内容，请根据工具类型判断是否允许。</p>
              )}
              <p className="text-[11.5px] leading-relaxed text-ink-muted">
                {permAsk.stale
                  ? "这轮任务已经结束，这次授权不会再生效。关闭后重新发送即可。"
                  : "当前是每次询问。允许一次只放行这一步；本会话始终允许后，同类操作在本会话内不再弹窗。"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
              {permAsk.stale ? (
                <button
                  type="button"
                  disabled={permBusy}
                  onClick={() => void answerPermission(null)}
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-deep disabled:opacity-50"
                >
                  关闭
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={permBusy}
                    onClick={() => void answerPermission(null)}
                    className="rounded-lg border border-line px-3.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-page disabled:opacity-50"
                  >
                    拒绝
                  </button>
                  {(permAsk.options.length
                    ? permAsk.options
                    : [{ optionId: "allow", name: "允许一次", kind: "allow_once" }]
                  ).map((o) => {
                    const label = friendlyOptionLabel(o);
                    const primary = /允许/.test(label);
                    return (
                      <button
                        key={o.optionId}
                        type="button"
                        disabled={permBusy}
                        onClick={() => void answerPermission(o.optionId)}
                        className={
                          primary
                            ? "rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-deep disabled:opacity-50"
                            : "rounded-lg border border-line px-3.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-page disabled:opacity-50"
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── 模型配置对话框 (权限模式 / 思考深度 / 沙箱等, 不含模型本身) ── */}
      {configOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfigOpen(false);
          }}
        >
          <div className="flex w-[420px] max-w-[90vw] flex-col rounded-xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">ACP 参数</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setConfigOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              {phase === "connected" && gw?.sessionConfig ? (
                <>
                  {Object.entries(gw.sessionConfig)
                    .filter(([id, c]) => id !== "model" && (c.options?.length ?? 0) > 0)
                    .map(([id, c]) => (
                      <label key={id} className="flex flex-col gap-1" title={c.description ?? undefined}>
                        <span className="text-[11.5px] font-medium text-ink-muted">
                          {CONFIG_LABEL[id] ?? c.name}
                        </span>
                        <select
                          value={c.currentValue ?? ""}
                          disabled={busy}
                          onChange={(e) => void applyConfig(id, e.target.value)}
                          className="w-full cursor-pointer rounded-md border border-line bg-page px-2.5 py-1.5 text-[12.5px] text-ink outline-none hover:border-accent focus:border-accent disabled:opacity-50"
                        >
                          {(c.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.name}
                              {o.description ? ` · ${o.description}` : ""}
                            </option>
                          ))}
                        </select>
                        {c.description ? (
                          <span className="text-[10.5px] leading-relaxed text-ink-faint">{c.description}</span>
                        ) : null}
                      </label>
                    ))}
                  {Object.entries(gw.sessionConfig).filter(
                    ([id, c]) => id !== "model" && (c.options?.length ?? 0) > 0,
                  ).length === 0 ? (
                    <p className="text-[12px] text-ink-faint">当前网关未暴露可配置项</p>
                  ) : null}
                  {gw.sessionConfig.mode?.currentValue && /bypass/i.test(gw.sessionConfig.mode.currentValue) ? (
                    <p className="rounded-md border border-line bg-page px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted">
                      当前为 Bypass：工具权限将自动放行，不再弹窗询问。
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[12px] text-ink-faint">请先连接网关后再配置</p>
              )}
            </div>
            <div className="flex items-center justify-end border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-deep"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmId ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            className="w-full max-w-sm rounded-xl border border-line bg-surface p-4 shadow-xl"
          >
            <h3 id="delete-session-title" className="text-[14px] font-semibold text-ink">
              删除会话
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
              确定删除「
              {sessions.find((s) => s.id === deleteConfirmId)?.title ?? deleteConfirmId.slice(0, 8)}
              」？历史消息与产物将一并清除，且不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-page"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void removeSession(deleteConfirmId)}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-red-600"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {attachImgPreview ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/75"
          role="dialog"
          aria-modal="true"
          aria-label={`预览 ${attachImgPreview.name}`}
          onClick={() => setAttachImgPreview(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAttachImgPreview(null);
          }}
        >
          <div
            className="flex shrink-0 items-center gap-2 px-4 py-2.5 text-white/90"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{attachImgPreview.name}</span>
            <button
              type="button"
              aria-label="关闭预览"
              onClick={() => setAttachImgPreview(null)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachImgPreview.url}
              alt={attachImgPreview.name}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      ) : null}
      {linkView ? (
        <LinkPreviewModal
          view={linkView}
          stack={linkNav.stack}
          stackIndex={linkNav.index}
          canGoBack={previewCanBack}
          canGoForward={previewCanForward}
          onBack={previewGoBack}
          onForward={previewGoForward}
          onJump={(i) => setLinkNav((prev) => ({ ...prev, index: Math.max(0, Math.min(i, prev.stack.length - 1)) }))}
          onClose={closePreview}
          onOpenDoc={openDocInPreview}
          docHints={docHints}
          onOpenLink={openLinkInPreview}
          onCtxMenu={onCtxMenu}
          onToast={(msg) => {
            setCtxToast(msg);
            window.setTimeout(() => setCtxToast(null), 2000);
          }}
          renderMarkdown={(text, ctx) =>
            renderMd(
              text,
              ctx.onOpenDoc,
              ctx.docHints,
              ctx.onOpenLink,
              ctx.path ? ctx.path.replace(/\/[^/]+$/, "") : undefined,
            )
          }
        />
      ) : null}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu(null);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-[61] min-w-[150px] select-none overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 110) }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void downloadImage()}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-page"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              下载图片
            </button>
            <button
              type="button"
              onClick={() => void copyImage()}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-page"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
              复制图片
            </button>
          </div>
        </>
      )}
      {ctxToast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-[12px] text-white shadow-lg">
          {ctxToast}
        </div>
      )}
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
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.08" />
    <path d="M12 16.2v-4.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    <circle cx="12" cy="8.1" r="1.45" fill="currentColor" />
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
          renderMd(preview.text, onOpenDoc, docHints, undefined, preview.path.replace(/\/[^/]+$/, ""))
        )}
      </div>
    </div>
  );
}

/** 弹窗内嵌 webview → 见 @/components/ui/preview-modal PreviewWebview */

/** 信息下拉中的键值行 */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-ink-faint">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono text-[10.5px]" : ""} text-ink`}>{value}</span>
    </div>
  );
}

/** 会话列表前缀图标 (对话气泡) */
function SessionIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-3.5 w-3.5"}
      aria-hidden
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

/** WorkBuddy 风格模型行图标 (按名称启发式, 无品牌资产时用 lucide 形) */
function ModelListIcon({ name, className }: { name: string; className?: string }) {
  const n = name.toLowerCase();
  const cls = className ?? "h-4 w-4";
  if (/快速|fast/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={cls} aria-hidden>
        <path d="M13 2 4 14h7l-1 8 10-14h-7l0-6z" />
      </svg>
    );
  }
  if (/均衡|balanc/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (/极致|extreme|deep-model|pro(?!ject)/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
        <path d="M6 3h12l4 6-10 12L2 9z" strokeLinejoin="round" />
      </svg>
    );
  }
  if (/hy\d|hunyuan|混元/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
        <path d="M12 3c4 3 6 6 6 9a6 6 0 1 1-12 0c0-3 2-6 6-9Z" />
        <path d="M12 12c2 0 3.5 1.2 3.5 3S14 18 12 18" />
      </svg>
    );
  }
  if (/deepseek|ds-/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
        <path d="M4 12c2-5 6-8 10-8 2 0 4 .7 5.5 2.2C16 8 13 10 10 11c-2 .7-4 1.5-6 3Z" />
        <path d="M8 14c2 3 5 5 9 5 1.5 0 3-.4 4-1.2" />
        <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (/glm|智谱/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
        <path d="M5 5h10l4 7-4 7H5l4-7Z" strokeLinejoin="round" />
      </svg>
    );
  }
  if (/kimi|moonshot/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
        <path d="M20 14.5A8.5 8.5 0 1 1 11 4.2 7 7 0 0 0 20 14.5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls} aria-hidden>
      <path d="m12 3 1.8 5.5L19 10l-5.2 1.5L12 17l-1.8-5.5L5 10l5.2-1.5Z" strokeLinejoin="round" />
    </svg>
  );
}

/** IM 气泡头像: user = 品牌色「我」, agent = 浅色机器人图标 */
function Avatar({ who }: { who: "user" | "agent" }) {
  return who === "user" ? (
    <div className="mt-5 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
      我
    </div>
  ) : (
    <div className="mt-5 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-accent-soft text-accent">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <path d="M12 8V4" />
        <circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none" />
        <path d="M9 13h.01M15 13h.01" strokeWidth="2.4" />
        <path d="M9 16.5h6" />
      </svg>
    </div>
  );
}

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
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5" title={title}>
      {label ? <span className="text-ink-faint">{label}</span> : null}
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
  const [, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(wrapRef, open, () => setOpen(false));
  // 运行中每秒刷新耗时, 避免长时间无 tool 事件时秒数停住
  useEffect(() => {
    if (!m.streaming) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [m.streaming]);
  const tools = m.tools ?? [];

  // 按 toolCallId 聚合: 起始时间/结束时间/工具/参数, 按开始时间排序
  // 依赖 m.tools (引用稳定), 内部再 ?? [] 兜底, 避免每次渲染新数组
  const rows = useMemo(() => {
    const arr = m.tools ?? [];
    const map = new Map<string, { tool: string; detail: string; start: number; end: number }>();
    arr.forEach((t, i) => {
      const k = t.toolCallId || `${t.tool}-${i}`;
      const ts = t.ts ?? 0;
      const end = t.endTs ?? ts;
      const r = map.get(k) ?? { tool: t.tool, detail: "", start: ts, end };
      if (!r.start || (ts && ts < r.start)) r.start = ts;
      if (end > r.end) r.end = end;
      if (t.detail) r.detail = t.detail;
      map.set(k, r);
    });
    return [...map.values()]
      .sort((a, b) => a.start - b.start)
      .map((r) => ({ ...r, ms: Math.max(0, r.end - r.start) }));
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

const MD_LOCAL_RE = /^(\/Users\/|\/home\/|\/private\/|\/tmp\/|file:\/\/)/;
const MD_IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/i;
const MD_VID_EXT_RE = /\.(mp4|webm|mov|m3u8)(\?|#|$)/i;

/** 相对路径相对 baseDir 解析为绝对路径 (仅本机预览用) */
function resolveAgainstDir(baseDir: string, rel: string): string {
  const cleaned = rel.replace(/^file:\/\//, "");
  if (cleaned.startsWith("/")) return cleaned;
  const stack = baseDir.replace(/\/$/, "").split("/").filter(Boolean);
  for (const seg of cleaned.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return `/${stack.join("/")}`;
}

function isMediaLikeUrl(u: string): boolean {
  if (/^data:image\//i.test(u)) return true;
  if (MD_IMG_EXT_RE.test(u) || MD_VID_EXT_RE.test(u)) return true;
  // 绝对本地路径无扩展名时仍交给 /api/local-file 判定
  return MD_LOCAL_RE.test(u) || (u.startsWith("/") && !/^https?:/i.test(u));
}

/** 图片加载失败时回退为可点击链接 (常见: ![alt](文章页 URL)) */
function MdImg({
  src,
  alt,
  title,
  href,
  localPath,
  onOpenLink,
  style,
}: {
  src: string;
  alt: string;
  title?: string;
  href: string;
  localPath?: string;
  onOpenLink?: (raw: string) => void;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a
        href={href}
        onClick={(e) => {
          if (onOpenLink) {
            e.preventDefault();
            onOpenLink(href);
          }
        }}
        target="_blank"
        rel="noreferrer"
        className="my-1 flex items-center gap-2 rounded-lg border border-line bg-black/[0.02] px-2.5 py-2 text-[0.92em] text-accent no-underline"
        title={href}
      >
        <span className="shrink-0 text-ink-faint">图</span>
        <span className="min-w-0 flex-1 truncate font-medium text-accent-deep">{alt || "查看原图/来源"}</span>
        <span className="max-w-[40%] shrink-0 truncate font-mono text-[0.85em] text-ink-faint">{href}</span>
      </a>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 本地/外链媒体预览, 非优化静态资源
    <img
      src={src}
      alt={alt}
      title={title || undefined}
      data-local-path={localPath || undefined}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style}
      className="my-1 max-h-[360px] w-full rounded-lg border border-line object-contain bg-black/[0.02]"
    />
  );
}

/** 行内解析: **粗体** `代码` [链接](url) ![图片/视频](url "title")
 *  + HTML 白名单直通: <video> / <img> (属性+协议双重校验)
 *  + 裸 http(s) URL 自动转可点击链接
 *  + 本地 markdown 路径 → 可点击按钮 (点击内联预览)
 *  + 「📄 文件名.md」纯文本 → 用 docHints (会话工作目录) 尝试定位并预览
 *  + 相对路径图片相对 baseDir (文档目录 / 工作目录) 解析
 *  + 非媒体 URL 的 ![alt](url) 降级为可点来源链接, 避免裂图 */
function Inline({
  text,
  onOpenDoc,
  docHints,
  onOpenLink,
  baseDir,
}: {
  text: string;
  onOpenDoc?: (path: string, title: string) => void;
  docHints?: string[];
  onOpenLink?: (raw: string) => void;
  baseDir?: string;
}) {
  const parts = text.split(
    /(<video[^>]*>[\s\S]*?<\/video>|<img[^>]*\/?>|\*\*[^*\n]+\*\*|`[^`\n]+`|!\[[^\]\n]+\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<]+)/g,
  );
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    // 安全: 协议白名单 + 标签/属性白名单
    const mediaBase = baseDir ?? docHints?.[0];
    const safeUrl = (u: string) => /^(https?:\/\/|data:image\/)/i.test(u) || MD_LOCAL_RE.test(u) || u.startsWith("/");
    const toSrc = (u: string) => {
      const cleaned = u.replace(/^file:\/\//, "");
      if (MD_LOCAL_RE.test(u) || (cleaned.startsWith("/") && !/^https?:/i.test(u))) {
        return `/api/local-file?path=${encodeURIComponent(cleaned)}`;
      }
      return u;
    };
    const resolveSrc = (raw: string): string => {
      const t = raw.trim();
      if (/^(https?:\/\/|data:)/i.test(t) || MD_LOCAL_RE.test(t) || t.startsWith("/")) {
        return t.replace(/^file:\/\//, "");
      }
      if (mediaBase && !t.includes("://")) return resolveAgainstDir(mediaBase, t);
      return t;
    };

    const vtag = p.match(/^<video([^>]*)>[\s\S]*?<\/video>$/i);
    if (vtag) {
      const attrs = vtag[1];
      const src = resolveSrc(attrs.match(/src="([^"]+)"/)?.[1] ?? "");
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
      const rawSrc = attrs.match(/src="([^"]+)"/)?.[1] ?? "";
      const src = resolveSrc(rawSrc);
      const width = attrs.match(/width="?(\d+)"?/)?.[1];
      const height = attrs.match(/height="?(\d+)"?/)?.[1];
      const alt = attrs.match(/alt="([^"]*)"/)?.[1] ?? "";
      if (src && safeUrl(src) && isMediaLikeUrl(src)) {
        out.push(
          <MdImg
            key={i}
            src={toSrc(src)}
            alt={alt}
            href={rawSrc || src}
            localPath={src.startsWith("/") && !/^https?:/i.test(src) ? src : undefined}
            onOpenLink={onOpenLink}
            style={{ width: width ? `${width}px` : "100%", maxHeight: height ? `${height}px` : 360 }}
          />,
        );
        return;
      }
      if (src && /^https?:\/\//i.test(src)) {
        out.push(
          <MdImg key={i} src={src} alt={alt} href={src} onOpenLink={onOpenLink} />,
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
        <code key={i} className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.92em]">
          {p.slice(1, -1)}
        </code>,
      );
      return;
    }

    // 图片语法: ![alt](url) / ![alt](url "title")
    const img = p.match(/^!\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (img) {
      const alt = img[1];
      const rawSrc = img[2].trim();
      const src = resolveSrc(rawSrc);
      const title = img[3] ?? "";
      // 文章页 / 无扩展名外链: 不当作 <img>, 直接给可点来源
      if (/^https?:\/\//i.test(src) && !isMediaLikeUrl(src)) {
        out.push(
          <a
            key={i}
            href={src}
            onClick={(e) => {
              if (onOpenLink) {
                e.preventDefault();
                onOpenLink(src);
              }
            }}
            target="_blank"
            rel="noreferrer"
            className="my-1 flex items-center gap-2 rounded-lg border border-line bg-black/[0.02] px-2.5 py-2 text-[0.92em] text-accent no-underline"
            title={title || src}
          >
            <span className="shrink-0 text-ink-faint">链</span>
            <span className="min-w-0 flex-1 truncate font-medium text-accent-deep">{alt || "查看来源"}</span>
            <span className="max-w-[40%] shrink-0 truncate font-mono text-[0.85em] text-ink-faint">{src}</span>
          </a>,
        );
        return;
      }
      if (safeUrl(src)) {
        if (MD_VID_EXT_RE.test(src)) {
          out.push(
            <video key={i} src={toSrc(src)} controls playsInline className="my-1 max-h-[320px] w-full rounded-lg border border-line bg-black/5">
              <p className="px-2 py-1 text-[11.5px] text-ink-muted">视频无法预览: {alt || src}</p>
            </video>,
          );
        } else {
          out.push(
            <MdImg
              key={i}
              src={toSrc(src)}
              alt={alt}
              title={title || undefined}
              href={rawSrc}
              localPath={src.startsWith("/") && !/^https?:/i.test(src) ? src : undefined}
              onOpenLink={onOpenLink}
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
      if (MD_LOCAL_RE.test(target) && /\.(md|markdown)(\?|#|$)/i.test(target)) {
        out.push(
          <button
            key={i}
            type="button"
            onClick={() => onOpenDoc?.(target.replace(/^file:\/\//, ""), m[1])}
            title={target}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 align-baseline text-[0.92em] font-medium text-accent-deep transition-colors hover:bg-accent/15"
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
          onClick={(e) => {
            if (onOpenLink) {
              e.preventDefault();
              onOpenLink(m[2]);
            }
          }}
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
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 align-baseline text-[0.92em] font-medium text-accent-deep transition-colors hover:bg-accent/15"
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
          onClick={(e) => {
            if (onOpenLink) {
              e.preventDefault();
              onOpenLink(p);
            }
          }}
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
  onOpenLink?: (raw: string) => void,
  baseDir?: string,
): ReactNode[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const parseRow = (r: string) => r.split("|").slice(1, -1).map((x) => x.trim());
  const inlineProps = { onOpenDoc, docHints, onOpenLink, baseDir };
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
        <pre key={`pre-${i}`} className="my-1 overflow-x-auto rounded-lg bg-black/[0.05] p-2.5 text-[0.92em] leading-relaxed">
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
          <table className="w-full border-collapse text-[0.96em]">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} className="border border-line bg-black/[0.03] px-2.5 py-1.5 text-left font-medium">
                    <Inline text={h} {...inlineProps} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-line px-2.5 py-1.5 align-top leading-relaxed">
                      <Inline text={c} {...inlineProps} />
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
          <h4 key={`h-${i}`} className="mb-1 mt-2.5 flex items-center gap-1.5 text-[1.1em] font-bold text-ink">
            <span className="h-3 w-[3px] rounded-full bg-accent" />
            <Inline text={text} {...inlineProps} />
          </h4>
        ) : (
          <h5 key={`h-${i}`} className="mb-0.5 mt-2 text-[1.02em] font-semibold text-ink">
            <Inline text={text} {...inlineProps} />
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
              <Inline text={it} {...inlineProps} />
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
              <Inline text={it} {...inlineProps} />
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
        <blockquote key={`q-${i}`} className="my-1 border-l-2 border-accent/40 pl-2.5 text-[0.96em] text-ink-muted">
          {quote.map((q, qi) => (
            <div key={qi}>
              <Inline text={q} {...inlineProps} />
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
        <Inline text={para.join("\n")} {...inlineProps} />
      </p>,
    );
    i = j;
  }
  return out;
}
