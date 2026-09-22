// Spec: 010-ai-vc-watch — 创投用例编排 (application 层: 读仓储 → 组装视图模型)
// 聚合口径: amount_usd IS NULL (未披露) 的事件计入 count、不计入金额合计 (design 决策 4)

import { randomUUID } from "node:crypto";
import {
  CURRENCY_OPTIONS,
  ROUND_OPTIONS,
  SECTOR_LABELS,
  VC_STALE_DAYS,
  classifySector,
  monthKey,
  normalizeRound,
  toDealEventView,
  toUsd,
  type DealEvent,
  type DealEventView,
  type Sector,
} from "@/domain/vc";
import {
  VcDataError,
  loadDealEvents,
  loadDealEventsAll,
  loadVcMeta,
  upsertDealEvent,
  urlExists,
  type DealFilter,
} from "@/infrastructure/sqlite-vc-repository";

// ---------- 事件流 ----------

export type DealStream = {
  updatedAt: string;
  total: number;
  latestDate: string | null;
  deals: DealEventView[];
};

/** 事件流分页查询 (过滤 + 倒序, 视图映射) */
export async function getDealStream(filter: DealFilter): Promise<DealStream> {
  const page = await loadDealEvents(filter);
  return {
    updatedAt: page.updatedAt,
    total: page.total,
    latestDate: page.latestDate,
    deals: page.rows.map(toDealEventView),
  };
}

// ---------- 聚合统计 ----------

export type StatsItem = { key: string; count: number; amountUsd: number };
export type VcStats = {
  by: "sector" | "month";
  /** 赛道: 按 SECTOR_LABELS 表序 (unclassified 最后); 月份: 时间升序 */
  items: StatsItem[];
  /** 覆盖区间 (月份聚合时: "2026-06 至 2026-09"; 赛道聚合: 事件总数描述) */
  period: string;
};

/** 赛道/月度聚合 (供 /api/vc/stats 与分析页) */
export async function getVcStats(
  by: "sector" | "month",
  opts: { source?: string; sector?: string } = {},
): Promise<VcStats> {
  const rows = await loadDealEventsAll();
  const filtered = rows.filter(
    (e) =>
      (!opts.source || opts.source === "all" || e.source === opts.source) &&
      (!opts.sector || opts.sector === "all" || e.sector === opts.sector),
  );

  if (by === "sector") {
    const map = new Map<Sector, StatsItem>();
    for (const e of filtered) {
      const cur = map.get(e.sector) ?? { key: e.sector, count: 0, amountUsd: 0 };
      cur.count += 1;
      if (e.amountUsd !== null) cur.amountUsd += e.amountUsd;
      map.set(e.sector, cur);
    }
    const order = [...Object.keys(SECTOR_LABELS), "unclassified"];
    const items = [...map.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return {
      by,
      items,
      period: filtered.length > 0 ? `${filtered.length} 条事件` : "暂无事件",
    };
  }

  const map = new Map<string, StatsItem>();
  for (const e of filtered) {
    const key = monthKey(e.announcedAt);
    const cur = map.get(key) ?? { key, count: 0, amountUsd: 0 };
    cur.count += 1;
    if (e.amountUsd !== null) cur.amountUsd += e.amountUsd;
    map.set(key, cur);
  }
  const items = [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const period =
    items.length > 0 ? `${items[0].key} 至 ${items[items.length - 1].key}` : "暂无事件";
  return { by, items, period };
}

// ---------- 首页卡片 / 新鲜度 ----------

function lagDays(date: string, ref: Date): number {
  const d = new Date(`${date}T00:00:00Z`);
  const r = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return Math.max(0, Math.floor((r - d.getTime()) / 86_400_000));
}

export type VcOverview = {
  count: number;
  latestDate: string | null;
  updatedAt: string;
  /** 最近事件日期距今 > VC_STALE_DAYS 即视为滞后 (事件稀疏, 3 天容忍) */
  stale: boolean;
  lagDays: number | null;
  /** 赛道分布摘要 (供首页卡片展示 Top 3) */
  sectors: StatsItem[];
};

export async function getVcOverview(ref: Date = new Date()): Promise<VcOverview> {
  const meta = await loadVcMeta();
  const stats = await getVcStats("sector");
  return {
    count: meta.count,
    latestDate: meta.latestDate,
    updatedAt: meta.updatedAt,
    stale: meta.latestDate ? lagDays(meta.latestDate, ref) > VC_STALE_DAYS : true,
    lagDays: meta.latestDate ? lagDays(meta.latestDate, ref) : null,
    sectors: stats.items,
  };
}

export type VcFreshness = {
  count: number;
  updatedAt: string;
  latestDate: string | null;
  lagDays: number | null;
  stale: boolean;
};

/** 布局新鲜度提示 (最新事件日期 / 滞后警示) */
export async function getVcFreshness(ref: Date = new Date()): Promise<VcFreshness> {
  const meta = await loadVcMeta();
  return {
    count: meta.count,
    updatedAt: meta.updatedAt,
    latestDate: meta.latestDate,
    lagDays: meta.latestDate ? lagDays(meta.latestDate, ref) : null,
    stale: meta.latestDate ? lagDays(meta.latestDate, ref) > VC_STALE_DAYS : true,
  };
}

// ---------- 人工录入 ----------

export type ManualDealInput = {
  company: string;
  announcedAt: string;
  round?: string;
  amount?: number;
  currency?: string;
  sector?: string;
  url?: string;
  notes?: string;
};

export type ManualDealResult =
  | { ok: true; deal: DealEventView }
  | { ok: false; code: "validation"; errors: string[] }
  | { ok: false; code: "duplicate-url"; duplicateUrl: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECTOR_KEYS = Object.keys(SECTOR_LABELS) as Sector[];

/**
 * 人工录入用例 (US-4): 校验 → 409 查重 → 幂等写入。
 * 校验规则见 design 六节: 公司必填 / 日期合法且非未来 / currency ∈ 枚举 /
 * round 经 normalizeRound 归一化 (非法值存原文) / sector 缺省按 classifySector 推导。
 */
export async function createManualDeal(
  input: ManualDealInput,
  opts: { force?: boolean; ref?: Date } = {},
): Promise<ManualDealResult> {
  const ref = opts.ref ?? new Date();
  const errors: string[] = [];

  const company = input.company?.trim() ?? "";
  if (!company) errors.push("company 必填");

  const announcedAt = input.announcedAt ?? "";
  if (!DATE_RE.test(announcedAt)) {
    errors.push("announcedAt 须为 YYYY-MM-DD");
  } else {
    const d = new Date(`${announcedAt}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      errors.push("announcedAt 不是有效日期");
    } else {
      const today = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());
      if (d.getTime() > today) errors.push("announcedAt 不能是未来日期");
    }
  }

  let amount: number | null = null;
  let currency: string | null = null;
  if (input.amount !== undefined && input.amount !== null) {
    if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
      errors.push("amount 须为正数");
    } else {
      amount = Math.round(input.amount * 100) / 100;
      currency = input.currency ?? "";
      if (!CURRENCY_OPTIONS.includes(currency)) {
        errors.push(`currency 须为 ${CURRENCY_OPTIONS.join("/")}`);
      }
    }
  }

  let sector: Sector;
  if (input.sector && input.sector !== "all" && input.sector !== "") {
    if (!SECTOR_KEYS.includes(input.sector as Sector)) {
      errors.push(`sector 非法: ${input.sector}`);
      sector = "unclassified";
    } else {
      sector = input.sector as Sector;
    }
  } else {
    sector = classifySector(`${company} ${input.notes ?? ""}`);
  }

  if (errors.length > 0) return { ok: false, code: "validation", errors };

  const url = input.url?.trim() || null;
  if (url && (await urlExists(url)) && !opts.force) {
    return { ok: false, code: "duplicate-url", duplicateUrl: url };
  }

  const sourceId = randomUUID();
  const deal: DealEvent = {
    id: `manual:${sourceId}`,
    company,
    round: input.round ? (normalizeRound(input.round) ?? input.round.trim()) : null,
    amount,
    currency,
    amountUsd: amount !== null && currency ? toUsd(amount, currency) : null,
    announcedAt,
    sector,
    source: "manual",
    sourceId,
    title: input.notes ? `${company} · ${input.notes}` : company,
    url,
    notes: input.notes?.trim() || null,
  };
  await upsertDealEvent(deal);
  return { ok: true, deal: toDealEventView(deal) };
}

export { VcDataError };
export { ROUND_OPTIONS, CURRENCY_OPTIONS };
