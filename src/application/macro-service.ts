// Spec: 001-workbench-mvp — 宏观数据用例 (application 层, 编排仓储与视图模型)

import {
  INDICATOR_GROUPS,
  TREND_WINDOW,
  describeIndicator,
  isStale,
  lagMonths,
  type Indicator,
  type IndicatorGroup,
} from "@/domain/macro";
import { loadIndicators } from "@/infrastructure/sqlite-macro-repository";

export type IndicatorView = Indicator & {
  /** 近 TREND_WINDOW 期序列 (升序), 趋势图直接可用 */
  trend: Indicator["series"];
  latest: { date: string; value: number } | null;
  /** 数据源滞后月数 (未超发布节奏容忍度时为 null) — spec 004 */
  lag: number | null;
};

export type MacroDashboard = {
  updatedAt: string;
  groups: IndicatorGroup[];
  /** 按 INDICATOR_GROUPS 顺序分组的指标, 组内保持 meta 表顺序 */
  sections: Array<{ group: IndicatorGroup; indicators: IndicatorView[] }>;
  /** 数据源滞后 (非发布节奏) 的指标数 — spec 004 */
  staleCount: number;
};

export async function getMacroDashboard(): Promise<MacroDashboard> {
  const { indicators, updatedAt } = await loadIndicators();
  const byGroup = new Map<string, IndicatorView[]>();
  let staleCount = 0;

  for (const ind of indicators) {
    const trend = ind.series.slice(-TREND_WINDOW);
    const latest = trend.length > 0 ? trend[trend.length - 1] : null;
    const stale = latest !== null && isStale(latest.date, ind.freq);
    if (stale) staleCount += 1;
    const view: IndicatorView = {
      ...ind,
      description: describeIndicator(ind.key),
      trend,
      latest,
      lag: stale && latest ? lagMonths(latest.date) : null,
    };
    const bucket = byGroup.get(ind.group);
    if (bucket) bucket.push(view);
    else byGroup.set(ind.group, [view]);
  }

  const sections = INDICATOR_GROUPS.map((group) => ({
    group,
    indicators: byGroup.get(group.id) ?? [],
  }));

  return { updatedAt, groups: INDICATOR_GROUPS.slice(), sections, staleCount };
}
