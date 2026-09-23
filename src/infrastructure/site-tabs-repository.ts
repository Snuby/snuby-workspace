// Spec: 017-site-tabs — 站内标签页/历史/配置的 SQLite 持久化 (infrastructure 层)
// 与 sqlite-macro-repository 同模式: node:sqlite DatabaseSync, 零原生依赖。
// 库文件 data/site_tabs.db (打包态: userData/data, 主进程 env SITE_TABS_DB_PATH)。
// 职责: 建表(幂等) + 每模块全量读取 + 站点组标签替换 + 历史追加裁剪 + 设置 upsert。

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export type SiteTabRow = { id: string; url: string; title: string };
export type SiteHistoryRow = { url: string; title: string; closedAt: number };
export type SiteSettings = {
  maxTabs: number;
  maxHistory: number;
  activeSite?: string | null;
  /** 全局 WebView 保留策略 (存 module=webview 行, 其他模块行为 null 表示沿用库内值) */
  webviewMinKeep?: number | null;
  webviewRetentionHours?: number | null;
};

const DEFAULT_SETTINGS: SiteSettings = {
  maxTabs: 10,
  maxHistory: 100,
  activeSite: null,
  webviewMinKeep: 5,
  webviewRetentionHours: 3,
};

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath =
    process.env.SITE_TABS_DB_PATH ?? path.join(process.cwd(), "data", "site_tabs.db");
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_tabs (
      module     TEXT NOT NULL,
      site       TEXT NOT NULL,
      tab_id     TEXT NOT NULL,
      url        TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (module, site, tab_id)
    );
    CREATE TABLE IF NOT EXISTS site_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      module    TEXT NOT NULL,
      site      TEXT NOT NULL,
      url       TEXT NOT NULL,
      title     TEXT NOT NULL DEFAULT '',
      closed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_site_history ON site_history (module, site, closed_at DESC);
    CREATE TABLE IF NOT EXISTS site_settings (
      module      TEXT PRIMARY KEY,
      max_tabs    INTEGER NOT NULL DEFAULT 10,
      max_history INTEGER NOT NULL DEFAULT 100,
      active_site TEXT,
      webview_min_keep          INTEGER NOT NULL DEFAULT 5,
      webview_retention_hours   INTEGER NOT NULL DEFAULT 3
    );
  `);
  // 兼容旧库: 若缺 active_site 列则补 (PRAGMA 检查, 不依赖 ALTER ... IF NOT EXISTS 版本支持)
  const cols = db.prepare("PRAGMA table_info(site_settings)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "active_site")) {
    db.exec("ALTER TABLE site_settings ADD COLUMN active_site TEXT");
  }
  if (!cols.some((c) => c.name === "webview_min_keep")) {
    db.exec("ALTER TABLE site_settings ADD COLUMN webview_min_keep INTEGER NOT NULL DEFAULT 5");
  }
  if (!cols.some((c) => c.name === "webview_retention_hours")) {
    db.exec("ALTER TABLE site_settings ADD COLUMN webview_retention_hours INTEGER NOT NULL DEFAULT 3");
  }
  return db;
}

/** 读取模块设置, 无记录则落默认值并返回 */
export function getSettings(module: string): SiteSettings {
  const row = getDb()
    .prepare(
      "SELECT max_tabs, max_history, active_site, webview_min_keep, webview_retention_hours FROM site_settings WHERE module = ?",
    )
    .get(module) as
    | {
        max_tabs: number;
        max_history: number;
        active_site: string | null;
        webview_min_keep: number;
        webview_retention_hours: number;
      }
    | undefined;
  if (!row) {
    setSettings(module, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return {
    maxTabs: row.max_tabs,
    maxHistory: row.max_history,
    activeSite: row.active_site,
    webviewMinKeep: row.webview_min_keep,
    webviewRetentionHours: row.webview_retention_hours,
  };
}

export function setSettings(module: string, s: SiteSettings): void {
  // webview 保留策略是全局配置 (module=webview 行): 其他模块保存设置时未显式传入,
  // 必须保留库内已有值, 不得被默认值覆盖
  const existing = getDb()
    .prepare("SELECT webview_min_keep, webview_retention_hours FROM site_settings WHERE module = ?")
    .get(module) as { webview_min_keep: number; webview_retention_hours: number } | undefined;
  const minKeep = s.webviewMinKeep ?? existing?.webview_min_keep ?? 5;
  const retention = s.webviewRetentionHours ?? existing?.webview_retention_hours ?? 3;
  getDb()
    .prepare(
      `INSERT INTO site_settings (module, max_tabs, max_history, active_site, webview_min_keep, webview_retention_hours)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(module) DO UPDATE SET
         max_tabs = excluded.max_tabs,
         max_history = excluded.max_history,
         active_site = excluded.active_site,
         webview_min_keep = excluded.webview_min_keep,
         webview_retention_hours = excluded.webview_retention_hours`,
    )
    .run(module, s.maxTabs, s.maxHistory, s.activeSite ?? null, minKeep, retention);
}

/** 读取某模块全部站点组的标签与历史 */
export function loadModule(
  module: string,
): { tabs: Record<string, SiteTabRow[]>; history: Record<string, SiteHistoryRow[]> } {
  const d = getDb();
  const tabRows = d
    .prepare("SELECT site, tab_id, url, title FROM site_tabs WHERE module = ? ORDER BY created_at ASC")
    .all(module) as Array<{ site: string; tab_id: string; url: string; title: string }>;
  const historyRows = d
    .prepare("SELECT site, url, title, closed_at FROM site_history WHERE module = ? ORDER BY closed_at ASC")
    .all(module) as Array<{ site: string; url: string; title: string; closed_at: number }>;

  const tabs: Record<string, SiteTabRow[]> = {};
  const history: Record<string, SiteHistoryRow[]> = {};
  for (const r of tabRows) {
    (tabs[r.site] ??= []).push({ id: r.tab_id, url: r.url, title: r.title });
  }
  for (const r of historyRows) {
    (history[r.site] ??= []).push({ url: r.url, title: r.title, closedAt: r.closed_at });
  }
  return { tabs, history };
}

/** 替换某站点组全部标签 (home 标签由客户端派生, 不落库); 空组即清空 */
export function saveTabs(module: string, site: string, tabs: SiteTabRow[]): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM site_tabs WHERE module = ? AND site = ?").run(module, site);
    const ins = d.prepare(
      "INSERT INTO site_tabs (module, site, tab_id, url, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const now = Date.now();
    for (const t of tabs) {
      ins.run(module, site, t.id, t.url, t.title ?? "", now);
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/** 追加历史条目并裁剪到模块上限 (保留最新 max_history 条) */
export function appendHistory(module: string, site: string, entries: SiteHistoryRow[]): void {
  if (entries.length === 0) return;
  const d = getDb();
  d.exec("BEGIN");
  try {
    const ins = d.prepare(
      "INSERT INTO site_history (module, site, url, title, closed_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const e of entries) {
      ins.run(module, site, e.url, e.title ?? "", e.closedAt);
    }
    const { maxHistory } = getSettings(module);
    d.prepare(
      `DELETE FROM site_history WHERE module = ? AND site = ? AND id NOT IN (
         SELECT id FROM site_history WHERE module = ? AND site = ? ORDER BY closed_at DESC, id DESC LIMIT ?
       )`,
    ).run(module, site, module, site, maxHistory);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/** 按模块设置裁剪某站点组标签 (超 maxTabs 删最旧; 配置改小后立即生效) */
export function trimTabs(module: string, site: string): void {
  const { maxTabs } = getSettings(module);
  const d = getDb();
  d.prepare(
    `DELETE FROM site_tabs WHERE module = ? AND site = ? AND tab_id NOT IN (
       SELECT tab_id FROM site_tabs WHERE module = ? AND site = ? ORDER BY created_at ASC LIMIT ?
     )`,
  ).run(module, site, module, site, maxTabs);
}
