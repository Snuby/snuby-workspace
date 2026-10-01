"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import PreviewModal, {
  PreviewIconBtn,
  PreviewWebview,
  type PreviewWebviewNav,
} from "@/components/ui/preview-modal";
import { openInSystemBrowser } from "@/lib/open-external";

/** 链接/文件预览: url → webview; 本地文件按扩展名分发 */
export type LinkView =
  | { kind: "url"; url: string; title: string }
  | { kind: "file"; path: string; title: string; text?: string; loading?: boolean; error?: string };

const IconCheck = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const PREVIEW_IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const PREVIEW_DOC_EXT = ["html", "htm", "pdf"];
const extOf = (p: string) => {
  const base = p.split("/").pop() ?? p;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
};
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

/** 本地图片预览: fetch→blob, 404 时列出同目录可用媒体 (Agent 常写错文件名) */
function LocalImagePreview({
  path,
  title,
  onOpenFile,
}: {
  path: string;
  title: string;
  onOpenFile: (path: string, title: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<{ name: string; path: string; mime: string }[]>([]);

  useEffect(() => {
    let dead = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setErr(null);
    setSiblings([]);
    void (async () => {
      try {
        const r = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!r.ok) {
          const dir = path.replace(/\/[^/]+$/, "") || "/";
          let hint = r.status === 404 ? "文件不存在" : `加载失败 (HTTP ${r.status})`;
          try {
            const j = (await r.json()) as { error?: string };
            if (j?.error === "not found") hint = "文件不存在";
          } catch {
            /* ignore */
          }
          if (!dead) setErr(`${hint}: ${path}`);
          try {
            const lr = await fetch(`/api/local-file?path=${encodeURIComponent(dir)}&list=1`, { cache: "no-store" });
            if (lr.ok) {
              const j = (await lr.json()) as { entries?: { name: string; path: string; mime: string }[] };
              const imgs = (j.entries ?? []).filter((e) => e.mime.startsWith("image/") && e.path !== path);
              if (!dead) setSiblings(imgs);
            }
          } catch {
            /* ignore */
          }
          return;
        }
        const blob = await r.blob();
        objectUrl = URL.createObjectURL(blob);
        if (dead) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setSrc(objectUrl);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="max-w-[520px] rounded-lg bg-up-soft px-3 py-2.5 text-center text-[12.5px] leading-snug text-up">
          {err}
        </div>
        {siblings.length > 0 && (
          <div className="w-full max-w-[520px]">
            <div className="mb-1.5 text-center text-[11.5px] text-ink-faint">同目录可用图片 — 点击打开</div>
            <ul className="max-h-[240px] space-y-1 overflow-y-auto rounded-lg border border-line bg-page p-2">
              {siblings.map((s) => (
                <li key={s.path}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(s.path, s.name)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-accent-deep transition-colors hover:bg-accent-soft"
                    title={s.path}
                  >
                    <span className="shrink-0 text-ink-faint">图</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
        <span className="animate-pulse">加载图片…</span>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={title}
        data-local-path={path}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

/** 前进/后退悬停: 展示可跳转的历史堆栈 */
function NavHistoryHover({
  label,
  disabled,
  items,
  onStep,
  onJump,
  icon,
}: {
  label: string;
  disabled?: boolean;
  items: { index: number; title: string; location: string }[];
  onStep?: () => void;
  onJump: (index: number) => void;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    clear();
    if (!disabled && items.length) setOpen(true);
  };
  const hide = () => {
    clear();
    timer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clear(), []);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <PreviewIconBtn title={label} disabled={disabled} onClick={onStep}>
        {icon}
      </PreviewIconBtn>
      {open && items.length > 0 ? (
        <div
          className="absolute left-0 top-full z-[70] mt-1 w-[280px] overflow-hidden rounded-lg border border-line bg-white py-1 shadow-xl"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            {label} · {items.length}
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {items.map((it) => (
              <button
                key={`${it.index}-${it.location}`}
                type="button"
                onClick={() => {
                  onJump(it.index);
                  setOpen(false);
                }}
                className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-black/[0.04]"
              >
                <span className="truncate text-[12.5px] font-medium text-ink">{it.title}</span>
                <span className="truncate font-mono text-[10px] text-ink-faint">{it.location}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type PreviewFontSize = "sm" | "md" | "lg";
const PREVIEW_FONT_KEY = "snuby:preview-font-size";
/** 基准字号; Markdown 标题/代码等用 em 相对缩放, 一并跟随 */
const PREVIEW_FONT_PX: Record<PreviewFontSize, number> = { sm: 13, md: 15, lg: 17 };

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function LinkPreviewModal({
  view,
  stack,
  stackIndex,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onJump,
  onClose,
  onOpenDoc,
  docHints,
  onOpenLink,
  onCtxMenu,
  onToast,
  renderMarkdown,
  webviewPartition = "default",
  embedded = false,
}: {
  view: LinkView;
  stack: LinkView[];
  stackIndex: number;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onJump: (index: number) => void;
  onClose: () => void;
  onOpenDoc: (path: string, title: string) => void;
  docHints: string[];
  onOpenLink: (raw: string) => void;
  onCtxMenu?: (e: MouseEvent) => void;
  onToast?: (msg: string) => void;
  /** Agent 注入 markdown 渲染; 纯 URL 预览可不传 */
  renderMarkdown?: (
    text: string,
    ctx: {
      path?: string;
      onOpenDoc: (path: string, title: string) => void;
      docHints: string[];
      onOpenLink: (raw: string) => void;
    },
  ) => ReactNode;
  /** Electron webview partition */
  webviewPartition?: string;
  /** 嵌入侧栏等容器：铺满父级，不盖全屏遮罩 */
  embedded?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [copiedKind, setCopiedKind] = useState<"content" | "path" | null>(null);
  const [webNav, setWebNav] = useState({ canGoBack: false, canGoForward: false });
  const webNavRef = useRef<PreviewWebviewNav | null>(null);
  const [fontSize, setFontSize] = useState<PreviewFontSize>(() => {
    try {
      const v = localStorage.getItem(PREVIEW_FONT_KEY);
      if (v === "sm" || v === "md" || v === "lg") return v;
    } catch {
      /* ignore */
    }
    return "sm";
  });
  const ext = view.kind === "file" ? extOf(view.path) : "";
  const isImg = PREVIEW_IMG_EXT.includes(ext);
  const isDoc = PREVIEW_DOC_EXT.includes(ext);
  const localFileUrl = (p: string) => `/api/local-file?path=${encodeURIComponent(p)}`;
  const location = view.kind === "url" ? view.url : view.path;
  const viewKey = view.kind === "url" ? `url:${view.url}` : `file:${view.path}`;
  const canCopyContent = view.kind === "file" && !isImg && !isDoc && !!text;
  const basePx = PREVIEW_FONT_PX[fontSize];
  const sizeLabel = fileSize != null ? fmtBytes(fileSize) : "";

  // URL 页内历史优先；否则走预览栈（Agent 多页）
  const showWeb = view.kind === "url" || (view.kind === "file" && isDoc);
  const effectiveCanBack = Boolean(canGoBack) || (showWeb && webNav.canGoBack);
  const effectiveCanForward = Boolean(canGoForward) || (showWeb && webNav.canGoForward);

  const handleBack = () => {
    if (showWeb && webNav.canGoBack) {
      webNavRef.current?.goBack();
      return;
    }
    onBack?.();
  };
  const handleForward = () => {
    if (showWeb && webNav.canGoForward) {
      webNavRef.current?.goForward();
      return;
    }
    onForward?.();
  };

  const stackLoc = (v: LinkView) => (v.kind === "url" ? v.url : v.path);
  // 后退列表: 当前之前的条目, 最近的在上
  const backItems = stack
    .slice(0, stackIndex)
    .map((v, i) => ({ index: i, title: v.title, location: stackLoc(v) }))
    .reverse();
  // 前进列表: 当前之后, 最近的在上
  const forwardItems = stack
    .slice(stackIndex + 1)
    .map((v, i) => ({ index: stackIndex + 1 + i, title: v.title, location: stackLoc(v) }));

  useEffect(() => {
    // 切换预览条目时重置 webview 导航态
    setWebNav({ canGoBack: false, canGoForward: false });
  }, [viewKey]);

  useEffect(() => {
    if (view.kind !== "file") {
      setFileSize(null);
      return;
    }
    let dead = false;
    setFileSize(null);
    void (async () => {
      try {
        const r = await fetch(`/api/local-file?path=${encodeURIComponent(view.path)}&stat=1`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { size?: number };
        if (!dead && typeof j.size === "number") setFileSize(j.size);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      dead = true;
    };
  }, [view]);

  useEffect(() => {
    if (view.kind !== "file") return;
    if (isImg || isDoc) return;
    let dead = false;
    setText(null);
    setErr(null);
    void (async () => {
      try {
        const r = await fetch(`/api/local-file?path=${encodeURIComponent(view.path)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "文件不存在" : `HTTP ${r.status}`);
        const t = await r.text();
        if (!dead) setText(t);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [view, isImg, isDoc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        e.preventDefault();
        if (effectiveCanBack) handleBack();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        e.preventDefault();
        if (effectiveCanForward) handleForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effectiveCanBack, effectiveCanForward, showWeb, webNav.canGoBack, webNav.canGoForward, canGoBack, canGoForward, onBack, onForward]);

  const setFont = (s: PreviewFontSize) => {
    setFontSize(s);
    try {
      localStorage.setItem(PREVIEW_FONT_KEY, s);
    } catch {
      /* ignore */
    }
  };

  const flashCopied = (kind: "content" | "path") => {
    setCopiedKind(kind);
    window.setTimeout(() => setCopiedKind(null), 1500);
  };

  const copyText = async (value: string, kind: "content" | "path") => {
    try {
      await navigator.clipboard.writeText(value);
      flashCopied(kind);
      onToast?.(kind === "content" ? "已复制内容" : "已复制路径");
    } catch {
      onToast?.("复制失败");
    }
  };

  const revealInFinder = async () => {
    if (view.kind !== "file") return;
    try {
      const r = await fetch("/api/agent/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: view.path }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      onToast?.("已在 Finder 中显示");
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "打开失败");
    }
  };

  const openExternal = () => {
    if (view.kind === "url") {
      void openInSystemBrowser(view.url).catch((e) => {
        onToast?.(e instanceof Error ? e.message : "打开失败");
      });
      return;
    }
    // 本地 html/htm: 用系统默认浏览器打开
    if (view.kind === "file" && (ext === "html" || ext === "htm")) {
      void openInSystemBrowser(view.path).catch((e) => {
        onToast?.(e instanceof Error ? e.message : "打开失败");
      });
    }
  };

  return (
    <PreviewModal
      title={
        <>
          <span title={location}>{view.title}</span>
          {view.kind === "file" && sizeLabel ? (
            <span className="ml-2 font-normal tabular-nums text-ink-faint" style={{ fontSize: "11px" }}>
              {sizeLabel}
            </span>
          ) : null}
        </>
      }
      onClose={onClose}
      onEscape={() => {
        if (effectiveCanBack) handleBack();
        else onClose();
      }}
      onContextMenu={onCtxMenu}
      size="lg"
      showClose={!embedded}
      overlayClassName={
        embedded
          ? // 必须参与文档流：absolute 会让侧栏 flex 子项高度塌缩，webview guest 视口算崩
            "flex h-full min-h-0 w-full flex-col bg-transparent p-0"
          : undefined
      }
      panelClassName={
        embedded
          ? "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-white shadow-none"
          : undefined
      }
      leading={
        <div className="flex items-center gap-0.5">
          <NavHistoryHover
            label="后退"
            disabled={!effectiveCanBack}
            items={backItems}
            onStep={handleBack}
            onJump={onJump}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            }
          />
          <NavHistoryHover
            label="前进"
            disabled={!effectiveCanForward}
            items={forwardItems}
            onStep={handleForward}
            onJump={onJump}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M9 18l6-6-6-6" />
              </svg>
            }
          />
        </div>
      }
      trailing={
        <>
          <div className="mr-0.5 flex items-center rounded-md border border-line bg-white p-0.5">
            {([
              ["sm", "小"],
              ["md", "中"],
              ["lg", "大"],
            ] as const).map(([k, lab]) => (
              <button
                key={k}
                type="button"
                title={`字号：${lab}`}
                aria-label={`字号${lab}`}
                aria-pressed={fontSize === k}
                onClick={() => setFont(k)}
                className={`h-6 min-w-[22px] rounded px-1 text-[11px] font-medium transition-colors ${
                  fontSize === k ? "bg-accent-soft text-accent-deep" : "text-ink-faint hover:text-ink"
                }`}
              >
                {lab}
              </button>
            ))}
          </div>

          <div className="mx-0.5 h-4 w-px shrink-0 bg-line" />

          <PreviewIconBtn
            title={copiedKind === "content" ? "已复制" : "复制内容"}
            disabled={!canCopyContent}
            onClick={() => text && void copyText(text, "content")}
          >
            {copiedKind === "content" ? (
              <IconCheck className="h-3.5 w-3.5 text-down" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="14" y2="17" />
              </svg>
            )}
          </PreviewIconBtn>
          <PreviewIconBtn
            title={copiedKind === "path" ? "已复制" : view.kind === "url" ? "复制链接" : "复制路径"}
            onClick={() => void copyText(location, "path")}
          >
            {copiedKind === "path" ? (
              <IconCheck className="h-3.5 w-3.5 text-down" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
          </PreviewIconBtn>
          {view.kind === "file" ? (
            <>
              <PreviewIconBtn title="在 Finder 中显示" onClick={() => void revealInFinder()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </PreviewIconBtn>
              {ext === "html" || ext === "htm" ? (
                <PreviewIconBtn title="在浏览器中打开" onClick={openExternal}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </PreviewIconBtn>
              ) : null}
            </>
          ) : (
            <PreviewIconBtn title="在浏览器中打开" onClick={openExternal}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </PreviewIconBtn>
          )}
        </>
      }
    >
      {view.kind === "url" ? (
        <PreviewWebview
          src={view.url}
          partition={webviewPartition}
          navRef={webNavRef}
          onNavState={(s) =>
            setWebNav((prev) =>
              prev.canGoBack === s.canGoBack && prev.canGoForward === s.canGoForward ? prev : s,
            )
          }
        />
      ) : isImg ? (
        <LocalImagePreview path={view.path} title={view.title} onOpenFile={onOpenDoc} />
      ) : isDoc ? (
        <PreviewWebview
          src={localFileUrl(view.path)}
          partition={webviewPartition}
          navRef={webNavRef}
          onNavState={(s) =>
            setWebNav((prev) =>
              prev.canGoBack === s.canGoBack && prev.canGoForward === s.canGoForward ? prev : s,
            )
          }
        />
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
          <pre
            className="whitespace-pre-wrap break-all font-mono leading-relaxed text-ink"
            style={{ fontSize: `${basePx * 0.92}px` }}
          >
            {prettyJsonl(text)}
          </pre>
        </div>
      ) : (
        <div className="h-full overflow-y-auto px-4 py-3 leading-relaxed text-ink" style={{ fontSize: `${basePx}px` }}>
          {renderMarkdown
            ? renderMarkdown(text, {
                path: view.kind === "file" ? view.path : undefined,
                onOpenDoc,
                docHints,
                onOpenLink,
              })
            : text}
        </div>
      )}
    </PreviewModal>
  );
}

/**
 * 仅打开 URL 的预览（天气预报等）。
 * 工具栏与本地 Agent 链接预览完全同一套 LinkPreviewModal。
 */
export function UrlLinkPreview({
  url,
  title,
  onClose,
  webviewPartition,
  onToast,
  embedded = false,
}: {
  url: string;
  title: string;
  onClose: () => void;
  webviewPartition?: string;
  onToast?: (msg: string) => void;
  embedded?: boolean;
}) {
  const [nav, setNav] = useState<{ stack: LinkView[]; index: number }>(() => ({
    stack: [{ kind: "url", url, title }],
    index: 0,
  }));

  useEffect(() => {
    setNav({ stack: [{ kind: "url", url, title }], index: 0 });
  }, [url, title]);

  const view = nav.stack[nav.index] ?? { kind: "url" as const, url, title };
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.stack.length - 1;

  return (
    <LinkPreviewModal
      view={view}
      stack={nav.stack}
      stackIndex={nav.index}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={() => setNav((p) => ({ ...p, index: Math.max(0, p.index - 1) }))}
      onForward={() =>
        setNav((p) => ({ ...p, index: Math.min(p.stack.length - 1, p.index + 1) }))
      }
      onJump={(i) =>
        setNav((p) => ({
          ...p,
          index: Math.max(0, Math.min(i, p.stack.length - 1)),
        }))
      }
      onClose={onClose}
      onOpenDoc={() => {}}
      docHints={[]}
      onOpenLink={(raw) => {
        const href = raw.trim();
        if (!/^https?:\/\//i.test(href)) return;
        const next: LinkView = { kind: "url", url: href, title: href };
        setNav((prev) => {
          const stack = [...prev.stack.slice(0, prev.index + 1), next];
          return { stack, index: stack.length - 1 };
        });
      }}
      webviewPartition={webviewPartition}
      onToast={onToast}
      embedded={embedded}
    />
  );
}

/**
 * 本地文件预览（与 Agent LinkPreviewModal 同一套分流）。
 * embedded 时铺满父容器，供作品资源侧栏使用。
 */
export function FileLinkPreview({
  path,
  title,
  onClose,
  webviewPartition,
  onToast,
  embedded = false,
  renderMarkdown,
}: {
  path: string;
  title: string;
  onClose: () => void;
  webviewPartition?: string;
  onToast?: (msg: string) => void;
  embedded?: boolean;
  renderMarkdown?: LinkPreviewModalProps["renderMarkdown"];
}) {
  const [nav, setNav] = useState<{ stack: LinkView[]; index: number }>(() => ({
    stack: [{ kind: "file", path, title }],
    index: 0,
  }));

  useEffect(() => {
    setNav({ stack: [{ kind: "file", path, title }], index: 0 });
  }, [path, title]);

  const view = nav.stack[nav.index] ?? { kind: "file" as const, path, title };
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.stack.length - 1;

  return (
    <LinkPreviewModal
      view={view}
      stack={nav.stack}
      stackIndex={nav.index}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={() => setNav((p) => ({ ...p, index: Math.max(0, p.index - 1) }))}
      onForward={() =>
        setNav((p) => ({ ...p, index: Math.min(p.stack.length - 1, p.index + 1) }))
      }
      onJump={(i) =>
        setNav((p) => ({
          ...p,
          index: Math.max(0, Math.min(i, p.stack.length - 1)),
        }))
      }
      onClose={onClose}
      onOpenDoc={(p, t) => {
        const next: LinkView = { kind: "file", path: p, title: t };
        setNav((prev) => {
          const stack = [...prev.stack.slice(0, prev.index + 1), next];
          return { stack, index: stack.length - 1 };
        });
      }}
      docHints={[]}
      onOpenLink={(raw) => {
        const href = raw.trim();
        if (!/^https?:\/\//i.test(href)) return;
        const next: LinkView = { kind: "url", url: href, title: href };
        setNav((prev) => {
          const stack = [...prev.stack.slice(0, prev.index + 1), next];
          return { stack, index: stack.length - 1 };
        });
      }}
      webviewPartition={webviewPartition}
      onToast={onToast}
      embedded={embedded}
      renderMarkdown={renderMarkdown}
    />
  );
}

type LinkPreviewModalProps = Parameters<typeof LinkPreviewModal>[0];
