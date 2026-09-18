// Spec: 001-workbench-mvp — 领域模型与分组定义 (docs/conventions.md 术语表)

export type SeriesPoint = { date: string; value: number };

export type IndicatorGroupId =
  | "growth"
  | "consumption"
  | "trade"
  | "price"
  | "money"
  | "confidence"
  | "realestate"
  | "risk";

export type Indicator = {
  key: string;
  name: string;
  unit: string;
  freq: string;
  group: IndicatorGroupId;
  description: string;
  series: SeriesPoint[];
};

export type IndicatorGroup = { id: IndicatorGroupId; label: string };

export const INDICATOR_GROUPS: readonly IndicatorGroup[] = [
  { id: "growth", label: "总量与增长" },
  { id: "consumption", label: "消费与投资" },
  { id: "trade", label: "对外贸易" },
  { id: "price", label: "价格" },
  { id: "money", label: "货币与金融" },
  { id: "confidence", label: "信心先行" },
  { id: "realestate", label: "房地产" },
  { id: "risk", label: "汇率与外储" },
] as const;

/** 指标趋势图展示的期数窗口 */
export const TREND_WINDOW = 36;

export function latestPoint(series: readonly SeriesPoint[]): SeriesPoint | null {
  return series.length > 0 ? series[series.length - 1] : null;
}
