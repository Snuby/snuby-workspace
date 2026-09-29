import type { Metadata } from "next";
import Sidebar from "@/components/workbench/sidebar";
import TopicHost from "@/components/workbench/topic-host";
import { TopicsProvider } from "@/components/workbench/topics-context";
import GlobalPointerGuards from "@/components/ui/global-pointer-guards";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snuby 工作台",
  description: "Snuby 本地桌面工作台：主题浏览、Web 访问与本地 Agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden bg-page">
        <GlobalPointerGuards />
        <TopicsProvider>
          <Sidebar />
          {/* 右侧正片: 相对侧栏/页底浮起; 内容区不设 drag, 优先可交互 */}
          <main className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-shell)] border border-line bg-surface shadow-[0_1px_2px_rgba(28,31,36,0.04)]">
            <TopicHost>{children}</TopicHost>
          </main>
        </TopicsProvider>
      </body>
    </html>
  );
}
