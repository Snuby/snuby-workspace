// Spec: 009-market-quotes — 行情领域模型与派生计算
// 本文件为纯领域层: 不含 IO、不 import 任何框架库 (见 docs/conventions.md 分层规范)

export type Period = "D" | "W" | "M" | "Y";
export type Range = "1Y" | "3Y" | "5Y" | "ALL";
export type AssetCategory = "metal" | "crypto" | "us" | "hk" | "cn" | "realestate";
/** 基础粒度: D 日频 | M 月频。月频资产禁用「日/周」聚合 (design 决策 6) */
export type AssetBaseFreq = "D" | "M";

export type Candle = {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type NormPoint = { date: string; value: number | null };

/** 库中 asset 表的元信息 (由 scripts/fetch_market.py 写入) */
export type AssetMeta = {
  symbol: string;
  name: string;
  category: AssetCategory;
  unit: string;
  baseFreq: AssetBaseFreq;
  precision: number;
  hasOhlc: boolean;
  hasVolume: boolean;
  note: string | null;
  firstDate: string | null;
  lastDate: string | null;
  updatedAt: string;
  /**
   * 绝对价位锚点 (元/㎡) — 官方无城市级月度均价, 房产类资产用中指研究院
   * 样本平均价格锚定最新绝对价位; 仅最新一期, 不构成时间序列。
   */
  refPrice: number | null;
  refPriceDate: string | null;
  refPriceSource: string | null;
};

// ---------- 常量表 ----------

/** 资产类别 (卡片分组展示顺序) — 与 Python 端 ASSETS 的 category 对应 */
export const ASSET_CATEGORIES: ReadonlyArray<{
  id: AssetCategory;
  label: string;
  symbols: readonly string[];
}> = [
  { id: "metal", label: "贵金属", symbols: ["gold", "silver"] },
  { id: "crypto", label: "加密货币", symbols: ["btc", "eth", "doge"] },
  { id: "us", label: "美股", symbols: ["dji", "ixic"] },
  { id: "hk", label: "中国香港股", symbols: ["hsi"] },
  { id: "cn", label: "A 股", symbols: ["sse"] },
  { id: "realestate", label: "房产", symbols: ["bj_house", "sh_house"] },
] as const;

/**
 * 二级菜单分页 (spec 009 已确认决策): 5 项。
 * 四个股票指数合并到「股票指数」一页, 以便同页做四线归一化对比 (design 决策 7)。
 */
export const MARKET_SECTIONS: ReadonlyArray<{
  href: string;
  label: string;
  categories: readonly AssetCategory[] | null; // null = 全部
}> = [
  { href: "/market", label: "综合对比", categories: null },
  { href: "/metal", label: "贵金属", categories: ["metal"] },
  { href: "/crypto", label: "加密货币", categories: ["crypto"] },
  { href: "/equity", label: "股票指数", categories: ["us", "hk", "cn"] },
  { href: "/realestate", label: "房产", categories: ["realestate"] },
] as const;

/** 合并图默认勾选: 覆盖面广的代表性子集 (US-4 AC1), 非默认全选 11 个以避免线过密 */
export const DEFAULT_COMPARE_SYMBOLS: readonly string[] = [
  "gold",
  "btc",
  "sse",
  "ixic",
  "bj_house",
] as const;

export const PERIODS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: "D", label: "日" },
  { id: "W", label: "周" },
  { id: "M", label: "月" },
  { id: "Y", label: "年" },
] as const;

export const RANGES: ReadonlyArray<{ id: Range; label: string; months: number | null }> = [
  { id: "1Y", label: "近 1 年", months: 12 },
  { id: "3Y", label: "近 3 年", months: 36 },
  { id: "5Y", label: "近 5 年", months: 60 },
  { id: "ALL", label: "全部", months: null },
] as const;

export const DEFAULT_PERIOD: Period = "W";
export const DEFAULT_RANGE: Range = "5Y";

/** 滞后容忍: 日频按自然日, 月频按月 (统计局月度数据次月中旬发布, 故留 60 天) */
export const MARKET_STALE_DAYS = 5;
export const MARKET_STALE_DAYS_MONTHLY = 60;

/** 归一化基准值: 所有曲线起点恒为该值 (design 决策 3) */
export const NORMALIZE_BASE = 100;

/**
 * 绝对价位锚点的展示口径 (2026-09-22 数据核验后引入)。
 * 官方无城市级月度均价, 房产类资产用中指研究院「二手住宅样本平均价格」锚定绝对价位;
 * 二手住宅口径同质可比性优于新建住宅 (后者受高端盘集中入市的结构效应主导)。
 */
export const REF_PRICE_LABEL = "二手住宅样本均价";
export const REF_PRICE_UNIT = "元/㎡";

/** 合并图分类色板 — 表达「资产身份」, 与涨跌色 (红涨绿跌) 语义分离 (design 决策 10) */
export const ASSET_COLORS: Record<string, string> = {
  gold: "#BA7517",
  silver: "#888780",
  btc: "#D85A30",
  eth: "#7F77DD",
  doge: "#0F6E56",
  dji: "#185FA5",
  ixic: "#534AB7",
  hsi: "#D4537E",
  sse: "#378ADD",
  bj_house: "#639922",
  sh_house: "#993556",
};

// ---------- 纯函数 ----------

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 月频资产是否禁用某粒度 (US-3 AC1) */
export function isPeriodDisabled(baseFreq: AssetBaseFreq, period: Period): boolean {
  return baseFreq === "M" && (period === "D" || period === "W");
}

/** 归一为某周/月/年的分组键。周以「所在周的周一日期」为键, 保证跨年周不被切断 */
export function bucketKey(date: string, period: Period): string {
  if (period === "M") return date.slice(0, 7);
  if (period === "Y") return date.slice(0, 4);
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = 周日
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** 区间合并为一根 K 线: 首开 / 最高 / 最低 / 末收 / 量求和 (design 决策 2) */
function mergeCandles(group: Candle[]): Candle {
  const sorted = group.slice().sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const highs = sorted.map((c) => c.high).filter((v): v is number => v !== null);
  const lows = sorted.map((c) => c.low).filter((v): v is number => v !== null);
  const vols = sorted.map((c) => c.volume);
  return {
    date: last.date,
    open: first.open,
    high: highs.length > 0 ? Math.max(...highs) : null,
    low: lows.length > 0 ? Math.min(...lows) : null,
    close: last.close,
    // 任一子项量缺失则整体缺失 — 不把 null 当 0 求和
    volume: vols.every((v): v is number => v !== null) ? vols.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * 日频 → 周/月/年聚合。入参须按 date 升序 (仓储层保证)。
 * period = "D" 时原样返回。月频资产的 "D" 聚合同样原样返回 (不伪造日频)。
 */
export function aggregate(rows: Candle[], period: Period): Candle[] {
  if (period === "D") return rows.slice();
  const buckets = new Map<string, Candle[]>();
  for (const r of rows) {
    const key = bucketKey(r.date, period);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }
  return [...buckets.keys()].sort().map((k) => mergeCandles(buckets.get(k) as Candle[]));
}

function shiftMonths(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 按窗口裁剪, 以序列最后一条数据的日期为锚点向前推 (design 决策 5) */
export function sliceRange(rows: Candle[], range: Range): Candle[] {
  const months = RANGES.find((r) => r.id === range)?.months ?? null;
  if (months === null || rows.length === 0) return rows;
  const cutoff = shiftMonths(rows[rows.length - 1].date, -months);
  return rows.filter((r) => r.date >= cutoff);
}

/**
 * 归一化为「基准点 = 100」的指数 (design 决策 3)。
 * baseDate 缺省取序列首个点; 早于首点时取首点; 基准值为 0 时返回 null 而非 Infinity。
 */
export function normalize(rows: Candle[], baseDate?: string): NormPoint[] {
  if (rows.length === 0) return [];
  let idx = 0;
  if (baseDate) {
    const found = rows.findIndex((r) => r.date >= baseDate);
    idx = found === -1 ? rows.length - 1 : found;
  }
  const base = rows[idx].close;
  return rows.slice(idx).map((r) => ({
    date: r.date,
    value: base === 0 ? null : round2((r.close / base) * NORMALIZE_BASE),
  }));
}

/**
 * 多序列对齐: 日期轴取并集(升序), 缺失值前向填充 (design 决策 4)。
 * 序列首个数据点之前填 null (绝不用回填值伪造历史)。
 */
export function alignSeries(series: Record<string, NormPoint[]>): {
  dates: string[];
  aligned: Record<string, Array<number | null>>;
} {
  const all = new Set<string>();
  for (const pts of Object.values(series)) {
    for (const p of pts) all.add(p.date);
  }
  const dates = [...all].sort();
  const aligned: Record<string, Array<number | null>> = {};
  for (const [key, pts] of Object.entries(series)) {
    const map = new Map(pts.map((p) => [p.date, p.value]));
    const arr: Array<number | null> = [];
    let carry: number | null = null;
    let started = false;
    for (const d of dates) {
      if (map.has(d)) {
        carry = map.get(d) ?? null;
        started = true;
        arr.push(carry);
      } else {
        arr.push(started ? carry : null);
      }
    }
    aligned[key] = arr;
  }
  return { dates, aligned };
}

/** 取 ref 的本地日期部分并归一到 UTC 午夜 —— 与 lastDate 同基准, 消除时区偏移 */
function utcDay(ref: Date): number {
  return Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());
}

/** 数据源是否滞后 (US-6 AC2) */
export function isMarketStale(
  lastDate: string,
  baseFreq: AssetBaseFreq,
  ref: Date = new Date(),
): boolean {
  const d = new Date(`${lastDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return true;
  const days = Math.floor((utcDay(ref) - d.getTime()) / 86_400_000);
  return days > (baseFreq === "M" ? MARKET_STALE_DAYS_MONTHLY : MARKET_STALE_DAYS);
}

/** 距最新数据的天数 (负数表示未来日期, 视为 0) */
export function lagDays(lastDate: string, ref: Date = new Date()): number {
  const d = new Date(`${lastDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((utcDay(ref) - d.getTime()) / 86_400_000));
}

/** 涨跌幅 %; 任一为空或基准为 0 时返回 null */
export function changePct(prev: number | null | undefined, curr: number | null | undefined): number | null {
  if (prev === null || prev === undefined || curr === null || curr === undefined || prev === 0) {
    return null;
  }
  return round2((curr / prev - 1) * 100);
}

/** 按资产精度格式化价格 — 不做全局统一取整 (design 决策 11) */
export function formatPrice(value: number, precision: number): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** 带符号的百分比文案 */
export function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** 某类别下的资产 symbol 列表 */
export function symbolsOfCategories(categories: readonly AssetCategory[] | null): string[] {
  if (categories === null) return ASSET_CATEGORIES.flatMap((c) => [...c.symbols]);
  return ASSET_CATEGORIES.filter((c) => categories.includes(c.id)).flatMap((c) => [...c.symbols]);
}

/** 资产所属类别标签 */
export function categoryLabel(category: AssetCategory): string {
  return ASSET_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}
