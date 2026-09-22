// Spec: 001-workbench-mvp — 工作台外壳 (US-1)
// Spec: 008-macro-hierarchy — 描述文案随信息架构同步

import type { Metadata } from "next";
import Sidebar from "@/components/workbench/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snuby 工作台",
  description: "Snuby 本地工作台：宏观经济看板与效率工具",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
