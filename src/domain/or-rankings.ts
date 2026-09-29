// Spec: 011-ai-leaderboard — OpenRouter 榜单聚合纯函数
// 数据源: https://openrouter.ai/api/frontend/v1/rankings/models?view=week (公开 API)
// 原始结构: 每行 = 某模型某 variant 某日的 token 用量; 聚合 = 按模型求和 + 排序。

export type OrRankingInput = {
  date: string;
  model_permaslug: string;
  total_completion_tokens: number;
  total_prompt_tokens: number;
};

export type OrRankingRow = {
  rank: number;
  slug: string;
  name: string;
  tokens: number;
};

export type OrRankingAggregate = {
  rows: OrRankingRow[];
  updatedAt: string | null;
};

/** slug → 展示名: "deepseek/deepseek-v4-flash-20260731" → "deepseek/v4-flash"; 无斜杠原样返回 */
export function shortModelName(slug: string): string {
  if (!slug) return "";
  const [org, ...rest] = slug.split("/");
  const model = rest.join("/");
  if (!model) return org;
  const cleaned = model.replace(/-\d{8}$/, "");
  const name = cleaned.startsWith(`${org}-`) ? cleaned.slice(org.length + 1) : cleaned;
  return name ? `${org}/${name}` : org;
}

/** token 量格式化: 18.4T / 6.43B / 912.1M (1 位小数) */
export function formatTokens(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return String(Math.round(n));
}

/** 按模型聚合周 token 总量 (completion + prompt), 降序赋 rank; updatedAt = 数据最大日期 */
export function aggregateRankings(rows: OrRankingInput[]): OrRankingAggregate {
  const bySlug = new Map<string, number>();
  let updatedAt: string | null = null;
  for (const row of rows) {
    bySlug.set(row.model_permaslug, (bySlug.get(row.model_permaslug) ?? 0) + row.total_completion_tokens + row.total_prompt_tokens);
    const day = (row.date ?? "").slice(0, 10);
    if (day && (!updatedAt || day > updatedAt)) updatedAt = day;
  }
  const ranked = [...bySlug.entries()]
    .map(([slug, tokens]) => ({ slug, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .map((entry, i) => ({
      rank: i + 1,
      slug: entry.slug,
      name: shortModelName(entry.slug),
      tokens: entry.tokens,
    }));
  return { rows: ranked, updatedAt };
}
