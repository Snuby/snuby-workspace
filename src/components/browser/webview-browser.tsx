"use client";

// Spec: 016-nav-modules — Web 访问简易浏览器 (FR-4, D4 定案: 默认主页 Google)
// 桌面版: 地址栏 + <webview> (ref 调用 Electron 原生 loadURL/goBack/goForward/reload)
// Web 版: 无 webview → 提示页 (FR-5: 隐藏入口 + 直连提示「请使用桌面版」)
// Hydration 策略同 webview-frame: 首帧渲染提示态, mount 后检测 Electron 再渲染 webview (防 React #418)。

import { createElement, useEffect, useRef, useState } from "react";
import { normalizeUrl } from "@/domain/url-utils";

const HOME_URL = "https://www.google.com/";

function isElectron() {
  return typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
}

/** Electron <webview> 元素的实例方法 (非标准 HTML, 见 spec 013) */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
}

export default function WebviewBrowser() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(HOME_URL);
  const [address, setAddress] = useState("");
  const webviewRef = useRef<WebviewElement | null>(null);

  useEffect(() => {
    setIsDesktop(isElectron());
  }, []);

  // webview 渲染完成后挂载导航事件 (地址栏回显当前 URL)
  useEffect(() => {
    if (!isDesktop) return;
    const el = webviewRef.current;
    if (!el) return;
    const onNav = (e: Event) => {
      const url = (e as Event & { url?: string }).url;
      if (url) {
        setCurrentUrl(url);
        setAddress(url);
      }
    };
    el.addEventListener("did-navigate", onNav);
    el.addEventListener("did-navigate-in-page", onNav);
    return () => {
      el.removeEventListener("did-navigate", onNav);
      el.removeEventListener("did-navigate-in-page", onNav);
    };
  }, [isDesktop]);

  function go(target?: string) {
    const el = webviewRef.current;
    if (!el) return;
    const raw = target ?? address;
    const normalized = normalizeUrl(raw);
    const url = normalized ?? (raw.trim() === "" ? HOME_URL : null);
    if (!url) return; // 非法输入忽略 (地址栏回显不变)
    el.loadURL(url);
    setAddress(url);
  }

  if (!isDesktop) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface">
        <p className="text-[14px] text-ink">Web 访问</p>
        <p className="text-[12.5px] text-ink-muted">简易浏览器为桌面版功能，请在桌面 App 中使用。</p>
      </div>
    );
  }

  const webview = createElement("webview", {
    ref: webviewRef,
    src: currentUrl,
    allowpopups: "true",
    className: "h-full w-full border-0",
    style: { flex: "1 1 0%", minHeight: 0 },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[46px] shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3">
        <button
          type="button"
          onClick={() => webviewRef.current?.goBack()}
          title="后退"
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-muted hover:bg-black/5 disabled:opacity-40"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => webviewRef.current?.goForward()}
          title="前进"
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-muted hover:bg-black/5"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => webviewRef.current?.reload()}
          title="刷新"
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-muted hover:bg-black/5"
        >
          ⟳
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          placeholder="输入网址，如 example.com"
          className="ml-1 h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => go()}
          className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
        >
          前往
        </button>
        <button
          type="button"
          onClick={() => go(HOME_URL)}
          title="主页 (Google)"
          className="rounded-md px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-black/5"
        >
          主页
        </button>
      </div>
      {webview}
    </div>
  );
}
