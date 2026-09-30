"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";

export type PreviewModalSize = "md" | "lg" | "xl";

const SIZE_CLASS: Record<PreviewModalSize, string> = {
  md: "h-[min(520px,85vh)] w-[min(440px,92vw)]",
  lg: "h-[82vh] w-[min(1100px,92vw)]",
  xl: "h-[min(820px,90vh)] w-[min(1100px,94vw)]",
};

/** 预览框标题栏小按钮 */
export function PreviewIconBtn({
  title,
  disabled,
  onClick,
  children,
  className = "",
}: {
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted ${className}`}
    >
      {children}
    </button>
  );
}

/** Electron <webview> 导航能力 */
export type PreviewWebviewNav = {
  goBack: () => void;
  goForward: () => void;
};

type WebviewEl = HTMLElement & {
  style: CSSStyleDeclaration;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
  getURL?: () => string;
};

/** 弹窗内嵌 Electron webview（支持页内前进/后退） */
export function PreviewWebview({
  src,
  partition = "default",
  onNavState,
  navRef,
}: {
  src: string;
  partition?: string;
  onNavState?: (state: { canGoBack: boolean; canGoForward: boolean }) => void;
  navRef?: { current: PreviewWebviewNav | null };
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onNavStateRef = useRef(onNavState);
  onNavStateRef.current = onNavState;
  const navRefBox = useRef(navRef);
  navRefBox.current = navRef;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const wv = document.createElement("webview") as unknown as WebviewEl;
    wv.setAttribute("src", src);
    wv.setAttribute("partition", partition);
    wv.style.cssText = "width:100%;height:100%;border:none;display:flex;";

    let alive = true;

    const sync = () => {
      if (!alive) return;
      let canGoBack = false;
      let canGoForward = false;
      try {
        // guest 未就绪时调用会抛错，必须吞掉
        canGoBack = typeof wv.canGoBack === "function" ? Boolean(wv.canGoBack()) : false;
        canGoForward =
          typeof wv.canGoForward === "function" ? Boolean(wv.canGoForward()) : false;
      } catch {
        canGoBack = false;
        canGoForward = false;
      }
      onNavStateRef.current?.({ canGoBack, canGoForward });
      const box = navRefBox.current;
      if (box) {
        box.current = {
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
      }
    };

    wv.addEventListener("did-navigate", sync);
    wv.addEventListener("did-navigate-in-page", sync);
    wv.addEventListener("did-finish-load", sync);
    wv.addEventListener("dom-ready", sync);

    host.appendChild(wv);
    // 不在挂载瞬间 sync：guest 未就绪会抛

    return () => {
      alive = false;
      wv.removeEventListener("did-navigate", sync);
      wv.removeEventListener("did-navigate-in-page", sync);
      wv.removeEventListener("did-finish-load", sync);
      wv.removeEventListener("dom-ready", sync);
      const box = navRefBox.current;
      if (box) box.current = null;
      onNavStateRef.current?.({ canGoBack: false, canGoForward: false });
      try {
        host.removeChild(wv);
      } catch {
        /* already gone */
      }
    };
  }, [src, partition]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-white" />;
}

/**
 * 通用预览弹窗壳：遮罩 + 标题栏 + 内容区。
 * 本地 Agent 链接/文件预览、天气预报等共用。
 */
export default function PreviewModal({
  title,
  subtitle,
  onClose,
  children,
  leading,
  trailing,
  size = "lg",
  panelClassName,
  bodyClassName = "min-h-0 flex-1 bg-white",
  overlayClassName = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6",
  onEscape,
  onContextMenu,
  showClose = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 标题左侧（如前进/后退） */
  leading?: ReactNode;
  /** 关闭按钮左侧工具区 */
  trailing?: ReactNode;
  size?: PreviewModalSize;
  /** 覆盖默认尺寸 */
  panelClassName?: string;
  bodyClassName?: string;
  overlayClassName?: string;
  /** 默认 Esc = onClose；Agent 可改为「能退则退」 */
  onEscape?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  showClose?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      (onEscape ?? onClose)();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onEscape]);

  return (
    <div
      className={overlayClassName}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={[
          "flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl",
          panelClassName ?? SIZE_CLASS[size],
        ].join(" ")}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={onContextMenu}
      >
        <div className="shrink-0 border-b border-line bg-page px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            {leading ? (
              <>
                {leading}
                <div className="mx-1 h-4 w-px shrink-0 bg-line" />
              </>
            ) : null}

            <div className="min-w-0 flex-1 truncate px-0.5">
              <span className="text-[13px] font-semibold text-ink">{title}</span>
              {subtitle ? (
                <span className="ml-2 text-[11.5px] font-normal text-ink-faint">{subtitle}</span>
              ) : null}
            </div>

            <div className="flex items-center gap-0.5">
              {trailing}
              {trailing && showClose ? (
                <div className="mx-0.5 h-4 w-px shrink-0 bg-line" />
              ) : null}
              {showClose ? (
                <PreviewIconBtn title="关闭" onClick={onClose}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    className="h-4 w-4"
                  >
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </PreviewIconBtn>
              ) : null}
            </div>
          </div>
        </div>
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>
  );
}
