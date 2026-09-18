// Spec: 001-workbench-mvp — 宏观数据用例 (application 层, 编排仓储与视图模型)

import {
  INDICATOR_GROUPS,
  TREND_WINDOW,
  type Indicator,
  type IndicatorGroup,
} from "@/domain/macro";
import { loadIndicators } from "@/infrastructure/sqlite-macro-repository";

export type IndicatorView = Indicator & {
  /** 近 TREND_WINDOW 期序列 (升序), 趋势图直接可用 */
  trend: Indicator["series"];
  latest: { date: string; value: number } | null;
};

export type MacroDashboard = {
  updatedAt: string;
  groups: IndicatorGroup[];
  /** 按 INDICATOR_GROUPS 顺序分组的指标, 组内保持 meta 表顺序 */
  sections: Array<{ group: IndicatorGroup; indicators: IndicatorView[] }>;
};

export async function getMacroDashboard(): Promise<MacroDashboard> {
  const { indicators, updatedAt } = await loadIndicators();
  const byGroup = new Map<string, IndicatorView[]>();

  for (const ind of indicators) {
    const trend = ind.series.slice(-TREND_WINDOW);
    const latest = trend.length > 0 ? trend[trend.length - 1] : null;
    const view: IndicatorView = { ...ind, trend, latest };
    const bucket = byGroup.get(ind.group);
    if (bucket) bucket.push(view);
    else byGroup.set(ind.group, [view]);
  }

  const sections = INDICATOR_GROUPS.map((group) => ({
    group,
    indicators: byGroup.get(group.id) ?? [],
  }));

  return { updatedAt, groups: INDICATOR_GROUPS.slice(), sections };
}
