// Spec: 011/013 — 默认页: Artificial Analysis (US-1, AC-A/AC-B)
// 桌面版(Electron): <webview> 顶层导航加载官网原页 (不受 XFO/CSP 限制, spec 013)
// Web 版: 该站响应头无 X-Frame-Options / CSP frame-ancestors 限制 (011 实测), 保持 iframe 直嵌。

import WebviewFrame from "@/components/leaderboard/webview-frame";
import LeaderboardFrame from "@/components/leaderboard/leaderboard-frame";

const AA_URL = "https://artificialanalysis.ai/";

export default function AiLeaderboardPage() {
  return (
    <WebviewFrame
      src={AA_URL}
      title="Artificial Analysis — AI 模型榜单"
      fallback={
        <LeaderboardFrame
          src={AA_URL}
          title="Artificial Analysis — AI 模型榜单"
          externalUrl={AA_URL}
        />
      }
    />
  );
}
