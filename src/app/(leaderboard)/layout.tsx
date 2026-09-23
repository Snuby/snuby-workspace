// Spec: 011-ai-leaderboard — 「AI 模型榜单」路由组共享外壳 (与 (macro)/(market) 同构, spec 008 决策 1/7)
// 顶栏 + 二级菜单 + 内容容器统一定义; 子页只渲染 iframe。
// 内容容器用 overflow-hidden: iframe 是独立滚动上下文, 外层滚动会导致双滚动条。

import Topbar from "@/components/workbench/topbar";
import SectionTabs, { type SectionTab } from "@/components/workbench/section-tabs";

const TABS: readonly SectionTab[] = [
  { href: "/ai-leaderboard", label: "Artificial Analysis" },
  { href: "/ai-leaderboard/openrouter", label: "OpenRouter 排名" },
];

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="AI 模型榜单" />
      <SectionTabs tabs={TABS} />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </>
  );
}
