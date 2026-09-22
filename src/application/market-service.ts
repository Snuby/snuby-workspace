// Spec: 009-market-quotes — 行情用例编排 (application 层: 读仓储 → 组装视图模型)

import {
  ASSET_CATEGORIES,
  DEFAULT_PERIOD,
  DEFAULT_RANGE,
  aggregate,
  alignSeries,
  changePct,
  isMarketStale,
  lagDays,
  normalize,
  sliceRange,
  type AssetCategory,
  type AssetMeta,
  type Candle,
  type NormPoint,
  type Period,
  type Range,
} from "@/domain/market";
import { loadAssets, loadKlineBatch } from "@/infrastructure/sqlite-market-repository";

export type AssetStat = AssetMeta & {
  latest: { date: string; close: number } | null;
  /** 最新一个交易日的涨跌幅 % */
  changePct: number | null;
  /** 近一年涨跌幅 % */
  yearChangePct: number | null;
  stale: boolean;
  lagDays: number | null;
  /** 迷你走势 (窗口内等距采样的收盘价) */
  spark: number[];
};

export type MarketOverview = {
  updatedAt: string;
  assets: AssetStat[];
  /** 按 domain 类别分组, 供 /market 页分块展示 */
  sections: Array<{ id: AssetCategory; label: string; assets: AssetStat[] }>;
};

/** 迷你走势采样上限 */
const SPARK_POINTS = 30;
/** 资产卡上的区间涨跌口径 */
const CARD_RANGE: Range = "1Y";

function sparkline(rows: Candle[]): number[] {
  if (rows.length === 0) return [];
  const step = Math.max(1, Math.ceil(rows.length / SPARK_POINTS));
  const out: number[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i].close);
  const last = rows[rows.length - 1].close;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** 全部资产的实时统计 (供 /market 与各分类页) */
export async function getMarketOverview(ref: Date = new Date()): Promise<MarketOverview> {
  const { assets, updatedAt } = await loadAssets();
  const klines = await loadKlineBatch(assets.map((a) => a.symbol));

  const stats: AssetStat[] = assets.map((a) => {
    const rows = klines[a.symbol] ?? [];
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const window = sliceRange(rows, CARD_RANGE);
    const first = window.length > 0 ? window[0] : null;
    return {
      ...a,
      latest: latest ? { date: latest.date, close: latest.close } : null,
      changePct: changePct(prev?.close, latest?.close),
      yearChangePct: changePct(first?.close, latest?.close),
      stale: a.lastDate ? isMarketStale(a.lastDate, a.baseFreq, ref) : true,
      lagDays: a.lastDate ? lagDays(a.lastDate, ref) : null,
      spark: sparkline(window),
    };
  });

  // 展示顺序由 domain 的 ASSET_CATEGORIES 决定, 不依赖数据库行序
  const sections = ASSET_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    assets: c.symbols
      .map((s) => stats.find((x) => x.symbol === s))
      .filter((x): x is AssetStat => x !== undefined),
  })).filter((s) => s.assets.length > 0);

  return { updatedAt, assets: stats, sections };
}

export type AssetSeries = {
  symbol: string;
  period: Period;
  range: Range;
  candles: Candle[];
};

/**
 * 单资产 K 线: 读全量日频 → 聚合到目标粒度 → 按窗口裁剪。
 * 先聚合后裁剪, 使窗口边界的 K 线保持完整区间 (design 决策 5 注)。
 */
export async function getAssetSeries(
  symbol: string,
  period: Period = DEFAULT_PERIOD,
  range: Range = DEFAULT_RANGE,
): Promise<AssetSeries> {
  const klines = await loadKlineBatch([symbol]);
  const candles = sliceRange(aggregate(klines[symbol] ?? [], period), range);
  return { symbol, period, range, candles };
}

export type ComparisonResult = {
  period: Period;
  range: Range;
  symbols: string[];
  dates: string[];
  /** 归一化并对齐后的序列, 值 = 指数 (基准 100); null 表示该日尚未开始或缺失 */
  series: Record<string, Array<number | null>>;
  /** 各资产实际采用的基准日 —— 起始日期不同, 不能假设统一 */
  bases: Record<string, string>;
  metas: AssetMeta[];
};

/** 跨资产归一化对比 (spec 009 US-4 核心) */
export async function getComparison(
  symbols: string[],
  period: Period = DEFAULT_PERIOD,
  range: Range = DEFAULT_RANGE,
  baseDate?: string,
): Promise<ComparisonResult> {
  const { assets } = await loadAssets();
  const metas = symbols
    .map((s) => assets.find((a) => a.symbol === s))
    .filter((a): a is AssetMeta => a !== undefined);
  const klines = await loadKlineBatch(metas.map((m) => m.symbol));

  const raw: Record<string, NormPoint[]> = {};
  const bases: Record<string, string> = {};
  for (const m of metas) {
    const candles = sliceRange(aggregate(klines[m.symbol] ?? [], period), range);
    const points = normalize(candles, baseDate);
    raw[m.symbol] = points;
    if (points.length > 0) bases[m.symbol] = points[0].date;
  }

  const { dates, aligned } = alignSeries(raw);
  return {
    period,
    range,
    symbols: metas.map((m) => m.symbol),
    dates,
    series: aligned,
    bases,
    metas,
  };
}
