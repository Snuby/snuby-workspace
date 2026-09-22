// Spec: 009-market-quotes — 行情布局左侧的数据新鲜度提示
// 「数据更新至 X」; 落后时追加「落后 x 天」, 超过日频容忍 (MARKET_STALE_DAYS) 转警示色。
// 服务器组件 + 异步取数; 数据不可用时静默隐藏, 不阻塞模块导航。

import { MARKET_STALE_DAYS } from "@/domain/market";
import { getMarketFreshness } from "@/application/market-service";

export default async function FreshnessHint() {
  let fresh;
  try {
    fresh = await getMarketFreshness();
  } catch {
    return null;
  }
  if (!fresh.lastDate) return null;

  const lag = fresh.lagDays ?? 0;
  const behind = lag > 0;
  const warn = fresh.stale && behind;

  return (
    <span
      className={[
        "shrink-0 whitespace-nowrap text-[11.5px]",
        warn ? "font-medium text-amber-700" : "text-ink-faint",
      ].join(" ")}
      title={
        behind
          ? `最新数据日期 ${fresh.lastDate}, 落后今天 ${lag} 天 (容忍 ${MARKET_STALE_DAYS} 天)`
          : `最新数据日期 ${fresh.lastDate}`
      }
    >
      数据更新至 {fresh.lastDate}
      {behind ? ` · 落后 ${lag} 天` : ""}
    </span>
  );
}
