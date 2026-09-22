// Spec: 010-ai-vc-watch — 创投布局左侧数据新鲜度提示 (Server)
// 「最新事件 YYYY-MM-DD · 共 N 条」; 超过 VC_STALE_DAYS 未更新转警示色。
// 取数失败静默隐藏, 不阻塞模块导航 (同 spec 009 FreshnessHint)。

import { VC_STALE_DAYS } from "@/domain/vc";
import { getVcFreshness } from "@/application/vc-service";

export default async function VcFreshnessHint() {
  let fresh;
  try {
    fresh = await getVcFreshness();
  } catch {
    return null;
  }
  if (!fresh.latestDate) {
    return (
      <span className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-faint">
        暂无事件 · 点右上角抓取或手动录入
      </span>
    );
  }

  const warn = fresh.stale && (fresh.lagDays ?? 0) > 0;
  return (
    <span
      className={[
        "shrink-0 whitespace-nowrap text-[11.5px]",
        warn ? "font-medium text-amber-700" : "text-ink-faint",
      ].join(" ")}
      title={
        warn
          ? `最新事件 ${fresh.latestDate}, 已 ${fresh.lagDays} 天未更新 (容忍 ${VC_STALE_DAYS} 天)`
          : `最新事件 ${fresh.latestDate}, 共 ${fresh.count} 条`
      }
    >
      最新事件 {fresh.latestDate} · 共 {fresh.count} 条
      {warn ? ` · ${fresh.lagDays} 天未更新` : ""}
    </span>
  );
}
