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
import WorkMarkdownEditor from "@/components/create/work-markdown-editor";

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

function shortTitleFrom(text: string, fallback = "未命名") {
  const line = text
    .split("\n")
    .map((s) => s.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  const t = (line || fallback).slice(0, 24);
  return t.length < (line || fallback).length ? `${t}…` : t;
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

function BranchTreeView(props: {
  nodes: BranchNode[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const byParent = useMemo(() => buildBranchTree(props.nodes), [props.nodes]);
  const roots = byParent.get(null) ?? [];

  const render = (n: BranchNode, depth: number): ReactNode => {
    const kids = byParent.get(n.id) ?? [];
    const active = n.id === props.currentId;
    return (
      <div key={n.id}>
        <button
          type="button"
          onClick={() => props.onSelect(n.id)}
          className={`flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-hover ${
            active ? "bg-accent-soft text-accent-deep" : "text-ink"
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className="shrink-0 text-ink-faint">{kids.length ? "▾" : "·"}</span>
          <span className="min-w-0 flex-1 truncate font-medium">
            {n.label || shortTitleFrom("", n.id.slice(0, 8))}
          </span>
          <span className="shrink-0 tabular-nums text-[11px] text-ink-faint">
            {fmtDateTime(n.createdAt)}
          </span>
          {active && <span className="shrink-0 text-[10px] text-accent-deep">当前</span>}
        </button>
        {kids.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  if (!props.nodes.length) {
    return <div className="px-2 py-3 text-[12px] text-ink-faint">暂无版本</div>;
  }
  return <div className="overflow-x-hidden py-1">{roots.map((r) => render(r, 0))}</div>;
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
  const [editorMode, setEditorMode] = useState<"preview" | "source">("preview");

  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [resRevision, setResRevision] = useState(0);
  const [selectedRes, setSelectedRes] = useState<string | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const draftMenuRef = useRef<HTMLDivElement>(null);
  const colDragRef = useRef<null | { which: "left" | "right"; startX: number; startW: number }>(null);

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
    if (!currentId) return;
    if (selectedRes) {
      setResNote(resources.find((r) => r.id === selectedRes)?.note || "");
      void loadScopeMessages("resource", { resourceId: selectedRes });
    } else {
      void loadScopeMessages("draft");
    }
  }, [selectedRes, currentId, loadScopeMessages, resources]);

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
      } else {
        setRightW(Math.min(COL_RIGHT_MAX, Math.max(COL_RIGHT_MIN, d.startW - delta)));
      }
    };
    const onUp = () => {
      colDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
    setSelectedRes(null);
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

  const submitUrl = async () => {
    if (!currentId || !urlValue.trim()) return;
    const res = await fetch(`/api/work/${currentId}/resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "url",
        url: urlValue.trim(),
        name: urlName.trim() || urlValue.trim(),
        baseRevision: resRevision,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setStatus(j.error || "添加失败");
      return;
    }
    setResources(j.file.items);
    setResRevision(j.file.revision);
    setUrlOpen(false);
    setUrlValue("");
    setUrlName("");
    setStatus("已添加链接");
  };

  const onDropFiles = async (files: FileList | null) => {
    if (!currentId || !files?.length) return;
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
      setResources(j.file.items);
      setResRevision(j.file.revision);
    }
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
    if (selectedRes === rid) setSelectedRes(null);
  };

  const sendAgent = async () => {
    if (!currentId || !input.trim() || running) return;
    const scope = selectedRes ? "resource" : "draft";
    const cap = selectedRes
      ? resources.find((r) => r.id === selectedRes)?.kind === "url"
        ? "analyze-url"
        : "resource-note"
      : capability;

    setRunning(true);
    setStatus("");
    const userText = input.trim();
    setInput("");
    setMsgs((prev) => [...prev, { role: "user", text: userText, ts: Date.now() }]);

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
          resourceId: selectedRes || undefined,
          draftDirty: dirty,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setStatus(j.error || `发送失败 ${res.status}`);
        setRunning(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
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
            };
            if (ev.type === "queued") setStatus(`排队中（前序：${ev.aheadTitle || "…"}）`);
            if (ev.type === "running") setStatus("运行中…");
            if (ev.type === "chunk" && ev.text) {
              assistant += ev.text;
              setMsgs((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant" && !last.error) {
                  copy[copy.length - 1] = { ...last, text: assistant, streaming: true };
                } else {
                  copy.push({
                    role: "assistant",
                    text: assistant,
                    ts: Date.now(),
                    streaming: true,
                  });
                }
                return copy;
              });
            }
            if (ev.type === "draft_checkpoint") {
              setStatus("AI 已写入正文并生成新版本");
            }
            if (ev.type === "error") setStatus(ev.error || "错误");
            if (ev.type === "done") setStatus("完成");
          } catch {
            /* skip */
          }
        }
      }
      setMsgs((prev) =>
        prev.map((m, i) => (i === prev.length - 1 && m.role === "assistant" ? { ...m, streaming: false } : m)),
      );
      await loadDraft(currentId);
      if (selectedRes) {
        const r = await fetch(`/api/work/${currentId}/resources`).then((x) => x.json());
        setResources(r.items ?? []);
        setResRevision(r.revision ?? 0);
        setResNote(r.items?.find((x: ResourceItem) => x.id === selectedRes)?.note || "");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus((e as Error).message);
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

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page text-ink">
      {/* 作品条 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            className="rounded-[6px] border border-line bg-page px-3 py-1.5 text-[13px] hover:bg-hover"
            onClick={() => setPickerOpen((v) => !v)}
          >
            {current ? current.title : "选择或新建作品"}
            <span className="ml-1 text-ink-faint">▾</span>
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-40 mt-1 flex max-h-[min(70vh,520px)] w-[min(720px,94vw)] overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_8px_30px_rgba(28,31,36,0.12)]">
              <div className="w-60 shrink-0 overflow-y-auto overflow-x-hidden border-r border-line p-2">
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
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 text-[12.5px] whitespace-pre-wrap break-words text-ink-muted">
                  {previewId ? previewContent || "（空稿）" : "点选左侧作品预览当前稿"}
                </div>
                <div className="flex justify-end border-t border-line p-2">
                  <button
                    type="button"
                    disabled={!previewId}
                    className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-40 hover:bg-accent-deep"
                    onClick={() => previewId && void switchWork(previewId)}
                  >
                    切换到此作品
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="rounded-[6px] border border-line px-3 py-1.5 text-[13px] hover:bg-hover"
          onClick={() => setNewOpen(true)}
        >
          新建作品
        </button>
        <div className="ml-auto truncate text-[12px] text-ink-faint">{status}</div>
      </div>

      {/* 工具区：视图 + 稿件（发布视图也保留） */}
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
                className={`px-3 py-1 text-[12.5px] ${view === k ? "bg-page font-medium text-ink" : "bg-surface-2/50 text-ink-muted"}`}
                onClick={() => {
                  setView(k);
                  if (k === "publish") setSelectedRes(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative min-w-0 max-w-[min(420px,46vw)]" ref={draftMenuRef}>
            <button
              type="button"
              className="max-w-full truncate rounded-[6px] border border-line bg-page px-2.5 py-1 text-left text-[12.5px] hover:bg-hover"
              title={draftLabel}
              onClick={() => setDraftMenuOpen((v) => !v)}
            >
              当前稿件 · {draftLabel}
              <span className="ml-1 text-ink-faint">▾</span>
            </button>
            {draftMenuOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-[min(440px,90vw)] overflow-y-auto overflow-x-hidden rounded-[12px] border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(28,31,36,0.1)]">
                <div className="px-2 py-1.5 text-[11px] font-medium text-ink-faint">版本树</div>
                <BranchTreeView
                  nodes={branches}
                  currentId={draftId}
                  onSelect={(id) => void checkout(id)}
                />
              </div>
            )}
          </div>

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
            className="rounded-[6px] bg-accent px-4 py-2 text-[13px] text-white hover:bg-accent-deep"
            onClick={() => setNewOpen(true)}
          >
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
            <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
              <span className="text-[12px] font-medium text-ink-muted">资源</span>
              <div className="ml-auto flex gap-0.5">
                <button
                  type="button"
                  className="rounded-[6px] px-1.5 py-0.5 text-[11.5px] text-accent-deep hover:bg-accent-soft"
                  onClick={() => {
                    setUrlValue("");
                    setUrlName("");
                    setUrlOpen(true);
                  }}
                >
                  + 链接
                </button>
                <button
                  type="button"
                  className="rounded-[6px] px-1.5 py-0.5 text-[11.5px] text-accent-deep hover:bg-accent-soft"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + 文件
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
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1">
              {resources.map((r) => (
                <div
                  key={r.id}
                  className={`group flex items-center gap-1 rounded-[6px] px-1.5 py-1.5 hover:bg-hover ${selectedRes === r.id ? "bg-accent-soft" : ""}`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[12.5px]"
                    onClick={() => setSelectedRes(r.id)}
                  >
                    <span className="mr-1 text-[10px] uppercase text-ink-faint">{r.kind}</span>
                    {r.name}
                  </button>
                  <button
                    type="button"
                    className="hidden text-[11px] text-up group-hover:inline"
                    onClick={() => void deleteRes(r.id)}
                  >
                    删
                  </button>
                </div>
              ))}
              {!resources.length && (
                <div className="p-2 text-[12px] leading-relaxed text-ink-faint">
                  点击「+ 链接 / + 文件」添加，或拖入图片、md、txt
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

          {/* 右：Agent（对齐本地 Agent） */}
          <div className="flex shrink-0 flex-col overflow-hidden" style={{ width: rightW }}>
            <AgentPane
              title={selectedRes ? "资源协作" : "稿件 Agent"}
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
                !selectedRes ? (
                  <select
                    className="rounded-[6px] border border-line bg-page px-1.5 py-0.5 text-[11.5px] text-ink-muted"
                    value={capability}
                    onChange={(e) => setCapability(e.target.value as "general" | "edit-draft")}
                    disabled={running || agentPhase !== "connected"}
                  >
                    <option value="general">general</option>
                    <option value="edit-draft">edit-draft</option>
                  </select>
                ) : (
                  <span className="text-[11px] text-ink-faint">优化 note / 分析链接</span>
                )
              }
            />
          </div>
          {/* 资源 Agent 协作预览浮层壳 */}
          {selectedResource && (
            <div
              className="absolute inset-0 z-20 flex bg-ink/20 backdrop-blur-[1px]"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setSelectedRes(null);
              }}
            >
              <div
                className="m-3 mr-[20px] flex min-h-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_12px_40px_rgba(28,31,36,0.18)]"
                style={{ marginLeft: leftW + 12 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex w-[42%] min-w-[280px] flex-col border-r border-line">
                  <div className="flex items-center border-b border-line px-3 py-2">
                    <span className="truncate text-[13px] font-medium">{selectedResource.name}</span>
                    <button
                      type="button"
                      className="ml-auto rounded-[6px] px-2 py-0.5 text-[12px] text-ink-muted hover:bg-hover"
                      onClick={() => setSelectedRes(null)}
                    >
                      关闭
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-4 text-[13px]">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">
                      {selectedResource.kind}
                    </div>
                    {selectedResource.url ? (
                      <a
                        className="break-all text-accent-deep underline"
                        href={selectedResource.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {selectedResource.url}
                      </a>
                    ) : (
                      <p className="font-mono text-[12px] text-ink-muted">
                        resources/{selectedResource.relativePath}
                      </p>
                    )}
                  </div>
                  <div className="border-t border-line p-3">
                    <div className="mb-1 text-[11px] font-medium text-ink-faint">note</div>
                    <textarea
                      className="h-28 w-full resize-none rounded-[8px] border border-line bg-page p-2.5 text-[12.5px] outline-none focus:border-accent/50"
                      value={resNote}
                      onChange={(e) => setResNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className="mt-2 rounded-[6px] bg-ink px-2.5 py-1 text-[12px] text-white"
                      onClick={() => void saveResNote()}
                    >
                      保存 note
                    </button>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <AgentPane
                    title="资源 Agent"
                    msgs={msgs}
                    input={input}
                    setInput={setInput}
                    running={running}
                    agentPhase={agentPhase}
                    agentError={agentError}
                    agentBusy={agentBusy}
                    onConnect={() => void connectAgent()}
                    onSend={() => void sendAgent()}
                    fill
                    toolbar={<span className="text-[11px] text-ink-faint">本资源历史轨道</span>}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
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

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-surface ${props.fill ? "min-h-0 flex-1" : ""}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <span className="text-[12.5px] font-medium text-ink-muted">{props.title}</span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${pm.color}`}
          title={props.agentError || pm.label}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pm.dot}`} />
          {pm.label}
        </span>
        {props.running && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
        )}
      </div>
      <div
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 ${
          props.running ? "bg-accent-soft/30" : "bg-surface"
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
                  {m.streaming && <span className="text-[11px] text-accent">正在生成…</span>}
                </div>
                <div
                  className={`inline-block max-w-full rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[0_1px_2px_rgba(28,31,36,0.04)] whitespace-pre-wrap break-words ${
                    m.error ? "border border-up/40 bg-up-soft text-up" : "bg-page text-ink"
                  }`}
                >
                  {m.text || (m.streaming ? "▍" : "…")}
                  {m.streaming ? <span className="animate-pulse">▍</span> : null}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
      <div className="border-t border-line bg-surface px-3 py-3">
        {!connected ? (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line bg-page px-3 py-3">
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
