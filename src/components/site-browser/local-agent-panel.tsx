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
  tools?: { tool: string; detail?: string; toolCallId?: string; ts?: number }[];
  error?: boolean;
  interrupted?: boolean;
  ts: number;
  extra?: { title: string; text: string }[];
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
    interrupted: m.interrupted,
    extra: m.extra,
    streaming: false,
    finishedAt: m.ts,
    ts: m.ts,
  };
}

/** 本地 markdown 文档预览状态 */
/** 链接/文件预览弹窗: url → 内嵌 webview; file → 拉取文本渲染 */
type LinkView =
  | { kind: "url"; url: string; title: string }
  | { kind: "file"; path: string; title: string; text?: string; loading?: boolean; error?: string };

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
  interrupted?: boolean;
  startedAt?: number;
  finishedAt?: number;
  ts?: number;
  extra?: { title: string; text: string }[];
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
  const [restoring, setRestoring] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  /** 运行中的会话集合 (每个会话可独立并行跑一个任务) */
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
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
  };
  const runsRef = useRef<Map<string, RunState>>(new Map());
  /** 正在预览的本地 markdown 文档 (点击 📄 打开) */
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [linkView, setLinkView] = useState<LinkView | null>(null);
  const [extraView, setExtraView] = useState<{ title: string; items: { title: string; text: string }[] } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; src: string; name: string } | null>(null);
  const [ctxToast, setCtxToast] = useState<string | null>(null);
  /** 本地会话: 列表 / 当前会话 / 历史加载中 */
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [histLoaded, setHistLoaded] = useState(false);
  /** per-session 视图缓存 (AgentSessionRegistry 前端侧): sessionId -> SessionUi */
  const uiRef = useRef<Map<string, SessionUi>>(new Map());
  /** per-session 网关态: sessionId -> GatewayInfo (status 拆分: 非全局字段归会话) */
  const gwRef = useRef<Map<string, GatewayInfo>>(new Map());
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
  const [sysOpen, setSysOpen] = useState(false);
  const [sysText, setSysText] = useState("");
  const [sysDraft, setSysDraft] = useState("");
  const [sysSaving, setSysSaving] = useState(false);
  const sysLoadedRef = useRef(false);

  // 挂载即加载工作约定: 发送时附加信息 / 打开编辑器都依赖它
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/agent/system-prompt", { cache: "no-store" });
        const j = (await r.json()) as { prompt?: string };
        if (j.prompt) {
          setSysText(j.prompt);
          setSysDraft(j.prompt);
          sysLoadedRef.current = true;
        }
      } catch {
        // 读取失败保持空白
      }
    })();
  }, []);

  /** 打开约定编辑对话框: 首次加载当前约定 */
  const openSysEditor = async () => {
    setSysOpen(true);
    if (!sysLoadedRef.current) {
      try {
        const r = await fetch("/api/agent/system-prompt", { cache: "no-store" });
        const j = (await r.json()) as { prompt?: string };
        setSysText(j.prompt ?? "");
        setSysDraft(j.prompt ?? "");
        sysLoadedRef.current = true;
      } catch {
        // 读取失败, 空白
      }
    }
  };
  /** 保存约定 (下次激活会话时注入) */
  const saveSysPrompt = async () => {
    setSysSaving(true);
    try {
      const r = await fetch("/api/agent/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: sysDraft }),
      });
      if (r.ok) {
        setSysText(sysDraft);
        setSysOpen(false);
      }
    } finally {
      setSysSaving(false);
    }
  };
  useClickOutside(infoRef, infoOpen, () => setInfoOpen(false));

  /** 点击 📄 打开本地 markdown 文档: 拉取文本并内联预览 */
  const openDoc = useCallback((path: string, title: string) => {
    // 文件预览: 弹窗展示 (不再在消息流末尾插入卡片)
    setLinkView({ kind: "file", path, title, loading: true });
  }, []);

  /** 链接点击: http(s) → webview 弹窗; 本地路径 → 文件弹窗 */
  const openLink = useCallback((raw: string) => {
    const url = raw.replace(/^file:\/\//, "");
    if (/^https?:\/\//i.test(url)) {
      setLinkView({ kind: "url", url, title: url });
    } else if (/^(\/Users\/|\/home\/|\/private\/|\/tmp\/)/.test(url)) {
      const name = url.split("/").pop() ?? url;
      setLinkView({ kind: "file", path: url, title: name, loading: true });
    } else {
      window.open(url, "_blank", "noopener");
    }
  }, []);

  /** 「📄 文件名」补偿定位: 用当前会话工作目录做候选 (产物都写在工作区) */
  const docHints = useMemo(() => {
    const s = sessions.find((x) => x.id === currentId);
    return s?.acpCwd ? [s.acpCwd] : [];
  }, [sessions, currentId]);

  const phase = status?.phase ?? "idle";

  /** 图片右键: 拦截 → 自定义菜单 (下载/复制); 非图片保留浏览器默认菜单 */
  const onCtxMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const img = t.closest("img");
    if (!img) {
      setCtxMenu(null);
      return;
    }
    e.preventDefault();
    const src = img.getAttribute("src") ?? "";
    let name = "";
    let real = src;
    if (src.startsWith("/api/local-file")) {
      try {
        real = decodeURIComponent(new URL(src, window.location.origin).searchParams.get("path") ?? src);
      } catch {
        real = src;
      }
      name = real.split("/").pop() ?? "image";
    } else {
      name = new URL(src, window.location.origin).pathname.split("/").pop() ?? "image";
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, src: real, name });
  };

  /** 下载图片: 同源直接 fetch blob → a[download]; 跨域失败则新窗口打开 */
  const downloadImage = useCallback(async () => {
    const m = ctxMenu;
    if (!m) return;
    try {
      const url = m.src.startsWith("/") || /^https?:\/\//i.test(m.src)
        ? m.src
        : `/api/local-file?path=${encodeURIComponent(m.src)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m.name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      setCtxMenu(null);
    } catch {
      setCtxMenu(null);
      window.open(m.src.startsWith("/") ? m.src : `file://${m.src}`, "_blank");
    }
  }, [ctxMenu]);

  /** 复制图片: 同源 fetch → canvas 转 png → 写剪贴板 */
  const copyImage = useCallback(async () => {
    const m = ctxMenu;
    if (!m) return;
    try {
      const url = m.src.startsWith("/") || /^https?:\/\//i.test(m.src)
        ? m.src
        : `/api/local-file?path=${encodeURIComponent(m.src)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const img = new Image();
      img.src = URL.createObjectURL(blob);
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
      URL.revokeObjectURL(img.src);
      const png = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("转码失败"))), "image/png"),
      );
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
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
  /** 拉取某会话的 per-session 网关态 (模型/配置/用量/连接) */
  const loadGw = async (id: string) => {
    try {
      const r = await fetch(`/api/agent/status?sid=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = (await r.json()) as { status: AgentStatus };
      const g = toGw(j.status);
      gwRef.current.set(id, g ?? {});
      if (id === currentIdRef.current) setGw(g);
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
          await loadIntoUi(list[0].id, { scroll: true });
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
    } catch {
      // 落盘失败不阻塞本地会话
    }
  };

  /** 切换本地会话: 缓存优先 (已加载不重拉), 恢复网关上下文 + 拉取 per-session 网关态 */
  const switchSession = async (id: string) => {
    if (id === currentId) return;
    setCurrentId(id);
    // 恢复会话上下文期间禁止发送, 避免「首问卡 …」: 切会话后的第一次发送要付 loadSession 成本
    setRestoring(true);
    try {
      await loadIntoUi(id, { scroll: true });
      // 已连接时激活该会话绑定的网关会话 (session/load 恢复上下文, 使 WorkBuddy 记得之前对话)
      // 后台 fire-and-forget: 不阻塞 UI; 首条消息发送时 prompt 内部会排队对齐同一连接, 不会串台
      if (phase === "connected") {
        void fetch(`/api/agent/sessions/${id}/activate`, { method: "POST" }).catch(() => {
          // 激活失败不阻塞; 下次发送时 prompt 内部会再对齐
        });
        void loadGw(id);
        void refresh();
      }
    } finally {
      setRestoring(false);
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

  /** 落盘一条消息到指定会话 */
  const persist = (sid: string, role: "user" | "assistant", msg: Partial<Msg>) => {
    if (!sid) return;
    void fetch(`/api/agent/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role,
        text: msg.text ?? "",
        tools: msg.tools,
        error: msg.error,
        interrupted: msg.interrupted,
        ts: Date.now(),
        extra: msg.extra,
      }),
    });
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
      const r = await fetch("/api/agent/connect", { method: "POST" });
      const j = (await r.json()) as { status: AgentStatus };
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
    if (!task || !sid || runningIds.has(sid) || restoring) return;
    setInput("");
    setRunningIds((prev) => new Set(prev).add(sid));
    const id = Date.now();
    // 自动附带信息 (排障用): 工作约定 / 会话工作目录 / 当前模型
    const extra: { title: string; text: string }[] = [];
    if (sysText.trim()) extra.push({ title: "工作约定", text: sysText.trim() });
    const cwd = sessions.find((sd) => sd.id === sid)?.acpCwd ?? "";
    if (cwd) extra.push({ title: "会话工作目录", text: cwd });
    const mdl = gwRef.current.get(sid)?.sessionConfig?.model?.currentValue;
    if (mdl) extra.push({ title: "会话模型", text: mdl });
    commitMsgs(sid, (prev) => [...prev, { id, role: "user", text: task, ts: id, extra }]);
    persist(sid, "user", { text: task, extra });
    const agentMsg: Msg = { id: id + 1, role: "agent", text: "", streaming: true, startedAt: Date.now(), ts: Date.now() };
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
    };
    runsRef.current.set(sid, run);
    // update: 更新 run 累积; 写会话缓存 (激活会话自动同步渲染, 切走只落缓存)
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
              r.tools.push({
                tool: ev.tool ?? "",
                state: ev.state ?? "",
                detail: ev.detail ?? "",
                toolCallId: ev.toolCallId ?? "",
                ts: Date.now(),
              });
            });
          } else if (ev.type === "done") {
            update((r) => {
              r.streaming = false;
              r.thinking = false;
            });
          } else if (ev.type === "error") {
            update((r) => {
              r.streaming = false;
              r.error = true;
              r.text = ev.error ?? "任务执行失败";
            });
          }
        }
      }
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
      // 最终状态写会话缓存 (标记结束); 激活会话自动同步渲染
      commitMsgs(sid, (all) =>
        all.map((m) =>
          m.id === agentMsg.id
            ? { ...m, text: run.text, tools: run.tools, error: run.error, streaming: false, thinking: false, finishedAt: Date.now() }
            : m,
        ),
      );
      if (run.interrupted) persist(sid, "assistant", { text: run.text, tools: run.tools, interrupted: true });
      else if (run.error) persist(sid, "assistant", { text: run.text, tools: run.tools, error: true });
      else if (run.text.trim()) persist(sid, "assistant", { text: run.text, tools: run.tools });
      // 越界写入审计 (软隔离兜底): 任务刚结束, 检查是否写到了其他会话目录
      void (async () => {
        try {
          const ar = await fetch("/api/agent/audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sid }),
          });
          const aj = (await ar.json()) as { violations?: { path: string; mtime: number; size: number }[] };
          if (aj.violations?.length) {
            setAuditWarn(`⚠ 检测到 ${aj.violations.length} 处工作区越界写入: WorkBuddy 可能读写到了其他会话目录（见控制台/审计接口）`);
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
        // status 拆分: 全局只取 phase/错误, 网关态写入当前会话
        setStatus((s) => ({ ...(s ?? {}), phase: j.status?.phase ?? "connected", lastError: j.status?.lastError }));
        const g = toGw(j.status);
        if (currentId) {
          gwRef.current.set(currentId, g ?? {});
          setGw(g);
        }
      } else alert(j.error ?? "切换模型失败");
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
        body: JSON.stringify({ configId, value, localSessionId: currentId ?? undefined }),
      });
      const j = (await r.json()) as { ok: boolean; status?: AgentStatus; error?: string };
      if (j.ok && j.status) {
        // status 拆分: 全局只取 phase/错误, 网关态写入当前会话
        setStatus((s) => ({ ...(s ?? {}), phase: j.status?.phase ?? "connected", lastError: j.status?.lastError }));
        const g = toGw(j.status);
        if (currentId) {
          gwRef.current.set(currentId, g ?? {});
          setGw(g);
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-page">
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
        <div className="flex min-w-0 flex-1 items-center gap-x-4 text-[11.5px] text-ink-muted">
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
          {/* 工作约定按钮: 查看/编辑全局工作约定 (激活会话时注入给 WorkBuddy) */}
          <button
            type="button"
            aria-label="工作约定"
            title="工作约定（激活会话时注入给 WorkBuddy）"
            onClick={() => void openSysEditor()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
              <path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              <path d="M9 8h6" />
              <path d="M9 12h6" />
              <path d="M9 16h4" />
            </svg>
          </button>
          {/* 状态信息按钮: 点击展示连接/会话/能力详情 */}
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
                  {gw?.connectionIdMasked ? (
                    <InfoRow label="连接 ID" value={gw.connectionIdMasked} mono />
                  ) : null}
                  {gw?.protocolVersion ? (
                    <InfoRow label="协议版本" value={`v${gw.protocolVersion}`} />
                  ) : null}
                  {gw?.acpSessionId ? (
                    <InfoRow label="ACP 会话" value={`${gw.acpSessionId.slice(0, 8)}…${gw.acpSessionId.slice(-4)}`} mono />
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
      {/* ── 会话设置条 (模型 + 动态配置项 + 用量) ── */}
      {phase === "connected" && gw?.sessionConfig && (
        <div className="border-b border-line bg-surface px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px]">
            <CtlSelect
              label="模型"
              value={gw.sessionConfig.model?.currentValue ?? ""}
              options={
                gw.models?.map((m) => ({
                  value: m.modelId,
                  label: `${m.name}${m.description ? ` · ${m.description}` : ""}`,
                })) ?? []
              }
              disabled={busy}
              onChange={(v) => void applyModel(v)}
              title="切换会话模型 (session/set_model)"
            />
            {/* 动态渲染网关暴露的其他 select 配置项 (options 非空), 新增项自动出现 */}
            {Object.entries(gw.sessionConfig)
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
            {gw.usage ? (
              <span className="ml-auto tabular-nums text-ink-faint" title={`token 用量 ${gw.usage.used} / ${gw.usage.size}`}>
                用量 {(gw.usage.used / 1000).toFixed(1)}k / {(gw.usage.size / 1000).toFixed(0)}k
              </span>
            ) : null}
          </div>
        </div>
      )}

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
                {runningIds.has(sd.id) && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    运行中
                  </span>
                )}
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
      {/* ── 协作演示区 ── */}
      <div ref={msgBoxRef} onScroll={onMsgScroll} onContextMenu={onCtxMenu} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-40"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto space-y-4" style={{ width: "min(max(980px, 88vw), 100%)" }}>
            {msgs.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      {m.extra && m.extra.length > 0 && (
                        <button
                          type="button"
                          title="查看本条消息自动附带的信息 (排障用)"
                          onClick={() => setExtraView({ title: "附加信息", items: m.extra! })}
                          className="rounded border border-line bg-surface px-1.5 py-px text-[10px] text-ink-muted transition-colors hover:bg-page hover:text-ink"
                        >
                          附加信息
                        </button>
                      )}
                      <span className="text-[10px] tabular-nums text-ink-faint">{fmtClock(m.ts)}</span>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="group flex items-end justify-end gap-1.5">
                        <CopyBtn text={m.text} />
                        <div className="max-w-[640px] rounded-xl rounded-br-sm bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-white">
                          {m.text}
                        </div>
                      </div>
                      <Avatar who="user" />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <Avatar who="agent" />
                    <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-ink">本地 Agent</span>
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
                    <div className="group flex items-start gap-1.5">
                      <div
                        className={`inline-block rounded-xl rounded-tl-sm border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          m.error ? "border-up/40 text-up" : "text-ink"
                        }`}
                      >
                      {m.error ? (
                        m.text
                      ) : m.text ? (
                        <>
                          {renderMd(m.text, openDoc, docHints, openLink)}
                          {m.streaming ? <span className="animate-pulse">▍</span> : null}
                        </>
                      ) : m.streaming ? (
                        <span className="animate-pulse">▍</span>
                      ) : (
                        "…"
                      )}
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
            placeholder={
              phase !== "connected"
                ? "请先连接 WorkBuddy 网关"
                : restoring
                  ? "正在恢复会话上下文…"
                  : "给本地 Agent 派个任务… (Enter 发送, Shift+Enter 换行)"
            }
            disabled={phase !== "connected" || runningIds.has(currentId ?? "") || restoring}
            rows={1}
            style={{ maxHeight: INPUT_MAX_H }}
            className="min-h-[38px] flex-1 resize-none overflow-y-auto rounded-lg border border-line bg-page px-3 py-2 text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-50"
          />
          {runningIds.has(currentId ?? "") ? (
            <button
              onClick={stop}
              className="shrink-0 rounded-lg bg-up px-4 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={phase !== "connected" || restoring || runningIds.has(currentId ?? "") || !input.trim()}
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
      {/* ── 工作约定编辑对话框 ── */}
      {sysOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSysOpen(false);
          }}
        >
          <div className="flex w-[560px] max-w-[90vw] flex-col rounded-xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">工作约定（系统提示词）</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setSysOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-3">
              <textarea
                value={sysDraft}
                onChange={(e) => setSysDraft(e.target.value)}
                spellCheck={false}
                className="h-[260px] w-full resize-none rounded-lg border border-line bg-page px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
                placeholder="在此编辑工作约定…（激活会话时作为首条消息注入给 WorkBuddy）"
              />
              <div className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
                此约定会在<u>切换或重新进入会话</u>时作为首条消息注入 WorkBuddy；之后每次回复都会遵守。包括 Markdown
                格式、图片/文件引用方式等。
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setSysDraft(sysText);
                  setSysOpen(false);
                }}
                className="rounded-lg border border-line px-3.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-page"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveSysPrompt()}
                disabled={sysSaving}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-deep disabled:opacity-50"
              >
                {sysSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
      {linkView ? (
        <LinkPreviewModal
          view={linkView}
          onClose={() => setLinkView(null)}
          onOpenDoc={openDoc}
          docHints={docHints}
          onOpenLink={openLink}
        />
      ) : null}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onMouseDown={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-[61] min-w-[150px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 110) }}
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
      {extraView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setExtraView(null);
          }}
        >
          <div className="flex h-[70vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line bg-page px-3.5 py-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                📎 {extraView.title}
              </span>
              <button
                type="button"
                title="关闭"
                aria-label="关闭附加信息"
                onClick={() => setExtraView(null)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {extraView.items.map((it, i) => (
                <div key={i} className="mb-3 last:mb-0">
                  <div className="mb-1 text-[11px] font-semibold text-ink-muted">{it.title}</div>
                  <pre className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-page px-3 py-2 text-[12px] leading-relaxed text-ink">
                    {it.text}
                  </pre>
                </div>
              ))}
            </div>
          </div>
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
          renderMd(preview.text, onOpenDoc, docHints)
        )}
      </div>
    </div>
  );
}

/** 弹窗内嵌 webview (动态创建 Electron guest) */
function WebviewBox({ src }: { src: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wv = document.createElement("webview") as unknown as HTMLElement & { style: CSSStyleDeclaration };
    wv.setAttribute("src", src);
    wv.setAttribute("partition", "default");
    wv.style.cssText = "width:100%;height:100%;border:none;display:flex;";
    host.appendChild(wv);
    return () => {
      try {
        host.removeChild(wv);
      } catch {
        // 已移除
      }
    };
  }, [src]);
  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-white" />;
}

/** 链接/文件预览弹窗: url → 内嵌 webview; 本地文件按扩展名分发 (图片→img, html/pdf→webview, 文本→markdown/pre) */
const PREVIEW_IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const PREVIEW_DOC_EXT = ["html", "htm", "pdf"];
const extOf = (p: string) => (p.split(".").pop() ?? "").toLowerCase();
/** jsonl/log: 逐行 JSON.parse 后 pretty, 非 JSON 行保留原文 */
const prettyJsonl = (raw: string) =>
  raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.stringify(JSON.parse(l), null, 2);
      } catch {
        return l;
      }
    })
    .join("\n\n");

function LinkPreviewModal({
  view,
  onClose,
  onOpenDoc,
  docHints,
  onOpenLink,
}: {
  view: LinkView;
  onClose: () => void;
  onOpenDoc: (path: string, title: string) => void;
  docHints: string[];
  onOpenLink: (raw: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ext = view.kind === "file" ? extOf(view.path) : "";
  const isImg = PREVIEW_IMG_EXT.includes(ext);
  const isDoc = PREVIEW_DOC_EXT.includes(ext);
  const localFileUrl = (p: string) => `${window.location.origin}/api/local-file?path=${encodeURIComponent(p)}`;
  useEffect(() => {
    if (view.kind !== "file") return;
    if (isImg || isDoc) return; // 图片/html/pdf 不走文本拉取
    let dead = false;
    setText(null);
    setErr(null);
    void (async () => {
      try {
        const r = await fetch(`/api/local-file?path=${encodeURIComponent(view.path)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const t = await r.text();
        if (!dead) setText(t);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [view]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[82vh] w-[min(1100px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line bg-page px-3.5 py-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
            {view.kind === "url" ? "🔗 " : "📄 "}
            {view.title}
          </span>
          {view.kind === "url" ? (
            <span className="max-w-[280px] truncate font-mono text-[10.5px] text-ink-faint" title={view.url}>
              {view.url}
            </span>
          ) : (
            <span className="max-w-[280px] truncate font-mono text-[10.5px] text-ink-faint" title={view.path}>
              {view.path}
            </span>
          )}
          <button
            type="button"
            title="关闭"
            aria-label="关闭预览"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-white">
          {view.kind === "url" ? (
            <WebviewBox src={view.url} />
          ) : isImg ? (
            <div className="flex h-full items-center justify-center p-4">
              <img src={localFileUrl(view.path)} alt={view.title} className="max-h-full max-w-full object-contain" />
            </div>
          ) : isDoc ? (
            <WebviewBox src={localFileUrl(view.path)} />
          ) : err ? (
            <div className="p-4">
              <div className="rounded bg-up-soft px-2.5 py-2 text-[12px] leading-snug text-up">打开失败: {err}</div>
            </div>
          ) : text === null ? (
            <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
              <span className="animate-pulse">加载中…</span>
            </div>
          ) : ext === "jsonl" || ext === "log" ? (
            <div className="h-full overflow-y-auto px-4 py-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-ink">
                {prettyJsonl(text)}
              </pre>
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-ink">
              {renderMd(text, onOpenDoc, docHints, onOpenLink)}
            </div>
          )}
        </div>
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
/** IM 气泡头像: user = 品牌色「我」, agent = 浅色机器人图标 */
function Avatar({ who }: { who: "user" | "agent" }) {
  return who === "user" ? (
    <div className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
      我
    </div>
  ) : (
    <div className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-accent-soft text-accent">
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
  onOpenLink,
}: {
  text: string;
  onOpenDoc?: (path: string, title: string) => void;
  docHints?: string[];
  onOpenLink?: (raw: string) => void;
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
                    <Inline text={h} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-line px-2.5 py-1.5 align-top leading-relaxed">
                      <Inline text={c} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
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
            <Inline text={text} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
          </h4>
        ) : (
          <h5 key={`h-${i}`} className="mb-0.5 mt-2 text-[13px] font-semibold text-ink">
            <Inline text={text} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
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
              <Inline text={it} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
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
              <Inline text={it} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
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
              <Inline text={q} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
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
        <Inline text={para.join("\n")} onOpenDoc={onOpenDoc} docHints={docHints} onOpenLink={onOpenLink} />
      </p>,
    );
    i = j;
  }
  return out;
}
