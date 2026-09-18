// Spec: 001-workbench-mvp — 工作台外壳 (US-1)

import type { Metadata } from "next";
import Sidebar from "@/components/workbench/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snuby 工作台",
  description: "Snuby 本地工作台：数据观察与效率工具",
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
