// Spec: 011-ai-leaderboard — 默认页: Artificial Analysis (US-1, AC-B)
// 该站响应头无 X-Frame-Options / CSP frame-ancestors 限制 (2026-09-23 实测), 可直接 iframe。

import LeaderboardFrame from "@/components/leaderboard/leaderboard-frame";

export default function AiLeaderboardPage() {
  return (
    <LeaderboardFrame
      src="https://artificialanalysis.ai/"
      title="Artificial Analysis — AI 模型榜单"
      externalUrl="https://artificialanalysis.ai/"
    />
  );
}
