"use client";

// Spec: 013-webview-embeds — 榜单 webview 容器 (桌面版官网原页, US-1/AC-A)
// Electron: <webview> 以顶层导航加载官网 (不受 XFO/CSP 限制, 动态数据正常)
// Web: 渲染 fallback (011 现状: AA iframe / OR 自渲染), US-2/AC-B
// Hydration 策略: 服务端无法感知 Electron (UA 在客户端), 首屏必须与 SSR 一致 →
// 初始渲染 fallback, mount 后 useEffect 检测 Electron 再切换 webview (防 React #418)。
// 注: <webview> 为 Electron 专有元素, 非标准 HTML; 用 createElement 创建以规避 JSX 类型问题。

import { createElement, useEffect, useState, type ReactNode } from "react";

function isElectron() {
  return typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
}

export default function WebviewFrame({
  src,
  title,
  fallback,
  partition,
}: {
  src: string;
  title: string;
  fallback: ReactNode;
  /** spec 016: 自媒体登录态持久化分区 (persist:snuby-creators), 缺省不设 */
  partition?: string;
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(isElectron());
  }, []);

  if (!isDesktop) return <>{fallback}</>;

  const webview = createElement("webview", {
    src,
    title,
    partition,
    className: "min-h-0 w-full flex-1 border-0",
    style: { flex: "1 1 0%", minHeight: 0 },
  });

  // spec 016: 去除顶条提示与「在新窗口打开」链接 (用户批复 2026-09-23)
  return (
    <div className="flex h-full w-full flex-col">
      {webview}
    </div>
  );
}
