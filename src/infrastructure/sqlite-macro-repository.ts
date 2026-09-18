// Spec: 001-workbench-mvp — SQLite 只读仓储 (infrastructure 层, 不含业务规则)

import { DatabaseSync } from "node:sqlite";
import path from "path";
import type { Indicator, SeriesPoint } from "@/domain/macro";

export class MacroDataError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MacroDataError";
  }
}

type MetaRow = {
  indicator: string;
  name: string;
  unit: string;
  freq: string;
  dim: string;
  updated_at: string;
};

type SeriesRow = { date: string; value: number };

function resolveDbPath(): string {
  const dbPath = process.env.MACRO_DB_PATH ?? path.join(process.cwd(), "data", "china_economy.db");
  return path.resolve(dbPath);
}

export function readMetaUpdatedAt(db: DatabaseSync): string {
  const row = db.prepare("SELECT MAX(updated_at) AS t FROM meta").get() as { t: string | null };
  return row.t ?? new Date().toISOString();
}

export async function loadIndicators(): Promise<{
  indicators: Indicator[];
  updatedAt: string;
}> {
  const dbPath = resolveDbPath();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (cause) {
    throw new MacroDataError(
      `无法打开宏观数据库 ${dbPath}，请先运行 npm run fetch 初始化数据`,
      cause,
    );
  }

  try {
    const metaRows = db.prepare("SELECT * FROM meta").all() as unknown as MetaRow[];
    const seriesStmt = db.prepare(
      "SELECT date, value FROM series WHERE indicator = ? ORDER BY date ASC",
    );

    const indicators: Indicator[] = metaRows.map((meta) => {
      const rows = seriesStmt.all(meta.indicator) as unknown as SeriesRow[];
      const series: SeriesPoint[] = rows
        .filter((r) => Number.isFinite(r.value))
        .map((r) => ({ date: r.date, value: r.value }));
      return {
        key: meta.indicator,
        name: meta.name,
        unit: meta.unit,
        freq: meta.freq,
        group: meta.dim as Indicator["group"],
        description: "",
        series,
      };
    });

    return { indicators, updatedAt: readMetaUpdatedAt(db) };
  } catch (cause) {
    if (cause instanceof MacroDataError) throw cause;
    throw new MacroDataError(`读取宏观数据库失败: ${dbPath}`, cause);
  } finally {
    db.close();
  }
}
