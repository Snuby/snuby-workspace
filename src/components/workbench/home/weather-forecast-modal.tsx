"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openInSystemBrowser } from "@/lib/open-external";

/** 弹窗内嵌 Electron webview（中国天气网 PC 版） */
function ForecastWebview({ src }: { src: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const wv = document.createElement("webview") as unknown as HTMLElement & {
      style: CSSStyleDeclaration;
    };
    wv.setAttribute("src", src);
    wv.setAttribute("partition", "persist:snuby-weather");
    wv.style.cssText = "width:100%;height:100%;border:none;display:flex;";
    host.appendChild(wv);
    return () => {
      try {
        host.removeChild(wv);
      } catch {
        /* already gone */
      }
    };
  }, [src]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-white" />;
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export default function WeatherForecastModal({
  cityName,
  url,
  onClose,
}: {
  cityName: string;
  url: string;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onOpenExternal = useCallback(async () => {
    setOpening(true);
    try {
      await openInSystemBrowser(url);
    } catch {
      /* keep modal */
    } finally {
      setOpening(false);
    }
  }, [url]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${cityName}天气预报`}
        className="flex h-[min(820px,90vh)] w-[min(1100px,94vw)] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-[42px] shrink-0 items-center justify-between border-b border-line bg-page px-3">
          <div className="min-w-0 px-1">
            <span className="text-[13.5px] font-semibold text-ink">{cityName} · 预报</span>
            <span className="ml-2 text-[11.5px] text-ink-faint">中国天气网</span>
          </div>
          <div className="flex items-center gap-0.5">
            <IconBtn
              title="在浏览器中打开"
              disabled={opening}
              onClick={() => void onOpenExternal()}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </IconBtn>
            <div className="mx-0.5 h-4 w-px shrink-0 bg-line" />
            <IconBtn title="关闭" onClick={onClose}>
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
            </IconBtn>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ForecastWebview src={url} />
        </div>
      </div>
    </div>
  );
}
