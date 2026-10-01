"use client";

// 资源侧栏预览：URL/文档对齐「主题 SiteWebview」挂载方式（非 SizedWebview / 非整窗 Modal）

import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import WorkMdPreview from "@/components/create/work-md-preview";
import { PreviewIconBtn, type PreviewWebviewNav } from "@/components/ui/preview-modal";
import { openInSystemBrowser } from "@/lib/open-external";

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const DOC_EXT = new Set(["html", "htm", "pdf"]);

function extOf(p: string) {
  const base = p.split("/").pop() ?? p;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

type WvEl = HTMLElement & {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
  getURL?: () => string;
  loadURL?: (url: string) => void;
  getWebContentsId?: () => number;
};

/**
 * 对齐 site-browser SiteWebview：
 * - React 创建 webview（src 仅挂载时取一次）
 * - style width/height 100%，不用 display:flex
 * - 外层 relative flex-1 + absolute inset-0，吃掉侧栏 flex 高度
 */
function TopicStyleWebview({
  src,
  partition,
  navRef,
  onNavState,
  onLocation,
}: {
  src: string;
  partition: string;
  navRef: { current: PreviewWebviewNav | null };
  onNavState: (s: { canGoBack: boolean; canGoForward: boolean }) => void;
  onLocation: (url: string) => void;
}) {
  const [initialSrc] = useState(src);
  const wvRef = useRef<WvEl | null>(null);
  const onNavStateRef = useRef(onNavState);
  const onLocationRef = useRef(onLocation);
  const navRefBox = useRef(navRef);
  onNavStateRef.current = onNavState;
  onLocationRef.current = onLocation;
  navRefBox.current = navRef;

  const setEl = useCallback((el: HTMLElement | null) => {
    wvRef.current = el as WvEl | null;
  }, []);

  useLayoutEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    let alive = true;

    const sync = () => {
      if (!alive) return;
      let canGoBack = false;
      let canGoForward = false;
      try {
        canGoBack = typeof wv.canGoBack === "function" ? Boolean(wv.canGoBack()) : false;
        canGoForward =
          typeof wv.canGoForward === "function" ? Boolean(wv.canGoForward()) : false;
      } catch {
        canGoBack = false;
        canGoForward = false;
      }
      onNavStateRef.current({ canGoBack, canGoForward });
      navRefBox.current.current = {
        goBack: () => {
          try {
            if (typeof wv.goBack === "function" && wv.canGoBack?.()) wv.goBack();
          } catch {
            /* guest gone */
          }
        },
        goForward: () => {
          try {
            if (typeof wv.goForward === "function" && wv.canGoForward?.()) wv.goForward();
          } catch {
            /* guest gone */
          }
        },
      };
      try {
        const u = typeof wv.getURL === "function" ? wv.getURL() : "";
        if (u) onLocationRef.current(u);
      } catch {
        /* guest gone */
      }
    };

    const onPopup = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string; guestId?: number }>).detail;
      if (!alive || !detail?.url || typeof detail.guestId !== "number") return;
      let id: number | null = null;
      try {
        id = typeof wv.getWebContentsId === "function" ? wv.getWebContentsId() : null;
      } catch {
        return;
      }
      if (id !== detail.guestId) return;
      try {
        if (typeof wv.loadURL === "function") wv.loadURL(detail.url);
        else wv.setAttribute("src", detail.url);
      } catch {
        /* guest gone */
      }
    };

    wv.addEventListener("did-navigate", sync);
    wv.addEventListener("did-navigate-in-page", sync);
    wv.addEventListener("did-finish-load", sync);
    wv.addEventListener("dom-ready", sync);
    window.addEventListener("snuby-webview-popup", onPopup);

    return () => {
      alive = false;
      window.removeEventListener("snuby-webview-popup", onPopup);
      wv.removeEventListener("did-navigate", sync);
      wv.removeEventListener("did-navigate-in-page", sync);
      wv.removeEventListener("did-finish-load", sync);
      wv.removeEventListener("dom-ready", sync);
      navRefBox.current.current = null;
      onNavStateRef.current({ canGoBack: false, canGoForward: false });
    };
  }, [initialSrc]);

  return createElement("div", { className: "h-full w-full" }, [
    createElement("webview", {
      key: initialSrc,
      ref: setEl,
      src: initialSrc,
      partition,
      allowpopups: "true",
      className: "h-full w-full border-0",
      style: { width: "100%", height: "100%" },
    }),
  ]);
}

/**
 * 主题 / 通用预览的共同前提：webview 挂上时，父盒子已经有稳定像素尺寸。
 * 资源侧栏是 flex 算出来的，和 webview 同一帧挂载时 guest 会按未完成的视口排版（InfoQ 会叠成一团），且不会再重排。
 * 所以先等容器量到宽高，再挂与主题相同的 webview。
 */
function ReadyWebview(props: {
  src: string;
  partition: string;
  navRef: { current: PreviewWebviewNav | null };
  onNavState: (s: { canGoBack: boolean; canGoForward: boolean }) => void;
  onLocation: (url: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const check = () => {
      if (el.clientWidth >= 240 && el.clientHeight >= 240) setReady(true);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative min-h-0 w-full flex-1 overflow-hidden bg-white">
      {ready ? (
        <div className="absolute inset-0 h-full w-full">
          <TopicStyleWebview {...props} />
        </div>
      ) : null}
    </div>
  );
}

export function PreviewToolbar({
  location,
  canBack,
  canForward,
  onBack,
  onForward,
  onOpenExternal,
  trailing,
}: {
  location: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onOpenExternal?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-line bg-page px-2 py-1">
      <PreviewIconBtn title="后退" disabled={!canBack} onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </PreviewIconBtn>
      <PreviewIconBtn title="前进" disabled={!canForward} onClick={onForward}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </PreviewIconBtn>
      <div className="mx-1 h-4 w-px shrink-0 bg-line" />
      <div className="min-w-0 flex-1 truncate px-1 font-mono text-[11px] text-ink-faint" title={location}>
        {location}
      </div>
      <PreviewIconBtn
        title="复制链接/路径"
        onClick={() => void navigator.clipboard.writeText(location).catch(() => {})}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </PreviewIconBtn>
      {onOpenExternal ? (
        <PreviewIconBtn title="在浏览器中打开" onClick={onOpenExternal}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </PreviewIconBtn>
      ) : null}
      {trailing}
    </div>
  );
}

export default function WorkResourcePreview({
  kind,
  name,
  url,
  absolutePath,
  chrome = "toolbar",
  onNavState,
  onLocation,
  navApiRef,
}: {
  kind: string;
  name: string;
  url?: string | null;
  absolutePath?: string | null;
  onClose?: () => void;
  /** toolbar=自带顶栏；none=由外层侧栏工具栏接管 */
  chrome?: "toolbar" | "none";
  onNavState?: (s: { canGoBack: boolean; canGoForward: boolean }) => void;
  onLocation?: (url: string) => void;
  navApiRef?: { current: PreviewWebviewNav | null };
}) {
  const path = absolutePath || "";
  const ext = path ? extOf(path) : "";
  const isImg = kind === "media" || IMG_EXT.has(ext);
  const isDoc = DOC_EXT.has(ext);

  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [webNav, setWebNav] = useState({ canGoBack: false, canGoForward: false });
  const [location, setLocation] = useState(url || path || name);
  const webNavRef = useRef<PreviewWebviewNav | null>(null);

  const showWeb = Boolean(url) || (Boolean(path) && isDoc);
  const webSrc = url
    ? url
    : path && isDoc
      ? `/api/local-file?path=${encodeURIComponent(path)}`
      : "";

  useEffect(() => {
    setWebNav({ canGoBack: false, canGoForward: false });
    const loc = url || path || name;
    setLocation(loc);
    onLocation?.(loc);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when resource identity changes
  }, [webSrc, url, path, name]);

  useEffect(() => {
    if (!navApiRef) return;
    navApiRef.current = {
      goBack: () => webNavRef.current?.goBack(),
      goForward: () => webNavRef.current?.goForward(),
    };
    return () => {
      navApiRef.current = null;
    };
  }, [navApiRef]);

  useEffect(() => {
    setText(null);
    setErr(null);
    setImgSrc(null);
    if (url || !path || isDoc) return;
    let dead = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        if (isImg) {
          const r = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`, {
            cache: "no-store",
          });
          if (!r.ok) throw new Error(r.status === 404 ? "文件不存在" : `HTTP ${r.status}`);
          const blob = await r.blob();
          objectUrl = URL.createObjectURL(blob);
          if (dead) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          setImgSrc(objectUrl);
          return;
        }
        const r = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(r.status === 404 ? "文件不存在" : `HTTP ${r.status}`);
        const t = await r.text();
        if (!dead) setText(t);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, path, isImg, isDoc]);

  if (showWeb && webSrc) {
    const pushNav = (s: { canGoBack: boolean; canGoForward: boolean }) => {
      setWebNav((prev) =>
        prev.canGoBack === s.canGoBack && prev.canGoForward === s.canGoForward ? prev : s,
      );
      onNavState?.(s);
    };
    const pushLoc = (u: string) => {
      setLocation(u);
      onLocation?.(u);
    };
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
        {chrome === "toolbar" ? (
          <PreviewToolbar
            location={location}
            canBack={webNav.canGoBack}
            canForward={webNav.canGoForward}
            onBack={() => webNavRef.current?.goBack()}
            onForward={() => webNavRef.current?.goForward()}
            onOpenExternal={
              url || ext === "html" || ext === "htm"
                ? () => void openInSystemBrowser(url || path)
                : undefined
            }
          />
        ) : null}
        <ReadyWebview
          key={webSrc}
          src={webSrc}
          partition="default"
          navRef={webNavRef}
          onNavState={pushNav}
          onLocation={pushLoc}
        />
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="rounded-lg bg-up-soft px-3 py-2 text-[12.5px] text-up">{err}</div>
      </div>
    );
  }

  if (isImg) {
    if (!imgSrc) {
      return (
        <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
          <span className="animate-pulse">加载图片…</span>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgSrc} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (text === null && path) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
        <span className="animate-pulse">加载中…</span>
      </div>
    );
  }

  if (text != null && (ext === "md" || ext === "markdown" || kind === "document")) {
    return (
      <div className="h-full overflow-y-auto bg-white px-4 py-3">
        <WorkMdPreview content={text} />
      </div>
    );
  }

  if (text != null) {
    return (
      <div className="h-full overflow-y-auto bg-white px-4 py-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
          {text}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-4 text-[12.5px] text-ink-faint">
      无法预览（无 URL / 本地路径）· {kind}
    </div>
  );
}
