// Spec: 010-ai-vc-watch — 融资事件 SQLite 仓储 (infrastructure 层, 不含业务规则)
// 读: 只读连接; 写 (人工录入): 可写连接 + 幂等建表 (录入可先于管道初始化)
// DDL 与 scripts/fetch_vc.py 逐字一致 (design 第三节)

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DealEvent, Sector } from "@/domain/vc";

export class VcDataError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "VcDataError";
  }
}

export type DealFilter = {
  sector?: Sector | "all";
  source?: string;
  minUsd?: number;
  limit: number;
  offset: number;
};

export type DealPage = {
  rows: DealEvent[];
  total: number;
  updatedAt: string;
  latestDate: string | null;
};

type DealRow = {
  id: string;
  company: string;
  round: string | null;
  amount: number | null;
  currency: string | null;
  amount_usd: number | null;
  announced_at: string;
  sector: string;
  source: string;
  source_id: string;
  title: string | null;
  url: string | null;
  notes: string | null;
  updated_at: string;
};

function resolveVcDbPath(): string {
  const p = process.env.VC_DB_PATH ?? path.join(process.cwd(), "data", "vc.db");
  return path.resolve(p);
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS deal_event (
    id TEXT PRIMARY KEY, company TEXT NOT NULL, round TEXT, amount REAL,
    currency TEXT, amount_usd REAL, announced_at TEXT NOT NULL,
    sector TEXT NOT NULL DEFAULT 'unclassified', source TEXT NOT NULL,
    source_id TEXT NOT NULL, title TEXT, url TEXT, notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_deal_announced ON deal_event (announced_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_deal_sector ON deal_event (sector)",
  "CREATE INDEX IF NOT EXISTS idx_deal_source ON deal_event (source)",
  "CREATE INDEX IF NOT EXISTS idx_deal_url ON deal_event (url)",
];

function toDeal(row: DealRow): DealEvent {
  return {
    id: row.id,
    company: row.company,
    round: row.round,
    amount: row.amount,
    currency: row.currency,
    amountUsd: row.amount_usd,
    announcedAt: row.announced_at,
    sector: row.sector as Sector,
    source: row.source,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    notes: row.notes,
  };
}

function whereClause(filter: DealFilter): { sql: string; params: Array<string | number> } {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  if (filter.sector && filter.sector !== "all") {
    conds.push("sector = ?");
    params.push(filter.sector);
  }
  if (filter.source && filter.source !== "all") {
    conds.push("source = ?");
    params.push(filter.source);
  }
  if (typeof filter.minUsd === "number" && Number.isFinite(filter.minUsd)) {
    conds.push("amount_usd >= ?");
    params.push(filter.minUsd);
  }
  return { sql: conds.length > 0 ? ` WHERE ${conds.join(" AND ")}` : "", params };
}

/** 事件流分页查询 (倒序; 限流 ≤200 由调用方保证); 库未初始化 → 空数据降级 */
export async function loadDealEvents(filter: DealFilter): Promise<DealPage> {
  const dbPath = resolveVcDbPath();
  if (!existsSync(dbPath)) {
    return { rows: [], total: 0, updatedAt: new Date().toISOString(), latestDate: null };
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (cause) {
    throw new VcDataError(`无法打开创投数据库 ${dbPath}，请先运行 npm run fetch:vc 或人工录入首条事件`, cause);
  }
  try {
    const { sql, params } = whereClause(filter);
    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM deal_event${sql}`).get(...params) as { n: number }
    ).n;
    const rows = db
      .prepare(
        `SELECT * FROM deal_event${sql} ORDER BY announced_at DESC, updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.limit, filter.offset) as unknown as DealRow[];
    const meta = db.prepare("SELECT MAX(updated_at) AS t, MAX(announced_at) AS d FROM deal_event").get() as {
      t: string | null;
      d: string | null;
    };
    return {
      rows: rows.map(toDeal),
      total,
      updatedAt: meta.t ?? new Date().toISOString(),
      latestDate: meta.d,
    };
  } catch (cause) {
    if (cause instanceof VcDataError) throw cause;
    throw new VcDataError(`读取创投数据库失败: ${dbPath}`, cause);
  } finally {
    db.close();
  }
}

/** 全量事件 (供 stats 聚合; 年数千条量级, 内存聚合可行); 库未初始化 → 空降级 */
export async function loadDealEventsAll(): Promise<DealEvent[]> {
  const dbPath = resolveVcDbPath();
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (cause) {
    throw new VcDataError(`无法打开创投数据库 ${dbPath}，请先运行 npm run fetch:vc`, cause);
  }
  try {
    const rows = db.prepare("SELECT * FROM deal_event").all() as unknown as DealRow[];
    return rows.map(toDeal);
  } catch (cause) {
    throw new VcDataError(`读取创投数据库失败: ${dbPath}`, cause);
  } finally {
    db.close();
  }
}

export type VcMeta = {
  count: number;
  updatedAt: string;
  latestDate: string | null;
};

/** 模块元信息 (首页卡片 / 新鲜度提示共用); 库未初始化 → 空降级 */
export async function loadVcMeta(): Promise<VcMeta> {
  const dbPath = resolveVcDbPath();
  if (!existsSync(dbPath)) {
    return { count: 0, updatedAt: new Date().toISOString(), latestDate: null };
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (cause) {
    throw new VcDataError(`无法打开创投数据库 ${dbPath}，请先运行 npm run fetch:vc`, cause);
  }
  try {
    const meta = db
      .prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS t, MAX(announced_at) AS d FROM deal_event")
      .get() as { n: number; t: string | null; d: string | null };
    return { count: meta.n, updatedAt: meta.t ?? new Date().toISOString(), latestDate: meta.d };
  } catch (cause) {
    throw new VcDataError(`读取创投数据库失败: ${dbPath}`, cause);
  } finally {
    db.close();
  }
}

/** 人工录入 upsert (可写连接 + 幂等建表; 事件可先于管道入库) */
export async function upsertDealEvent(event: DealEvent): Promise<void> {
  const dbPath = resolveVcDbPath();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (cause) {
    throw new VcDataError(`无法打开创投数据库 ${dbPath}`, cause);
  }
  try {
    for (const ddl of DDL) db.exec(ddl);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO deal_event (id, company, round, amount, currency, amount_usd, announced_at,
        sector, source, source_id, title, url, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.company,
      event.round,
      event.amount,
      event.currency,
      event.amountUsd,
      event.announcedAt,
      event.sector,
      event.source,
      event.sourceId,
      event.title,
      event.url,
      event.notes,
      now,
      now,
    );
  } catch (cause) {
    throw new VcDataError(`写入创投数据库失败: ${dbPath}`, cause);
  } finally {
    db.close();
  }
}

/** 同 URL 是否已存在 (人工录入 409 校验; 允许同链接多轮次强制确认后写入) */
export async function urlExists(url: string): Promise<boolean> {
  if (!url) return false;
  const dbPath = resolveVcDbPath();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return false; // 库不存在 → 无重复
  }
  try {
    const row = db.prepare("SELECT 1 FROM deal_event WHERE url = ? LIMIT 1").get(url);
    return row !== undefined;
  } finally {
    db.close();
  }
}
