// Spec: 011-ai-leaderboard — OpenRouter 排名页 (US-2, AC-C)
// 用户决策 (2026-09-23): 官方页面 x-frame-options: SAMEORIGIN 拒绝嵌入, 同源代理虽绕过
// 但动态数据层 (clerk 认证在 iframe 下挂起) 无法激活 → 改用官方公开 API 服务端聚合自渲染。
// 数据: https://openrouter.ai/api/frontend/v1/rankings/models?view=week

import OpenRouterBoard from "@/components/leaderboard/openrouter-board";
import { aggregateRankings, type OrRankingAggregate } from "@/domain/or-rankings";

export const dynamic = "force-dynamic";

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

  return <OpenRouterBoard rows={data.rows} updatedAt={data.updatedAt} error={error} />;
}
