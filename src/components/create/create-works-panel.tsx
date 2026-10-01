"use client";

// 作品创作面板 — 对齐 Snuby 设计 token 与本地 Agent 对话气质（spec 018 ui.md）

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Image as ImageIcon,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";
import WorkMarkdownEditor from "@/components/create/work-markdown-editor";
import WorkMdPreview from "@/components/create/work-md-preview";
import ResourceSidebar from "@/components/create/resource-sidebar";

type WorkMeta = {
  id: string;
  title: string;
  currentDraftId: string;
  folderId?: string | null;
  updatedAt: number;
};

type LibraryFolder = {
  id: string;
  name: string;
  parentId: string | null;
  workIds: string[];
};

type WorkLibrary = {
  folders: LibraryFolder[];
  rootWorkIds: string[];
};

type ResourceItem = {
  id: string;
  name: string;
  kind: string;
  url?: string | null;
  relativePath?: string | null;
  absolutePath?: string | null;
  note?: string;
};

type BranchNode = {
  id: string;
  parentId: string | null;
  createdAt: number;
  label?: string;
};

type CollabMsg = {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  ts: number;
  streaming?: boolean;
  queued?: boolean;
  thinking?: boolean;
  tools?: { tool: string; state?: string; detail?: string; toolCallId?: string; ts?: number }[];
};

type ViewMode = "draft" | "publish";
type AgentPhase = "idle" | "discovering" | "connecting" | "connected" | "error";

function fmtClock(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtDateTime(ts: number) {
  try {
    const d = new Date(ts);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return `${md} ${hm}`;
  } catch {
    return "";
  }
}

/** 正文有效字数（去空白） */
function countChars(text: string) {
  return text.replace(/\s+/g, "").length;
}

function shortTitleFrom(text: string, fallback = "未命名") {
  const line = text
    .split("\n")
    .map((s) => s.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  const t = (line || fallback).slice(0, 24);
  return t.length < (line || fallback).length ? `${t}…` : t;
}

/** 作品在库中的文件夹路径（不含标题） */
function workFolderPath(library: WorkLibrary, workId: string): string {
  const folder = library.folders.find((f) => f.workIds.includes(workId));
  if (!folder) return "未分类";
  const parts: string[] = [folder.name];
  let parentId = folder.parentId;
  const byId = new Map(library.folders.map((f) => [f.id, f]));
  while (parentId) {
    const p = byId.get(parentId);
    if (!p) break;
    parts.unshift(p.name);
    parentId = p.parentId;
  }
  return parts.join(" / ");
}

function draftTriggerLabel(nodes: BranchNode[], draftId: string, content: string) {
  const n = nodes.find((x) => x.id === draftId);
  const when = n ? fmtDateTime(n.createdAt) : "";
  const title = shortTitleFrom(n?.label || content, "当前稿");
  return when ? `${when} · ${title}` : title;
}

function Avatar({ who }: { who: "user" | "agent" }) {
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        who === "user" ? "bg-accent-soft text-accent-deep" : "bg-surface-2 text-ink-muted"
      }`}
    >
      {who === "user" ? "我" : "AI"}
    </div>
  );
}

function buildBranchTree(nodes: BranchNode[]) {
  const byParent = new Map<string | null, BranchNode[]>();
  for (const n of nodes) {
    const k = n.parentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(n);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.createdAt - b.createdAt);
  }
  return byParent;
}

/** git 风格布局：主链同轨；仅分叉占新轨，避免深度缩进把标签挤没 */
function layoutBranchRail(nodes: BranchNode[]): {
  node: BranchNode;
  lane: number;
  parentLane: number | null;
}[] {
  const byParent = buildBranchTree(nodes);
  const rows: { node: BranchNode; lane: number; parentLane: number | null }[] = [];
  let nextLane = 1;

  const walk = (n: BranchNode, lane: number, parentLane: number | null) => {
    rows.push({ node: n, lane, parentLane });
    const kids = byParent.get(n.id) ?? [];
    kids.forEach((kid, i) => {
      const isLast = i === kids.length - 1;
      const kidLane = isLast ? lane : nextLane++;
      walk(kid, kidLane, lane);
    });
  };

  for (const root of byParent.get(null) ?? []) {
    walk(root, 0, null);
  }
  return rows;
}

const DROP_SHADOW = "shadow-[0_16px_48px_rgba(28,31,36,0.22)]";
const DRAWER_SHADOW = "shadow-[-12px_0_40px_rgba(28,31,36,0.18),0_8px_32px_rgba(28,31,36,0.1)]";
const RAIL_LANE_W = 14;

function BranchTreeView(props: {
  nodes: BranchNode[];
  currentId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const rows = useMemo(() => layoutBranchRail(props.nodes), [props.nodes]);
  const maxLane = useMemo(() => rows.reduce((m, r) => Math.max(m, r.lane), 0), [rows]);
  const railW = 18 + maxLane * RAIL_LANE_W;

  useEffect(() => {
    const id = props.selectedId || props.currentId;
    if (!id) return;
    const el = document.querySelector(`[data-branch-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [props.selectedId, props.currentId, props.nodes]);

  if (!props.nodes.length) {
    return <div className="px-2 py-3 text-[12px] text-ink-faint">暂无版本</div>;
  }

  return (
    <div className="py-1">
      {rows.map((row, idx) => {
        const { node: n, lane, parentLane } = row;
        const current = n.id === props.currentId;
        const selected = n.id === props.selectedId;
        const label = shortTitleFrom(n.label || "", n.id.slice(0, 8));
        const next = rows[idx + 1];
        const continueLane = next && next.lane === lane;
        const canDelete = props.nodes.length > 1 && !!props.onDelete;
        const forkFrom = parentLane !== null && parentLane !== lane ? parentLane : null;

        return (
          <div
            key={n.id}
            data-branch-id={n.id}
            className={`group relative flex w-full items-stretch rounded-[6px] transition-colors hover:bg-hover ${
              selected ? "bg-accent-soft" : ""
            }`}
          >
            <div className="relative shrink-0" style={{ width: railW }} aria-hidden>
              {idx > 0 && (
                <span
                  className="absolute bg-line"
                  style={{
                    left: 7 + lane * RAIL_LANE_W,
                    top: 0,
                    width: 1.5,
                    height: "50%",
                  }}
                />
              )}
              {continueLane && (
                <span
                  className="absolute bg-line"
                  style={{
                    left: 7 + lane * RAIL_LANE_W,
                    top: "50%",
                    width: 1.5,
                    height: "50%",
                  }}
                />
              )}
              {forkFrom !== null && (
                <span
                  className="absolute bg-line"
                  style={{
                    left: 7 + Math.min(forkFrom, lane) * RAIL_LANE_W,
                    top: "50%",
                    width: Math.abs(lane - forkFrom) * RAIL_LANE_W,
                    height: 1.5,
                    transform: "translateY(-50%)",
                  }}
                />
              )}
              <span
                className={`absolute top-1/2 z-[1] h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 ${
                  current
                    ? "border-accent bg-accent"
                    : selected
                      ? "border-accent bg-white"
                      : "border-ink-faint bg-white"
                }`}
                style={{ left: 3 + lane * RAIL_LANE_W }}
              />
            </div>

            <button
              type="button"
              onClick={() => props.onSelect(n.id)}
              className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left text-[12.5px] ${
                selected ? "text-accent-deep" : "text-ink"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              {current && (
                <span className="shrink-0 rounded bg-ink/8 px-1 text-[10px] text-ink-faint">当前</span>
              )}
              <span className="shrink-0 tabular-nums text-[11px] text-ink-faint">
                {fmtDateTime(n.createdAt)}
              </span>
            </button>

            {canDelete && (
              <button
                type="button"
                title="删除此版本"
                aria-label={`删除 ${label}`}
                className="mr-1 hidden h-7 w-7 shrink-0 items-center self-center justify-center rounded text-ink-faint hover:bg-black/10 hover:text-up group-hover:flex"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete?.(n.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PHASE_META: Record<AgentPhase, { label: string; color: string; dot: string }> = {
  idle: { label: "未连接", color: "bg-ink-faint/20 text-ink-faint", dot: "bg-ink-faint" },
  discovering: {
    label: "正在发现网关…",
    color: "bg-ink-faint/20 text-ink-faint",
    dot: "bg-ink-faint animate-pulse",
  },
  connecting: {
    label: "正在建立连接…",
    color: "bg-accent-soft text-accent-deep",
    dot: "bg-accent animate-pulse",
  },
  connected: {
    label: "已连接",
    color: "bg-down-soft text-down",
    dot: "bg-down",
  },
  error: { label: "连接失败", color: "bg-up-soft text-up", dot: "bg-up" },
};

const COL_LEFT_MIN = 140;
const COL_LEFT_MAX = 360;
const COL_RIGHT_MIN = 280;
const COL_RIGHT_MAX = 560;
/** 资源侧栏最窄宽度（单栏：工具栏 + 预览 + 信息） */
const DRAWER_MIN = 360;


export default function CreateWorksPanel() {
  const [works, setWorks] = useState<WorkMeta[]>([]);
  const [library, setLibrary] = useState<WorkLibrary>({ folders: [], rootWorkIds: [] });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlName, setUrlName] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState<null | { kind: "folder" | "work"; id: string; name: string }>(
    null,
  );
  const [moveOpen, setMoveOpen] = useState<null | { workId: string; folderId: string | null }>(null);

  const [view, setView] = useState<ViewMode>("draft");
  const [content, setContent] = useState("");
  const [draftId, setDraftId] = useState("");
  const [contentSha1, setContentSha1] = useState("");
  const [dirty, setDirty] = useState(false);
  const [branches, setBranches] = useState<BranchNode[]>([]);
  const [draftMenuOpen, setDraftMenuOpen] = useState(false);
  const [previewDraftId, setPreviewDraftId] = useState<string | null>(null);
  const [previewDraftContent, setPreviewDraftContent] = useState("");
  const [editorMode, setEditorMode] = useState<"preview" | "source">("preview");

  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [resRevision, setResRevision] = useState(0);
  const [selectedRes, setSelectedRes] = useState<string | null>(null);
  const [resSidebarOpen, setResSidebarOpen] = useState(false);
  const [resSidebarMode, setResSidebarMode] = useState<"add" | "preview">("preview");
  const [resNote, setResNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [msgs, setMsgs] = useState<CollabMsg[]>([]);
  const [input, setInput] = useState("");
  const [capability, setCapability] = useState<"general" | "edit-draft">("general");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
  const [agentError, setAgentError] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [leftW, setLeftW] = useState(200);
  const [rightW, setRightW] = useState(360);
  const [drawerPaneW, setDrawerPaneW] = useState<number | null>(null);
  const [shellEl, setShellEl] = useState<HTMLElement | null>(null);
  const [shellH, setShellH] = useState(0);
  const [colDragging, setColDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const draftMenuRef = useRef<HTMLDivElement>(null);
  const drawerColRef = useRef<HTMLDivElement>(null);
  const drawerWRef = useRef(720);
  const colDragRef = useRef<null | {
    which: "left" | "right" | "drawer";
    startX: number;
    startW: number;
  }>(null);

  // 挂到 layout 的 <main>：比作品面板再外一层，覆盖 Topbar + 整块内容壳
  useEffect(() => {
    const el = document.querySelector("main");
    setShellEl(el);
    if (!el) return;
    const sync = () => setShellH(el.clientHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 默认侧栏宽度：避开常见移动断点，且可拖
  useEffect(() => {
    if (!resSidebarOpen || !shellEl) return;
    const mainW = shellEl.clientWidth;
    const w = Math.min(
      Math.round(mainW * 0.72),
      Math.max(DRAWER_MIN, Math.min(mainW - 48, 960)),
    );
    setDrawerPaneW(w);
    drawerWRef.current = w;
  }, [resSidebarOpen, shellEl, shellH]);

  const closeResSidebar = useCallback(() => {
    setResSidebarOpen(false);
    setSelectedRes(null);
    setResSidebarMode("preview");
  }, []);

  const openResAdd = useCallback(() => {
    setSelectedRes(null);
    setResSidebarMode("add");
    setResSidebarOpen(true);
  }, []);

  const openResPreview = useCallback((id: string) => {
    setSelectedRes(id);
    setResSidebarMode("preview");
    setResSidebarOpen(true);
  }, []);

  const current = useMemo(
    () => works.find((w) => w.id === currentId) ?? null,
    [works, currentId],
  );

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/work");
    const j = (await res.json()) as { works: WorkMeta[]; library: WorkLibrary };
    setWorks(j.works || []);
    setLibrary(j.library || { folders: [], rootWorkIds: [] });
    return j.works || [];
  }, []);

  const loadDraft = useCallback(async (workId: string) => {
    const [d, b, r] = await Promise.all([
      fetch(`/api/work/${workId}/draft`).then((x) => x.json()),
      fetch(`/api/work/${workId}/draft/branches`).then((x) => x.json()),
      fetch(`/api/work/${workId}/resources`).then((x) => x.json()),
    ]);
    setContent(d.content ?? "");
    setDraftId(d.draftId ?? "");
    setContentSha1(d.contentSha1 ?? "");
    setDirty(false);
    setBranches(b.branches?.nodes ?? []);
    setResources(r.items ?? []);
    setResRevision(r.revision ?? 0);
  }, []);

  const loadScopeMessages = useCallback(
    async (scope: string, extra?: { resourceId?: string }) => {
      if (!currentId) return;
      const q = new URLSearchParams({ scope, limit: "80" });
      if (extra?.resourceId) q.set("resourceId", extra.resourceId);
      const m = await fetch(`/api/work/${currentId}/messages?${q}`).then((x) => x.json());
      setMsgs(m.messages ?? []);
    },
    [currentId],
  );

  useEffect(() => {
    void (async () => {
      const list = await refreshList();
      if (list.length && !currentId) setCurrentId(list[0].id);
    })();
  }, [refreshList, currentId]);

  useEffect(() => {
    if (currentId) {
      void loadDraft(currentId);
      void loadScopeMessages("draft");
    }
  }, [currentId, loadDraft, loadScopeMessages]);

  useEffect(() => {
    if (!draftMenuOpen || !currentId || !previewDraftId) {
      if (!previewDraftId) setPreviewDraftContent("");
      return;
    }
    let alive = true;
    void (async () => {
      const d = await fetch(
        `/api/work/${currentId}/draft?draftId=${encodeURIComponent(previewDraftId)}`,
      ).then((x) => x.json());
      if (alive) setPreviewDraftContent(d.content || "");
    })();
    return () => {
      alive = false;
    };
  }, [draftMenuOpen, currentId, previewDraftId]);

  useEffect(() => {
    if (draftMenuOpen && draftId) {
      setPreviewDraftId(draftId);
    } else if (!draftMenuOpen) {
      setPreviewDraftId(null);
      setPreviewDraftContent("");
    }
  }, [draftMenuOpen, draftId]);

  // 文章下拉打开时默认预览当前作品，并滚到可见
  useEffect(() => {
    if (!pickerOpen) return;
    const fallback =
      currentId ||
      library.rootWorkIds[0] ||
      library.folders.find((f) => f.workIds.length)?.workIds[0] ||
      null;
    if (fallback) void previewWork(fallback);
  }, [pickerOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- 仅在打开时定位

  useEffect(() => {
    if (!pickerOpen || !previewId) return;
    const t = window.setTimeout(() => {
      document
        .querySelector(`[data-work-id="${CSS.escape(previewId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [pickerOpen, previewId]);

  // 点击空白关闭下拉
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(t)) setPickerOpen(false);
      if (draftMenuOpen && draftMenuRef.current && !draftMenuRef.current.contains(t)) {
        setDraftMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen, draftMenuOpen]);

  useEffect(() => {
    if (!selectedRes) {
      setResNote("");
      return;
    }
    setResNote(resources.find((r) => r.id === selectedRes)?.note || "");
  }, [selectedRes, resources]);

  // 与本地 Agent 共用连接态
  const refreshAgentStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/status", { cache: "no-store" });
      const j = (await r.json()) as { status?: { phase?: AgentPhase; lastError?: string } };
      setAgentPhase(j.status?.phase ?? "idle");
      setAgentError(j.status?.lastError || "");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshAgentStatus();
    const t = setInterval(() => void refreshAgentStatus(), 4000);
    return () => clearInterval(t);
  }, [refreshAgentStatus]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = colDragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      if (d.which === "left") {
        setLeftW(Math.min(COL_LEFT_MAX, Math.max(COL_LEFT_MIN, d.startW + delta)));
      } else if (d.which === "right") {
        setRightW(Math.min(COL_RIGHT_MAX, Math.max(COL_RIGHT_MIN, d.startW - delta)));
      } else {
        // 侧栏整体宽度：左缘拖动；直接改 DOM，避免每帧 setState
        const mainW = drawerColRef.current?.parentElement?.clientWidth ?? 1200;
        const max = Math.max(DRAWER_MIN, mainW - 48);
        const w = Math.min(max, Math.max(DRAWER_MIN, d.startW - delta));
        drawerWRef.current = w;
        if (drawerColRef.current) drawerColRef.current.style.width = `${w}px`;
      }
    };
    const onUp = () => {
      const d = colDragRef.current;
      colDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setColDragging(false);
      if (d?.which === "drawer") setDrawerPaneW(drawerWRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const connectAgent = async () => {
    setAgentBusy(true);
    setAgentPhase("connecting");
    try {
      const r = await fetch("/api/agent/connect", { method: "POST" });
      const j = (await r.json()) as { status?: { phase?: AgentPhase; lastError?: string }; error?: string };
      setAgentPhase(j.status?.phase ?? (r.ok ? "connected" : "error"));
      setAgentError(j.status?.lastError || j.error || "");
    } catch {
      setAgentPhase("error");
      setAgentError("本地服务无响应");
    } finally {
      setAgentBusy(false);
    }
  };

  const libraryAction = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/work/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "操作失败");
      return false;
    }
    await refreshList();
    return true;
  };

  const switchWork = async (id: string) => {
    if (dirty && !window.confirm("当前稿件未保存，切换将丢弃未保存修改。继续？")) return;
    setCurrentId(id);
    setPickerOpen(false);
    closeResSidebar();
  };

  const createWork = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const res = await fetch("/api/work", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, folderId: newFolderId }),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "创建失败");
      return;
    }
    setNewOpen(false);
    setNewTitle("");
    await refreshList();
    setCurrentId(j.work.id);
    setPickerOpen(false);
  };

  const saveDraft = async () => {
    if (!currentId) return;
    const res = await fetch(`/api/work/${currentId}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        baseline: { draftId, contentSha1 },
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "保存失败");
      if (j.code === "draft_conflict") {
        if (window.confirm("磁盘已被修改。重新加载磁盘版本？")) await loadDraft(currentId);
      }
      return;
    }
    setStatus(j.unchanged ? "内容无变更" : "已保存为新版本");
    await loadDraft(currentId);
    await refreshList();
  };

  const checkout = async (id: string) => {
    if (!currentId) return;
    if (dirty && !window.confirm("未保存修改将丢失，确认切换版本？")) return;
    const res = await fetch(`/api/work/${currentId}/draft/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: id }),
    });
    if (!res.ok) {
      const j = await res.json();
      setStatus(j.error || "切换失败");
      return;
    }
    setDraftMenuOpen(false);
    await loadDraft(currentId);
  };

  const deleteDraftVersion = async (id: string) => {
    if (!currentId) return;
    if (branches.length <= 1) {
      setStatus("至少保留一个稿件版本");
      return;
    }
    const label = shortTitleFrom(
      branches.find((b) => b.id === id)?.label || "",
      id.slice(0, 8),
    );
    const isCurrent = id === draftId;
    const msg = isCurrent
      ? `删除当前版本「${label}」？子版本会接到上一节点，并自动切到父版本。`
      : `删除版本「${label}」？其子版本会自动接到上一节点。`;
    if (!window.confirm(msg)) return;
    if (isCurrent && dirty && !window.confirm("编辑器有未保存修改，删除当前版本将丢弃。继续？")) {
      return;
    }
    const res = await fetch(
      `/api/work/${currentId}/draft?draftId=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(j.error || "删除失败");
      return;
    }
    setStatus("已删除版本");
    if (previewDraftId === id) {
      setPreviewDraftId(j.currentId ?? null);
    }
    await loadDraft(currentId);
  };

  const submitUrl = async (urlArg?: string, nameArg?: string) => {
    const url = (urlArg ?? urlValue).trim();
    const name = (nameArg ?? urlName).trim();
    if (!currentId || !url) return;
    const res = await fetch(`/api/work/${currentId}/resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "url",
        url,
        name: name || url,
        baseRevision: resRevision,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "添加失败");
      return;
    }
    const items = (j.file.items ?? []) as ResourceItem[];
    setResources(items);
    setResRevision(j.file.revision);
    setUrlOpen(false);
    setUrlValue("");
    setUrlName("");
    setStatus("已添加链接");
    const added =
      items.find((x) => x.url === url) ||
      [...items].reverse().find((x) => x.kind === "url");
    if (added) openResPreview(added.id);
  };

  const onDropFiles = async (files: FileList | null) => {
    if (!currentId || !files?.length) return;
    let lastId: string | null = null;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("baseRevision", String(resRevision));
      const res = await fetch(`/api/work/${currentId}/resources`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        setStatus(j.error || `${file.name} 上传失败`);
        continue;
      }
      const items = (j.file.items ?? []) as ResourceItem[];
      setResources(items);
      setResRevision(j.file.revision);
      const hit =
        items.find((x) => x.name === file.name) ||
        [...items].reverse().find((x) => x.kind !== "url");
      if (hit) lastId = hit.id;
    }
    if (lastId && resSidebarOpen) openResPreview(lastId);
  };

  const saveResNote = async () => {
    if (!currentId || !selectedRes) return;
    const res = await fetch(`/api/work/${currentId}/resources/${selectedRes}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: resNote, baseRevision: resRevision }),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "保存 note 失败");
      return;
    }
    setResources(j.file.items);
    setResRevision(j.file.revision);
    setStatus("note 已保存");
  };

  const deleteRes = async (rid: string) => {
    if (!currentId || !window.confirm("删除该资源？")) return;
    const res = await fetch(
      `/api/work/${currentId}/resources/${rid}?baseRevision=${resRevision}`,
      { method: "DELETE" },
    );
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "删除失败");
      return;
    }
    setResources(j.file.items);
    setResRevision(j.file.revision);
    if (selectedRes === rid) closeResSidebar();
  };

  const sendAgent = async () => {
    if (!currentId || !input.trim() || running) return;
    if (agentPhase !== "connected") {
      setStatus("请先连接 ACP");
      return;
    }
    const scope = "draft";
    const cap = capability;

    setRunning(true);
    setStatus("发送中…");
    const userText = input.trim();
    setInput("");
    const startedAt = Date.now();
    setMsgs((prev) => [
      ...prev,
      { role: "user", text: userText, ts: startedAt },
      {
        role: "assistant",
        text: "",
        ts: startedAt + 1,
        streaming: true,
        queued: true,
        tools: [],
      },
    ]);

    const patchAssistant = (fn: (m: CollabMsg) => CollabMsg) => {
      setMsgs((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant" && copy[i].streaming) {
            copy[i] = fn(copy[i]);
            break;
          }
        }
        return copy;
      });
    };

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/work/${currentId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          text: userText,
          capability: cap,
          scope,
          draftDirty: dirty,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const err = j.error || `发送失败 ${res.status}`;
        setStatus(err);
        patchAssistant((m) => ({
          ...m,
          text: err,
          error: true,
          streaming: false,
          queued: false,
        }));
        setRunning(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        patchAssistant((m) => ({
          ...m,
          text: "无法读取响应流",
          error: true,
          streaming: false,
          queued: false,
        }));
        setRunning(false);
        return;
      }
      const dec = new TextDecoder();
      let buf = "";
      let assistant = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim() || line.startsWith(" ")) continue;
          try {
            const ev = JSON.parse(line) as {
              type: string;
              text?: string;
              error?: string;
              aheadTitle?: string;
              tool?: string;
              state?: string;
              detail?: string;
              toolCallId?: string;
            };
            if (ev.type === "queued") {
              setStatus(`排队中（前序：${ev.aheadTitle || "…"}）`);
              patchAssistant((m) => ({ ...m, queued: true, streaming: true }));
            }
            if (ev.type === "running") {
              setStatus("运行中…");
              patchAssistant((m) => ({ ...m, queued: false, streaming: true }));
            }
            if (ev.type === "thought") {
              patchAssistant((m) => ({ ...m, thinking: true, queued: false, streaming: true }));
            }
            if (ev.type === "tool" && ev.tool) {
              const toolEv = {
                tool: ev.tool,
                state: ev.state,
                detail: ev.detail,
                toolCallId: ev.toolCallId,
                ts: Date.now(),
              };
              patchAssistant((m) => ({
                ...m,
                queued: false,
                thinking: false,
                streaming: true,
                tools: [...(m.tools ?? []), toolEv],
              }));
              setStatus(`工具：${ev.tool}${ev.state ? ` · ${ev.state}` : ""}`);
            }
            if (ev.type === "chunk" && ev.text) {
              assistant += ev.text;
              const textNow = assistant;
              patchAssistant((m) => ({
                ...m,
                text: textNow,
                thinking: false,
                queued: false,
                streaming: true,
              }));
            }
            if (ev.type === "draft_checkpoint") {
              setStatus("AI 已写入正文并生成新版本");
            }
            if (ev.type === "error") {
              const err = ev.error || "错误";
              setStatus(err);
              patchAssistant((m) => ({
                ...m,
                text: m.text?.trim() ? m.text : err,
                error: true,
                streaming: false,
                queued: false,
              }));
            }
            if (ev.type === "done") {
              setStatus("完成");
              patchAssistant((m) => ({
                ...m,
                streaming: false,
                queued: false,
                thinking: false,
                text:
                  m.text?.trim() ||
                  (m.tools?.length
                    ? `本轮已完成（调用了 ${[...new Set(m.tools.map((t) => t.tool))].join("、")}）`
                    : "本轮已完成"),
              }));
            }
          } catch {
            /* skip */
          }
        }
      }
      patchAssistant((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              queued: false,
              thinking: false,
              text:
                m.text?.trim() ||
                (m.tools?.length
                  ? `本轮已完成（调用了 ${[...new Set(m.tools.map((t) => t.tool))].join("、")}）`
                  : m.text),
            }
          : m,
      );
      await loadDraft(currentId);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const msg = (e as Error).message;
        setStatus(msg);
        patchAssistant((m) => ({
          ...m,
          text: msg || "请求中断",
          error: true,
          streaming: false,
          queued: false,
        }));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  /** 资源侧栏「一键解读」：不污染稿件 Agent 对话，只刷新 note */
  const runInterpret = async (prompt: string) => {
    if (!currentId || !selectedRes || !prompt.trim() || running) return;
    if (agentPhase !== "connected") {
      setStatus("请先连接 ACP");
      return;
    }
    const cap =
      resources.find((r) => r.id === selectedRes)?.kind === "url"
        ? "analyze-url"
        : "resource-note";

    setRunning(true);
    setStatus("解读中…");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/work/${currentId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          text: prompt.trim(),
          capability: cap,
          scope: "resource",
          resourceId: selectedRes,
          draftDirty: dirty,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setStatus(j.error || `解读失败 ${res.status}`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setStatus("无法读取响应流");
        return;
      }
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim() || line.startsWith(" ")) continue;
          try {
            const ev = JSON.parse(line) as {
              type: string;
              error?: string;
              aheadTitle?: string;
              tool?: string;
              state?: string;
            };
            if (ev.type === "queued") setStatus(`排队中（前序：${ev.aheadTitle || "…"}）`);
            if (ev.type === "running") setStatus("解读中…");
            if (ev.type === "tool" && ev.tool) {
              setStatus(`工具：${ev.tool}${ev.state ? ` · ${ev.state}` : ""}`);
            }
            if (ev.type === "error") setStatus(ev.error || "解读出错");
            if (ev.type === "done") setStatus("解读完成，已尝试写入 note");
          } catch {
            /* skip */
          }
        }
      }
      const r = await fetch(`/api/work/${currentId}/resources`).then((x) => x.json());
      setResources(r.items ?? []);
      setResRevision(r.revision ?? 0);
      setResNote(r.items?.find((x: ResourceItem) => x.id === selectedRes)?.note || "");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus((e as Error).message || "解读中断");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const previewWork = async (id: string) => {
    setPreviewId(id);
    const d = await fetch(`/api/work/${id}/draft`).then((x) => x.json());
    setPreviewContent(d.content || "");
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    const res = await fetch("/api/work/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createFolder",
        name,
        parentId: folderParentId,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "操作失败");
      return;
    }
    await refreshList();
    if (j.folder?.id && newOpen) setNewFolderId(j.folder.id);
    setFolderOpen(false);
    setFolderName("");
    setStatus("已新建文件夹");
  };

  const submitRename = async () => {
    if (!renameOpen) return;
    const name = renameOpen.name.trim();
    if (!name) return;
    const ok =
      renameOpen.kind === "folder"
        ? await libraryAction({ action: "renameFolder", folderId: renameOpen.id, name })
        : await libraryAction({ action: "renameWork", workId: renameOpen.id, title: name });
    if (ok) {
      setRenameOpen(null);
      setStatus("已重命名");
    }
  };

  const submitMove = async () => {
    if (!moveOpen) return;
    const ok = await libraryAction({
      action: "moveWork",
      workId: moveOpen.workId,
      folderId: moveOpen.folderId,
    });
    if (ok) {
      setMoveOpen(null);
      setStatus("已移动");
    }
  };

  const selectedResource = resources.find((r) => r.id === selectedRes) ?? null;
  const draftLabel = draftTriggerLabel(branches, draftId, content);
  const dropdownH = shellH > 0 ? Math.round(shellH * 0.7) : undefined;

  const draftPicker = (
    <div className="relative min-w-0 max-w-[min(320px,42vw)]" ref={draftMenuRef}>
      <button
        type="button"
        className="flex max-w-full items-center gap-1 truncate rounded-[6px] border border-line bg-page px-2.5 py-1 text-left text-[12.5px] hover:bg-hover"
        title={draftLabel}
        onClick={() => setDraftMenuOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">当前稿件 · {draftLabel}</span>
        <span className="shrink-0 text-ink-faint">▾</span>
      </button>
      {draftMenuOpen && (
        <div
          className={`absolute left-0 top-full z-30 mt-1 flex w-[min(720px,94vw)] overflow-hidden rounded-[12px] border border-line bg-white ${DROP_SHADOW}`}
          style={dropdownH ? { height: dropdownH } : { maxHeight: "70vh" }}
        >
          <div className="w-60 shrink-0 overflow-y-auto overflow-x-hidden border-r border-line bg-white p-2">
            <div className="px-1.5 py-1 text-[11px] font-medium text-ink-faint">版本演进</div>
            <BranchTreeView
              nodes={branches}
              currentId={draftId}
              selectedId={previewDraftId}
              onSelect={(id) => setPreviewDraftId(id)}
              onDelete={(id) => void deleteDraftVersion(id)}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
            {previewDraftId ? (
              <>
                <div className="flex min-w-0 shrink-0 items-baseline gap-2 border-b border-line bg-white px-3 py-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                    {shortTitleFrom(
                      branches.find((b) => b.id === previewDraftId)?.label || previewDraftContent,
                      previewDraftId.slice(0, 8),
                    )}
                  </span>
                  <span className="min-w-0 truncate text-[11px] tabular-nums text-ink-faint">
                    {fmtDateTime(branches.find((b) => b.id === previewDraftId)?.createdAt || 0)}
                    <span className="mx-1 text-ink-faint/50">·</span>
                    {countChars(previewDraftContent).toLocaleString("zh-CN")} 字
                    {previewDraftId === draftId && (
                      <>
                        <span className="mx-1 text-ink-faint/50">·</span>
                        <span className="text-accent-deep">当前</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white px-4 py-3">
                  <WorkMdPreview content={previewDraftContent} empty="加载预览…" />
                </div>
                <div className="flex justify-end gap-2 border-t border-line bg-white p-2">
                  {previewDraftId && branches.length > 1 && (
                    <button
                      type="button"
                      className="rounded-[6px] border border-line px-3 py-1.5 text-[13px] text-up hover:bg-up-soft"
                      onClick={() => void deleteDraftVersion(previewDraftId)}
                    >
                      删除此版本
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={previewDraftId === draftId}
                    className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-40 hover:bg-accent-deep"
                    onClick={() => void checkout(previewDraftId)}
                  >
                    {previewDraftId === draftId ? "已是当前稿件" : "切换到此版本"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-4 text-[12.5px] text-ink-faint">
                点选左侧版本查看预览
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page text-ink">
      {/* 顶栏：作品创作 + 当前作品下拉 + 右侧新建 */}
      <div className="flex h-[42px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <div className="flex shrink-0 items-center">
          <span className="text-[14.5px] font-semibold">作品创作</span>
          <span className="ml-2.5 text-[12.5px] text-ink-faint">创作中心</span>
        </div>

        <div className="relative min-w-0 w-[min(440px,48vw)]" ref={pickerRef}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[6px] border border-line bg-page px-3 py-1.5 text-[13px] hover:bg-hover"
            onClick={() => setPickerOpen((v) => !v)}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {current ? current.title : "选择或新建作品"}
            </span>
            <span className="shrink-0 text-ink-faint">▾</span>
          </button>
          {pickerOpen && (
            <div
              className={`absolute left-0 top-full z-40 mt-1 flex w-[min(720px,94vw)] overflow-hidden rounded-[12px] border border-line bg-white ${DROP_SHADOW}`}
              style={dropdownH ? { height: dropdownH } : { maxHeight: "70vh" }}
            >
              <div className="w-60 shrink-0 overflow-y-auto overflow-x-hidden border-r border-line bg-white p-2">
                <button
                  type="button"
                  className="mb-2 w-full rounded-[6px] border border-dashed border-line px-2 py-1.5 text-[12px] text-ink-muted hover:bg-hover"
                  onClick={() => {
                    setFolderParentId(null);
                    setFolderName("");
                    setFolderOpen(true);
                  }}
                >
                  + 新建文件夹
                </button>
                {library.folders.map((f) => (
                  <div key={f.id} className="mb-2">
                    <div className="group flex items-center gap-1 px-1.5 py-0.5">
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-faint">
                        📁 {f.name}
                      </span>
                      <button
                        type="button"
                        className="hidden text-[10px] text-ink-faint group-hover:inline hover:text-ink"
                        onClick={() => setRenameOpen({ kind: "folder", id: f.id, name: f.name })}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="hidden text-[10px] text-ink-faint group-hover:inline hover:text-ink"
                        onClick={() => {
                          setFolderParentId(f.id);
                          setFolderName("");
                          setFolderOpen(true);
                        }}
                      >
                        +子
                      </button>
                    </div>
                    {f.workIds.map((wid) => {
                      const w = works.find((x) => x.id === wid);
                      if (!w) return null;
                      return (
                        <div key={wid} className="group flex items-center gap-0.5">
                          <button
                            type="button"
                            data-work-id={wid}
                            className={`min-w-0 flex-1 truncate rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-hover ${previewId === wid ? "bg-accent-soft text-accent-deep" : ""}`}
                            onClick={() => void previewWork(wid)}
                            onDoubleClick={() => void switchWork(wid)}
                          >
                            {w.title}
                          </button>
                          <button
                            type="button"
                            className="hidden shrink-0 px-1 text-[10px] text-ink-faint group-hover:inline hover:text-ink"
                            onClick={() => setRenameOpen({ kind: "work", id: wid, name: w.title })}
                          >
                            改
                          </button>
                          <button
                            type="button"
                            className="hidden shrink-0 px-1 text-[10px] text-ink-faint group-hover:inline hover:text-ink"
                            onClick={() => setMoveOpen({ workId: wid, folderId: f.id })}
                          >
                            移
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="px-1.5 py-0.5 text-[11px] font-medium text-ink-faint">未分类</div>
                {library.rootWorkIds.map((wid) => {
                  const w = works.find((x) => x.id === wid);
                  if (!w) return null;
                  return (
                    <div key={wid} className="group flex items-center gap-0.5">
                      <button
                        type="button"
                        data-work-id={wid}
                        className={`min-w-0 flex-1 truncate rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-hover ${previewId === wid ? "bg-accent-soft text-accent-deep" : ""}`}
                        onClick={() => void previewWork(wid)}
                        onDoubleClick={() => void switchWork(wid)}
                      >
                        {w.title}
                      </button>
                      <button
                        type="button"
                        className="hidden shrink-0 px-1 text-[10px] text-ink-faint group-hover:inline hover:text-ink"
                        onClick={() => setRenameOpen({ kind: "work", id: wid, name: w.title })}
                      >
                        改
                      </button>
                      <button
                        type="button"
                        className="hidden shrink-0 px-1 text-[10px] text-ink-faint group-hover:inline hover:text-ink"
                        onClick={() => setMoveOpen({ workId: wid, folderId: null })}
                      >
                        移
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
                {previewId ? (
                  <>
                    <div className="flex min-w-0 shrink-0 items-baseline gap-2 border-b border-line bg-white px-3 py-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                        {works.find((w) => w.id === previewId)?.title || "作品"}
                      </span>
                      <span className="min-w-0 truncate text-[11px] tabular-nums text-ink-faint">
                        {workFolderPath(library, previewId)}
                        <span className="mx-1 text-ink-faint/50">·</span>
                        {fmtDateTime(works.find((w) => w.id === previewId)?.updatedAt || 0)}
                        <span className="mx-1 text-ink-faint/50">·</span>
                        {countChars(previewContent).toLocaleString("zh-CN")} 字
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white px-4 py-3">
                      <WorkMdPreview content={previewContent} />
                    </div>
                    <div className="flex justify-end border-t border-line bg-white p-2">
                      <button
                        type="button"
                        className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
                        onClick={() => void switchWork(previewId)}
                      >
                        切换到此作品
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-4 text-[12.5px] text-ink-faint">
                    点选左侧作品预览当前稿
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {status ? (
            <span className="max-w-[min(280px,28vw)] truncate text-[12px] text-ink-faint" title={status}>
              {status}
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
            新建作品
          </button>
        </div>
      </div>

      {/* 工具区：视图 + 稿件 */}
      {current && (
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
          <div className="flex overflow-hidden rounded-[7px] border border-line">
            {(
              [
                ["draft", "稿件创作"],
                ["publish", "发布"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`px-3 py-1 text-[12.5px] ${view === k ? "bg-white font-medium text-ink" : "bg-transparent text-ink-muted hover:text-ink"}`}
                onClick={() => {
                  setView(k);
                  if (k === "publish") closeResSidebar();
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {draftPicker}

          {dirty && <span className="text-[12px] text-up">未保存</span>}
          {running && <span className="text-[12px] text-accent-deep">作品内任务进行中</span>}
          {view === "publish" && (
            <span className="text-[12px] text-ink-faint">发布基于上方所选当前稿件</span>
          )}
        </div>
      )}

      {!current ? (
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent px-4 py-2 text-[13px] text-white hover:bg-accent-deep"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
            新建作品
          </button>
        </div>
      ) : view === "publish" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-ink-muted">
          <p className="text-[14px]">发布视图骨架</p>
          <p className="text-[12.5px] text-ink-faint">
            将基于当前稿件 <span className="font-mono text-ink">{draftId.slice(0, 14)}</span>{" "}
            生成发布项（后续接入）
          </p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* 资源栏 */}
          <div
            className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface"
            style={{ width: leftW }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onDropFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex items-center justify-between gap-1 border-b border-line px-2 py-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">
                资源
              </span>
              <button
                type="button"
                title="添加 / 管理资源"
                aria-label="打开资源侧栏"
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
                onClick={openResAdd}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".md,.txt,.markdown,.png,.jpg,.jpeg,.gif,.webp"
                multiple
                onChange={(e) => {
                  void onDropFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
              <div className="flex flex-col gap-0.5">
                {resources.map((r) => {
                  const Icon =
                    r.kind === "url" ? Link2 : r.kind === "media" ? ImageIcon : FileText;
                  const active = resSidebarOpen && selectedRes === r.id;
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openResPreview(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openResPreview(r.id);
                      }}
                      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] ${
                        active
                          ? "bg-accent-soft font-medium text-accent-deep"
                          : "text-ink hover:bg-black/5"
                      }`}
                      title={r.name}
                    >
                      <Icon
                        className={`h-3.5 w-3.5 shrink-0 ${active ? "text-accent" : "text-ink-faint"}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <button
                        type="button"
                        title="删除资源"
                        aria-label={`删除 ${r.name}`}
                        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors group-hover:flex hover:bg-black/10 hover:text-up"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteRes(r.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {!resources.length && (
                <div className="px-1 py-2 text-[11.5px] leading-relaxed text-ink-faint">
                  点 + 打开侧栏添加，也可拖入图片、md、txt
                </div>
              )}
            </div>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            title="拖动调整资源栏宽度"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/30 active:bg-accent/40"
            onMouseDown={(e) => {
              e.preventDefault();
              colDragRef.current = { which: "left", startX: e.clientX, startW: leftW };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />

          {/* 中：编辑器 */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-line bg-surface">
            <WorkMarkdownEditor
              value={content}
              mode={editorMode}
              onModeChange={setEditorMode}
              onChange={(v) => {
                setContent(v);
                setDirty(true);
              }}
            />
            <div className="flex h-10 shrink-0 items-center justify-between border-t border-line px-3">
              <span className="text-[12px] text-ink-faint">
                {content.length} 字 · {dirty ? "未保存" : "已同步磁盘"}
              </span>
              <button
                type="button"
                className="rounded-[6px] bg-ink px-3 py-1 text-[12.5px] text-white hover:bg-ink/90 disabled:opacity-40"
                onClick={() => void saveDraft()}
              >
                保存
              </button>
            </div>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            title="拖动调整 Agent 栏宽度"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/30 active:bg-accent/40"
            onMouseDown={(e) => {
              e.preventDefault();
              colDragRef.current = { which: "right", startX: e.clientX, startW: rightW };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />

          {/* 右：稿件 Agent */}
          <div className="flex shrink-0 flex-col overflow-hidden" style={{ width: rightW }}>
            <AgentPane
              title="稿件 Agent"
              msgs={msgs}
              input={input}
              setInput={setInput}
              running={running}
              agentPhase={agentPhase}
              agentError={agentError}
              agentBusy={agentBusy}
              onConnect={() => void connectAgent()}
              onSend={() => void sendAgent()}
              toolbar={
                <select
                  className="rounded-[6px] border border-line bg-page px-1.5 py-0.5 text-[11.5px] text-ink-muted"
                  value={capability}
                  onChange={(e) => setCapability(e.target.value as "general" | "edit-draft")}
                  disabled={running || agentPhase !== "connected"}
                >
                  <option value="general">general</option>
                  <option value="edit-draft">edit-draft</option>
                </select>
              }
            />
          </div>
        </div>
      )}

      {/* 资源侧栏：添加 / 预览共用；Portal 到 <main> */}
      {resSidebarOpen &&
        shellEl &&
        createPortal(
          <div className="absolute inset-0 z-50">
            <div className="absolute inset-0 bg-ink/15" onMouseDown={closeResSidebar} />
            <div
              ref={drawerColRef}
              className={`absolute bottom-0 right-0 top-0 z-10 flex flex-col overflow-hidden rounded-l-[var(--radius-shell)] border border-r-0 border-line bg-white ${DRAWER_SHADOW}`}
              style={{ width: drawerPaneW ?? "72%" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                title="拖动调整侧栏宽度"
                className="absolute bottom-0 left-0 top-0 z-30 w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/40"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drawerWRef.current = drawerPaneW ?? drawerColRef.current?.clientWidth ?? 720;
                  colDragRef.current = {
                    which: "drawer",
                    startX: e.clientX,
                    startW: drawerWRef.current,
                  };
                  setColDragging(true);
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
              >
                <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
              </div>
              <div
                className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${colDragging ? "pointer-events-none select-none" : ""}`}
              >
                <ResourceSidebar
                  mode={resSidebarMode === "preview" && selectedResource ? "preview" : "add"}
                  resource={selectedResource}
                  resNote={resNote}
                  setResNote={setResNote}
                  running={running}
                  agentPhase={agentPhase}
                  onClose={closeResSidebar}
                  onSaveNote={() => void saveResNote()}
                  onInterpret={(p) => void runInterpret(p)}
                  onAddUrl={(url, name) => void submitUrl(url, name)}
                  onPickFiles={() => fileInputRef.current?.click()}
                />
              </div>
              {colDragging && <div className="absolute inset-0 z-20 cursor-col-resize" />}
            </div>
          </div>,
          shellEl,
        )}

      {/* 新建作品 */}
      {newOpen && (
        <Modal onClose={() => setNewOpen(false)} title="新建作品">
          <label className="mb-1 block text-[12px] text-ink-faint">名称</label>
          <input
            className="mb-3 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/50"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <label className="mb-1 block text-[12px] text-ink-faint">放置目录</label>
          <div className="mb-4 flex gap-2">
            <select
              className="min-w-0 flex-1 rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px]"
              value={newFolderId ?? ""}
              onChange={(e) => setNewFolderId(e.target.value || null)}
            >
              <option value="">未分类（根）</option>
              {library.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="shrink-0 rounded-[6px] border border-line px-2.5 py-1.5 text-[12px] hover:bg-hover"
              onClick={() => {
                setFolderParentId(null);
                setFolderName("");
                setFolderOpen(true);
              }}
            >
              新建文件夹
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover" onClick={() => setNewOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
              onClick={() => void createWork()}
            >
              确定
            </button>
          </div>
        </Modal>
      )}

      {/* 添加链接（替代 prompt，Electron 可靠） */}
      {urlOpen && (
        <Modal onClose={() => setUrlOpen(false)} title="添加链接资源">
          <label className="mb-1 block text-[12px] text-ink-faint">URL</label>
          <input
            className="mb-3 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/50"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="https://"
            autoFocus
          />
          <label className="mb-1 block text-[12px] text-ink-faint">名称（可选）</label>
          <input
            className="mb-4 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px]"
            value={urlName}
            onChange={(e) => setUrlName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover" onClick={() => setUrlOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
              onClick={() => void submitUrl()}
            >
              添加
            </button>
          </div>
        </Modal>
      )}

      {folderOpen && (
        <Modal onClose={() => setFolderOpen(false)} title="新建文件夹">
          <label className="mb-1 block text-[12px] text-ink-faint">名称</label>
          <input
            className="mb-3 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/50"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void createFolder();
            }}
          />
          <label className="mb-1 block text-[12px] text-ink-faint">父目录</label>
          <select
            className="mb-4 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px]"
            value={folderParentId ?? ""}
            onChange={(e) => setFolderParentId(e.target.value || null)}
          >
            <option value="">根目录</option>
            {library.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover" onClick={() => setFolderOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
              onClick={() => void createFolder()}
            >
              确定
            </button>
          </div>
        </Modal>
      )}

      {renameOpen && (
        <Modal onClose={() => setRenameOpen(null)} title={renameOpen.kind === "folder" ? "重命名文件夹" : "重命名作品"}>
          <input
            className="mb-4 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/50"
            value={renameOpen.name}
            onChange={(e) => setRenameOpen({ ...renameOpen, name: e.target.value })}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename();
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover" onClick={() => setRenameOpen(null)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
              onClick={() => void submitRename()}
            >
              保存
            </button>
          </div>
        </Modal>
      )}

      {moveOpen && (
        <Modal onClose={() => setMoveOpen(null)} title="移动作品">
          <label className="mb-1 block text-[12px] text-ink-faint">目标文件夹</label>
          <select
            className="mb-4 w-full rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px]"
            value={moveOpen.folderId ?? ""}
            onChange={(e) => setMoveOpen({ ...moveOpen, folderId: e.target.value || null })}
          >
            <option value="">未分类（根）</option>
            {library.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover" onClick={() => setMoveOpen(null)}>
              取消
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
              onClick={() => void submitMove()}
            >
              移动
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[12px] border border-line bg-surface p-4 shadow-[0_12px_40px_rgba(28,31,36,0.15)]">
        <div className="mb-3 text-[15px] font-semibold">{title}</div>
        {children}
      </div>
    </div>
  );
}

function WorkToolStrip({ m }: { m: CollabMsg }) {
  const tools = m.tools ?? [];
  if (!tools.length && !m.streaming) return null;
  const last = tools[tools.length - 1];
  const unique = [...new Set(tools.map((t) => t.tool))].join("、") || "任务";
  const label = m.queued
    ? "等待前序任务…"
    : m.streaming
      ? last
        ? `${last.tool}${last.state ? ` · ${last.state}` : ""}`
        : m.thinking
          ? "思考中…"
          : "任务运行中…"
      : unique;
  return (
    <div className="mb-1.5 flex min-h-[22px] w-full items-center gap-2 overflow-hidden rounded-md bg-black/[0.03] px-2.5 py-1 text-[11.5px] text-ink-muted">
      <span
        className={`shrink-0 rounded px-1.5 py-px font-medium ${
          m.queued || m.streaming ? "bg-accent-soft text-accent-deep" : "bg-black/[0.04] text-ink-muted"
        }`}
      >
        {m.queued ? "排队中" : m.streaming ? "正在执行" : "已处理"}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tools.length > 0 && <span className="shrink-0 tabular-nums">{tools.length} 步</span>}
    </div>
  );
}

function AgentPane(props: {
  title: string;
  msgs: CollabMsg[];
  input: string;
  setInput: (v: string) => void;
  running: boolean;
  agentPhase: AgentPhase;
  agentError: string;
  agentBusy: boolean;
  onConnect: () => void;
  onSend: () => void;
  toolbar?: ReactNode;
  fill?: boolean;
}) {
  const pm = PHASE_META[props.agentPhase];
  const connected = props.agentPhase === "connected";
  const canSend = connected && !props.running && !!props.input.trim();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.msgs, props.running]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${props.fill ? "min-h-0 flex-1 bg-white" : "bg-surface"}`}
    >
      <div
        className={`flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 ${props.fill ? "bg-white" : "bg-surface"}`}
      >
        <span className="text-[12.5px] font-medium text-ink-muted">{props.title}</span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${pm.color}`}
          title={props.agentError || pm.label}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pm.dot}`} />
          {pm.label}
        </span>
        {props.running && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-deep">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            运行中
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 ${
          props.running ? "bg-accent-soft/25" : props.fill ? "bg-white" : "bg-surface"
        }`}
      >
        {!props.msgs.length && (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <p className="text-[13px] font-medium text-ink">作品 Agent 协作</p>
            <p className="mt-1.5 max-w-[280px] text-[12px] leading-relaxed text-ink-faint">
              {connected
                ? "发送指令开始协作。Enter 发送，Shift+Enter 换行。"
                : "请先连接 WorkBuddy 网关（与本地 Agent 共用同一连接）。"}
            </p>
            {!connected && (
              <button
                type="button"
                className="mt-3 rounded-[6px] bg-accent px-3 py-1.5 text-[12.5px] text-white hover:bg-accent-deep disabled:opacity-50"
                disabled={props.agentBusy}
                onClick={props.onConnect}
              >
                {props.agentBusy ? "连接中…" : "连接 ACP"}
              </button>
            )}
          </div>
        )}
        {props.msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={`${m.ts}-${i}`} className="flex justify-end gap-2.5">
              <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
                <span className="px-0.5 text-[10px] tabular-nums text-ink-faint">{fmtClock(m.ts)}</span>
                <div className="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink whitespace-pre-wrap break-words">
                  {m.text}
                </div>
              </div>
              <Avatar who="user" />
            </div>
          ) : (
            <div key={`${m.ts}-${i}`} className="flex justify-start gap-2.5">
              <Avatar who="agent" />
              <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
                <div className="flex items-center gap-1.5 px-0.5">
                  <span className="text-[11px] font-medium text-ink-muted">作品 Agent</span>
                  <span className="text-[10px] tabular-nums text-ink-faint">{fmtClock(m.ts)}</span>
                  {m.streaming && (
                    <span className="text-[11px] text-accent">
                      {m.queued ? "排队中…" : m.thinking ? "思考中…" : "正在生成…"}
                    </span>
                  )}
                </div>
                <WorkToolStrip m={m} />
                <div
                  className={`inline-block max-w-full rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[0_1px_2px_rgba(28,31,36,0.04)] whitespace-pre-wrap break-words ${
                    m.error ? "border border-up/40 bg-up-soft text-up" : "bg-page text-ink"
                  }`}
                >
                  {m.text ? (
                    <>
                      {m.text}
                      {m.streaming && !m.queued ? <span className="animate-pulse">▍</span> : null}
                    </>
                  ) : m.streaming ? (
                    <span className="text-ink-faint">
                      {m.queued ? "排队等待中…" : m.tools?.length ? "工具执行中…" : "▍"}
                      {!m.queued ? <span className="animate-pulse">▍</span> : null}
                    </span>
                  ) : (
                    "…"
                  )}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
      <div className={`border-t border-line px-3 py-3 ${props.fill ? "bg-white" : "bg-surface"}`}>
        {!connected ? (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line bg-white px-3 py-3">
            <span className="min-w-0 flex-1 text-[12.5px] text-ink-muted">
              {props.agentError || "未连接网关，无法发送"}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-[6px] bg-accent px-3 py-1.5 text-[12.5px] text-white hover:bg-accent-deep disabled:opacity-50"
              disabled={props.agentBusy}
              onClick={props.onConnect}
            >
              {props.agentBusy ? "连接中…" : "连接 ACP"}
            </button>
          </div>
        ) : (
          <div
            className={`rounded-2xl border bg-page shadow-[0_1px_2px_rgba(28,31,36,0.04)] focus-within:border-accent/50 ${
              props.running ? "border-accent/40 bg-accent-soft/20" : "border-line"
            }`}
          >
            <textarea
              className="max-h-36 min-h-[72px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed outline-none disabled:opacity-60"
              value={props.input}
              onChange={(e) => props.setInput(e.target.value)}
              placeholder={
                props.running
                  ? "任务运行中…"
                  : "给作品 Agent 派个任务… (Enter 发送, Shift+Enter 换行)"
              }
              disabled={props.running}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) props.onSend();
                }
              }}
            />
            <div className="flex items-center gap-2 border-t border-line/70 px-2.5 py-1.5">
              {props.toolbar}
              {props.running && (
                <span className="text-[11.5px] text-accent-deep">运行中</span>
              )}
              <button
                type="button"
                className="ml-auto rounded-[6px] bg-accent px-3 py-1 text-[12.5px] text-white hover:bg-accent-deep disabled:opacity-40"
                disabled={!canSend}
                onClick={props.onSend}
              >
                {props.running ? "运行中…" : "发送"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
