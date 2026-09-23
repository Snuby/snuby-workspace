// Spec: 001-workbench-mvp — 工作台外壳 (US-1)
// Spec: 008-macro-hierarchy — 描述文案随信息架构同步
// Spec: 009-market-quotes — 描述补充「资产行情」

import type { Metadata } from "next";
import Sidebar from "@/components/workbench/sidebar";
import ModuleHost from "@/components/workbench/module-host";
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
          {/* 模块常驻容器: 站点型模块的 SiteBrowser 常驻于此, 路由切换只改 visibility
              → webview 实例/浏览状态跨模块保留, 切回秒回; 非站点型页面走 children */}
          <ModuleHost>{children}</ModuleHost>
        </main>
      </body>
    </html>
  );
}
