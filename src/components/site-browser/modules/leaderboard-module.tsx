"use client";

// Spec: 017-site-tabs — AI 模型榜单模块 (常驻容器用)
// AA / OpenRouter 两个站点选项卡 + 站内标签页。

import SiteBrowser from "@/components/site-browser/site-browser";

const SITES = [
  { id: "aa", label: "Artificial Analysis", url: "https://artificialanalysis.ai/" },
  { id: "openrouter", label: "OpenRouter 排名", url: "https://openrouter.ai/rankings" },
];

export default function LeaderboardModule() {
  return <SiteBrowser moduleKey="leaderboard" title="AI 模型榜单" sites={SITES} />;
}
