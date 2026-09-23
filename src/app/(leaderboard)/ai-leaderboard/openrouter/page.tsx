// Spec: 011/013 — OpenRouter 排名页 (US-1/2, AC-A/AC-B)
// 用户决策 (2026-09-23): 官方页面 x-frame-options: SAMEORIGIN 拒绝 iframe 嵌入, clerk 在 iframe 下挂起 (011 实测)
// → 桌面版(Electron) 用 <webview> 顶层导航加载官网原页 (spec 013, 不受 XFO/CSP 限制)
// → Web 版保持官方公开 API 服务端聚合自渲染 (011 现状, 作降级)
// 数据: https://openrouter.ai/api/frontend/v1/rankings/models?view=week

import WebviewFrame from "@/components/leaderboard/webview-frame";
import OpenRouterBoard from "@/components/leaderboard/openrouter-board";
import { aggregateRankings, type OrRankingAggregate } from "@/domain/or-rankings";

export const dynamic = "force-dynamic";

const OR_URL = "https://openrouter.ai/rankings";
const OR_API = "https://openrouter.ai/api/frontend/v1/rankings/models?view=week";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export default async function OpenRouterBoardPage() {
  let data: OrRankingAggregate = { rows: [], updatedAt: null };
  let error: string | null = null;

  try {
    const res = await fetch(OR_API, {
      headers: { "user-agent": BROWSER_UA, accept: "application/json", referer: "https://openrouter.ai/" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`上游 HTTP ${res.status}`);
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json.data)) throw new Error("响应结构异常");
    data = aggregateRankings(json.data as never);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return (
    <WebviewFrame
      src={OR_URL}
      title="OpenRouter 排名 — AI 模型榜单"
      fallback={<OpenRouterBoard rows={data.rows} updatedAt={data.updatedAt} error={error} />}
    />
  );
}
