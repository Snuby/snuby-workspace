// Spec: 001-workbench-mvp — 宏观数据用例 (application 层, 编排仓储与视图模型)

import {
  INDICATOR_GROUPS,
  TREND_WINDOW,
  describeIndicator,
  isStale,
  lagMonths,
  type Indicator,
  type IndicatorGroup,
  type IndicatorGroupId,
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
  /** 数据源滞后 (非发布节奏) 的指标数 — spec 004; 只统计本次可见范围内的指标 */
  staleCount: number;
};

/**
 * 「国家经济数据」可见的分组 = 全部分组去掉 industry (spec 008 决策 5)。
 * 从 INDICATOR_GROUPS 派生而非写死, 新增宏观分组时自动纳入。
 */
const MACRO_GROUP_IDS: readonly IndicatorGroupId[] = INDICATOR_GROUPS.map((g) => g.id).filter(
  (id) => id !== "industry",
);

/**
 * 按可见分组范围构建看板 (spec 008 决策 5)。
 * groups 传入 null 表示全量; staleCount 只统计可见指标, 避免把不可见分组的滞后计入页面文案。
 */
async function buildDashboard(groups: readonly IndicatorGroupId[] | null): Promise<MacroDashboard> {
  const { indicators, updatedAt } = await loadIndicators();
  const scope = groups ?? INDICATOR_GROUPS.map((g) => g.id);
  const inScope = new Set<string>(scope);
  const byGroup = new Map<string, IndicatorView[]>();
  let staleCount = 0;

  for (const ind of indicators) {
    if (!inScope.has(ind.group)) continue;
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

  const sections = INDICATOR_GROUPS.filter((group) => inScope.has(group.id)).map((group) => ({
    group,
    indicators: byGroup.get(group.id) ?? [],
  }));

  return { updatedAt, groups: sections.map((s) => s.group), sections, staleCount };
}

/**
 * 全量看板 — 9 个分组 / 36 项。
 * 保留全量语义供 `GET /api/macro/indicators` 使用 (spec 008 US-3 AC5): 数据接口契约不随页面分层变化。
 */
export async function getMacroDashboard(): Promise<MacroDashboard> {
  return buildDashboard(null);
}

/** 国家经济数据 (spec 008): 8 个宏观分组 / 26 项, 排除 industry 分组 */
export async function getNationalDashboard(): Promise<MacroDashboard> {
  return buildDashboard(MACRO_GROUP_IDS);
}

/** 行业观察 (spec 005): 仅 industry 分组 / 10 项 */
export async function getIndustryDashboard(): Promise<MacroDashboard> {
  return buildDashboard(["industry"]);
}
