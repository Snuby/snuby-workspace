// Spec: 009-market-quotes — 行情 SQLite 只读仓储 (infrastructure 层, 不含业务规则)

import { DatabaseSync } from "node:sqlite";
import path from "path";
import type { AssetCategory, AssetMeta, Candle } from "@/domain/market";

export class MarketDataError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MarketDataError";
  }
}

type AssetRow = {
  symbol: string;
  name: string;
  category: string;
  unit: string;
  source: string;
  base_freq: string;
  precision: number;
  has_ohlc: number;
  has_volume: number;
  note: string | null;
  first_date: string | null;
  last_date: string | null;
  updated_at: string;
};

type KlineRow = {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export function resolveMarketDbPath(): string {
  const dbPath = process.env.MARKET_DB_PATH ?? path.join(process.cwd(), "data", "market.db");
  return path.resolve(dbPath);
}

function openReadOnly(): DatabaseSync {
  const dbPath = resolveMarketDbPath();
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (cause) {
    throw new MarketDataError(
      `无法打开行情数据库 ${dbPath}，请先运行 npm run fetch:market 初始化数据`,
      cause,
    );
  }
}

function assertInitialized(db: DatabaseSync): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("asset");
  if (!table) {
    throw new MarketDataError(
      `行情数据库尚未初始化（缺少 asset 表），请先运行 npm run fetch:market`,
    );
  }
}

/** 资产元信息 (按 symbol 排序, 展示顺序由 domain 的 ASSET_CATEGORIES 决定) */
export async function loadAssets(): Promise<{ assets: AssetMeta[]; updatedAt: string }> {
  const db = openReadOnly();
  try {
    assertInitialized(db);
    const rows = db.prepare("SELECT * FROM asset ORDER BY symbol ASC").all() as unknown as AssetRow[];
    if (rows.length === 0) {
      throw new MarketDataError("行情数据库为空，请先运行 npm run fetch:market 抓取数据");
    }
    const assets: AssetMeta[] = rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      category: r.category as AssetCategory,
      unit: r.unit,
      baseFreq: r.base_freq === "M" ? "M" : "D",
      precision: r.precision,
      hasOhlc: r.has_ohlc === 1,
      hasVolume: r.has_volume === 1,
      note: r.note,
      firstDate: r.first_date,
      lastDate: r.last_date,
      updatedAt: r.updated_at,
    }));
    const updatedAt = assets.reduce((max, a) => (a.updatedAt > max ? a.updatedAt : max), "");
    return { assets, updatedAt: updatedAt || new Date().toISOString() };
  } catch (cause) {
    if (cause instanceof MarketDataError) throw cause;
    throw new MarketDataError(`读取行情数据库失败：${resolveMarketDbPath()}`, cause);
  } finally {
    db.close();
  }
}

/** 单资产完整日频序列 (升序) */
export async function loadKline(symbol: string): Promise<Candle[]> {
  const batch = await loadKlineBatch([symbol]);
  return batch[symbol] ?? [];
}

/** 批量读取多个资产的日频序列 — 合并为一次 IN 查询 */
export async function loadKlineBatch(symbols: string[]): Promise<Record<string, Candle[]>> {
  const out: Record<string, Candle[]> = {};
  for (const s of symbols) out[s] = [];
  if (symbols.length === 0) return out;

  const db = openReadOnly();
  try {
    assertInitialized(db);
    const placeholders = symbols.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT symbol, date, open, high, low, close, volume FROM kline
         WHERE symbol IN (${placeholders}) ORDER BY symbol ASC, date ASC`,
      )
      .all(...symbols) as unknown as KlineRow[];

    for (const r of rows) {
      (out[r.symbol] ??= []).push({
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      });
    }
    return out;
  } catch (cause) {
    if (cause instanceof MarketDataError) throw cause;
    throw new MarketDataError(`读取行情 K 线失败：${resolveMarketDbPath()}`, cause);
  } finally {
    db.close();
  }
}
