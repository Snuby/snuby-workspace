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

/** 指标口径说明 (spec 001 US-2 AC2); 键与 fetch_data.py 指标 key 一一对应 */
export const INDICATOR_DESCRIPTIONS: Record<string, string> = {
  gdp_yoy: "季度 GDP 同比增速，经济总量扩张速度",
  gdp_secondary: "第二产业（工业 + 建筑业）增加值同比",
  gdp_tertiary: "第三产业（服务业）增加值同比",
  fiscal_revenue_yoy: "一般公共预算收入当月同比，财政端景气",
  ind_yoy: "规模以上工业增加值同比（统计局月度），生产端动能",
  cpi_yoy: "居民消费价格指数同比，消费端通胀",
  ppi_yoy: "工业生产者出厂价格同比，企业盈利周期",
  pmi_mfg: "制造业 PMI，50 为荣枯线，先行指标",
  pmi_non_mfg: "非制造业 PMI，服务业与建筑业景气",
  unemployment: "全国城镇调查失业率，就业压力",
  boom_index: "企业景气指数（季度），>100 为景气区间",
  consumer_confidence: "消费者信心指数（月度），>100 偏乐观",
  retail_yoy: "社会消费品零售总额当月同比，消费端",
  fdi_yoy: "固定资产投资当月同比，投资端",
  m1_yoy: "狭义货币 M1 同比，资金活化程度与企业信心",
  m2_yoy: "广义货币 M2 同比，整体流动性",
  shrzgm: "社会融资规模增量（亿元），实体经济融资总量",
  new_loans: "新增人民币贷款当月值（亿元），信贷投放力度",
  lpr_1y: "1 年期 LPR，实体企业贷款利率基准",
  lpr_5y: "5 年期以上 LPR，房贷利率基准",
  export_yoy: "出口金额当月同比（美元计价），外需强弱",
  import_yoy: "进口金额当月同比（美元计价），内需强弱",
  trade_balance: "贸易差额（当月，亿美元），外需贡献",
  fx_reserves: "官方外汇储备（亿美元），对外支付能力与汇率稳定器",
  real_estate_index: "房地产开发景气指数（国房景气指数），100 为景气分界",
  house_price_yoy: "70 城新建商品住宅价格指数同比均值，房价涨跌",
};

export function describeIndicator(key: string): string {
  return INDICATOR_DESCRIPTIONS[key] ?? "";
}

export function latestPoint(series: readonly SeriesPoint[]): SeriesPoint | null {
  return series.length > 0 ? series[series.length - 1] : null;
}

// Spec: 004-data-freshness — 数据时效判定 (区分「源滞后」与「发布节奏」)

/** 各频率容忍的滞后月数: 超过则判定为数据源滞后 */
export const STALE_LAG_MONTHS: Record<string, number> = {
  月度: 3,
  季度: 6,
  半年度: 8,
};

function toMonth(date: string): { y: number; m: number } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return { y, m: Number.isFinite(m) && m >= 1 && m <= 12 ? m : 12 };
}

/** 距今滞后月数 (按月份差, 可能为负表示含未来日期) */
export function lagMonths(latestDate: string, ref: Date = new Date()): number {
  const { y, m } = toMonth(latestDate);
  return ref.getFullYear() * 12 + (ref.getMonth() + 1) - (y * 12 + m);
}

/** 是否判定为数据源滞后 (超过该频率的发布节奏容忍度) */
export function isStale(latestDate: string, freq: string, ref: Date = new Date()): boolean {
  const threshold = STALE_LAG_MONTHS[freq] ?? STALE_LAG_MONTHS["月度"];
  return lagMonths(latestDate, ref) >= threshold;
}
