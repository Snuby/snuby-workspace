// Spec: 001-workbench-mvp — 工作台外壳 (US-1)
// Spec: 008-macro-hierarchy — 描述文案随信息架构同步
// Spec: 009-market-quotes — 描述补充「资产行情」

import type { Metadata } from "next";
import Sidebar from "@/components/workbench/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snuby 工作台",
  description: "Snuby 本地工作台：宏观经济看板、资产行情与效率工具",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          {children}
          {/* 全局 WebView 舞台: 所有标签的 webview 常驻于此 (跨模块/站点保留, 只改 visibility 切换) */}
          <div
            id="snuby-stage"
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0"
          />
        </main>
      </body>
    </html>
  );
}
