// Spec: 017-site-tabs — 站内标签页/历史/配置的 SQLite 持久化 (infrastructure 层)
// node:sqlite DatabaseSync, 零原生依赖。
// 库文件默认 ~/snuby-workspace-data/site_tabs.db (SITE_TABS_DB_PATH / SNUBY_USER_DATA 可覆盖)。
// 职责: 建表(幂等) + 每模块全量读取 + 站点组标签替换 + 历史追加裁剪 + 设置 upsert。

import { DatabaseSync } from "node:sqlite";
import { userDataPath } from "@/infrastructure/user-data-paths";

export type SiteTabRow = { id: string; url: string; title: string };
export type SiteHistoryRow = { url: string; title: string; closedAt: number };
export type SiteSettings = {
  maxTabs: number;
  maxHistory: number;
  activeSite?: string | null;
  /** 全局 WebView 保留策略 (存 module=webview 行, 其他模块行为 null 表示沿用库内值) */
  webviewMinKeep?: number | null;
  webviewRetentionHours?: number | null;
  /** Web 访问等地址栏模式的主页 URL */
  homeUrl?: string | null;
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
  const dbPath = process.env.SITE_TABS_DB_PATH ?? userDataPath("site_tabs.db");
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
    CREATE TABLE IF NOT EXISTS topics (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort       INTEGER NOT NULL DEFAULT 0,
      is_preset  INTEGER NOT NULL DEFAULT 0,
      settings   TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sites (
      id         TEXT PRIMARY KEY,
      topic_id   TEXT NOT NULL,
      url        TEXT NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sites_topic ON sites (topic_id, sort);
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
  if (!cols.some((c) => c.name === "home_url")) {
    db.exec("ALTER TABLE site_settings ADD COLUMN home_url TEXT");
  }
  // 出厂主题幂等种子 (首次打开库时写入; 之后 topics 非空即跳过)
  ensureTopicsSeeded(db);
  // 自媒体账号矩阵表 + 平台种子 (同库, 避免循环依赖不调 matrix-repository)
  ensureMatrixSchema(db);
  return db;
}

/** 供其它 repository 复用同一 SQLite 连接 (同进程单例) */
export function getSiteTabsDb(): DatabaseSync {
  return getDb();
}

function ensureMatrixSchema(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS matrix_platforms (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      home_url   TEXT NOT NULL,
      home_title TEXT NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS matrix_accounts (
      id            TEXT PRIMARY KEY,
      platform_id   TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      partition_key TEXT NOT NULL UNIQUE,
      sort          INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_matrix_accounts_platform ON matrix_accounts (platform_id, sort);
    CREATE TABLE IF NOT EXISTS matrix_account_tabs (
      platform   TEXT NOT NULL,
      account    TEXT NOT NULL,
      tab_id     TEXT NOT NULL,
      url        TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (platform, account, tab_id)
    );
    CREATE TABLE IF NOT EXISTS matrix_platform_state (
      platform_id       TEXT PRIMARY KEY,
      active_account_id TEXT
    );
  `);
  const seed = d.prepare(
    "INSERT OR IGNORE INTO matrix_platforms (id, name, home_url, home_title, sort) VALUES (?, ?, ?, ?, ?)",
  );
  seed.run("weixin", "微信公众号", "https://mp.weixin.qq.com/", "公众号主页", 0);
  seed.run("toutiao", "今日头条", "https://mp.toutiao.com/profile_v4/index", "头条创作主页", 1);
  seed.run("xiaohongshu", "小红书", "https://creator.xiaohongshu.com/", "小红书创作主页", 2);
}

/** 读取模块设置, 无记录则落默认值并返回 */
export function getSettings(module: string): SiteSettings {
  const row = getDb()
    .prepare(
      "SELECT max_tabs, max_history, active_site, webview_min_keep, webview_retention_hours, home_url FROM site_settings WHERE module = ?",
    )
    .get(module) as
    | {
        max_tabs: number;
        max_history: number;
        active_site: string | null;
        webview_min_keep: number;
        webview_retention_hours: number;
        home_url: string | null;
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
    homeUrl: row.home_url,
  };
}

export function setSettings(module: string, s: SiteSettings): void {
  // webview 保留策略是全局配置 (module=webview 行): 其他模块保存设置时未显式传入,
  // 必须保留库内已有值, 不得被默认值覆盖
  const existing = getDb()
    .prepare(
      "SELECT webview_min_keep, webview_retention_hours, home_url FROM site_settings WHERE module = ?",
    )
    .get(module) as
    | { webview_min_keep: number; webview_retention_hours: number; home_url: string | null }
    | undefined;
  const minKeep = s.webviewMinKeep ?? existing?.webview_min_keep ?? 5;
  const retention = s.webviewRetentionHours ?? existing?.webview_retention_hours ?? 3;
  const homeUrl =
    s.homeUrl !== undefined ? s.homeUrl : (existing?.home_url ?? null);
  getDb()
    .prepare(
      `INSERT INTO site_settings (module, max_tabs, max_history, active_site, webview_min_keep, webview_retention_hours, home_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(module) DO UPDATE SET
         max_tabs = excluded.max_tabs,
         max_history = excluded.max_history,
         active_site = excluded.active_site,
         webview_min_keep = excluded.webview_min_keep,
         webview_retention_hours = excluded.webview_retention_hours,
         home_url = excluded.home_url`,
    )
    .run(module, s.maxTabs, s.maxHistory, s.activeSite ?? null, minKeep, retention, homeUrl);
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


// ============================================================
// Topic / Site 配置层 (灵活工作台: 主题=模块, 站点=选项卡)
// 出厂 topic 的 id 与历史 moduleKey 一致 (it-news/creators/leaderboard),
// 因此 site_tabs / site_history / site_settings 的 module 字段语义
// 直接复用为 topic id, 存量数据零迁移。
// ============================================================

export type TopicRow = {
  id: string;
  name: string;
  sort: number;
  isPreset: boolean;
  settings: Record<string, unknown>;
  createdAt: number;
};

export type SiteRow = {
  id: string;
  topicId: string;
  url: string;
  label: string;
  sort: number;
  createdAt: number;
};

/** 出厂主题 (系统预设, 可配置化: 用户可增删站点/改名/删除) */
const PRESET_TOPICS: { id: string; name: string; sites: { url: string; label: string }[] }[] = [
  {
    id: "it-news",
    name: "IT 资讯",
    sites: [
      { url: "https://www.theverge.com/", label: "The Verge" },
      { url: "https://arstechnica.com/", label: "Ars Technica" },
      { url: "https://www.technologyreview.com/", label: "MIT Technology Review" },
      { url: "https://www.qbitai.com/", label: "量子位" },
      { url: "https://aiera.com.cn/", label: "新智元" },
      { url: "https://www.jiqizhixin.com/", label: "机器之心" },
      { url: "https://www.infoq.cn/", label: "InfoQ 中文" },
    ],
  },
  {
    id: "creators",
    name: "自媒体",
    sites: [
      { url: "https://creator.xiaohongshu.com/", label: "小红书创作中心" },
      { url: "https://mp.weixin.qq.com/", label: "微信公众号后台" },
    ],
  },
  {
    id: "leaderboard",
    name: "AI 模型榜单",
    sites: [
      { url: "https://artificialanalysis.ai/", label: "Artificial Analysis" },
      { url: "https://openrouter.ai/rankings", label: "OpenRouter 排名" },
    ],
  },
];

/** 幂等种子: topics 表为空时写入出厂主题与站点 (启动时调用一次; 可传 db 避免 getDb 递归) */
export function ensureTopicsSeeded(dbArg?: DatabaseSync): void {
  const d = dbArg ?? getDb();
  const count = d.prepare("SELECT COUNT(*) AS n FROM topics").get() as { n: number };
  if (count.n > 0) return;
  d.exec("BEGIN");
  try {
    const now = Date.now();
    const insTopic = d.prepare(
      "INSERT INTO topics (id, name, sort, is_preset, settings, created_at) VALUES (?, ?, ?, 1, '{}', ?)",
    );
    const insSite = d.prepare(
      "INSERT INTO sites (id, topic_id, url, label, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    PRESET_TOPICS.forEach((t, ti) => {
      insTopic.run(t.id, t.name, ti, now);
      t.sites.forEach((site, si) => {
        insSite.run(`${t.id}-${si}`, t.id, site.url, site.label, si, now);
      });
    });
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

function rowToTopic(r: {
  id: string;
  name: string;
  sort: number;
  is_preset: number;
  settings: string;
  created_at: number;
}): TopicRow {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(r.settings) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  return {
    id: r.id,
    name: r.name,
    sort: r.sort,
    isPreset: r.is_preset === 1,
    settings,
    createdAt: r.created_at,
  };
}

export function listTopics(): TopicRow[] {
  const rows = getDb()
    .prepare("SELECT id, name, sort, is_preset, settings, created_at FROM topics ORDER BY sort ASC, created_at ASC")
    .all() as Array<{ id: string; name: string; sort: number; is_preset: number; settings: string; created_at: number }>;
  return rows.map(rowToTopic);
}

export function getTopic(id: string): TopicRow | null {
  const r = getDb()
    .prepare("SELECT id, name, sort, is_preset, settings, created_at FROM topics WHERE id = ?")
    .get(id) as { id: string; name: string; sort: number; is_preset: number; settings: string; created_at: number } | undefined;
  return r ? rowToTopic(r) : null;
}

/** 创建主题, 返回新 id (t-<时间戳>); sort 追加到末尾 */
export function createTopic(name: string): string {
  const d = getDb();
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxSort = d.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM topics").get() as { m: number };
  d.prepare("INSERT INTO topics (id, name, sort, is_preset, settings, created_at) VALUES (?, ?, ?, 0, '{}', ?)")
    .run(id, name, maxSort.m + 1, Date.now());
  return id;
}

export function renameTopic(id: string, name: string): void {
  getDb().prepare("UPDATE topics SET name = ? WHERE id = ?").run(name, id);
}

/** 更新主题设置 (JSON settings 整体替换; 传 null 保留旧值) */
export function updateTopicSettings(id: string, settings: Record<string, unknown> | null): void {
  const existing = getTopic(id);
  if (!existing) return;
  const next = settings ?? existing.settings;
  getDb().prepare("UPDATE topics SET settings = ? WHERE id = ?").run(JSON.stringify(next), id);
}

/** 删除主题: 级联删 sites + site_tabs / site_history / site_settings (module 字段 = topic id) */
export function deleteTopic(id: string): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM sites WHERE topic_id = ?").run(id);
    d.prepare("DELETE FROM site_tabs WHERE module = ?").run(id);
    d.prepare("DELETE FROM site_history WHERE module = ?").run(id);
    d.prepare("DELETE FROM site_settings WHERE module = ?").run(id);
    d.prepare("DELETE FROM topics WHERE id = ?").run(id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function listSites(topicId: string): SiteRow[] {
  const rows = getDb()
    .prepare("SELECT id, topic_id, url, label, sort, created_at FROM sites WHERE topic_id = ? ORDER BY sort ASC, created_at ASC")
    .all(topicId) as Array<{ id: string; topic_id: string; url: string; label: string; sort: number; created_at: number }>;
  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    url: r.url,
    label: r.label,
    sort: r.sort,
    createdAt: r.created_at,
  }));
}

/** 添加站点, 返回新 id (s-<时间戳>); sort 追加到末尾 */
export function addSite(topicId: string, url: string, label: string): string {
  const d = getDb();
  const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxSort = d.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM sites WHERE topic_id = ?").get(topicId) as { m: number };
  d.prepare("INSERT INTO sites (id, topic_id, url, label, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, topicId, url, label || url, maxSort.m + 1, Date.now());
  return id;
}

export function removeSite(topicId: string, siteId: string): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM sites WHERE id = ? AND topic_id = ?").run(siteId, topicId);
    // 级联清理该站点的标签与历史 (module=主题, site=站点id)
    d.prepare("DELETE FROM site_tabs WHERE module = ? AND site = ?").run(topicId, siteId);
    d.prepare("DELETE FROM site_history WHERE module = ? AND site = ?").run(topicId, siteId);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/** 更新站点名称/地址; 至少提供一项。返回是否命中行。 */
export function updateSite(
  topicId: string,
  siteId: string,
  patch: { url?: string; label?: string },
): boolean {
  const d = getDb();
  const row = d
    .prepare("SELECT url, label FROM sites WHERE id = ? AND topic_id = ?")
    .get(siteId, topicId) as { url: string; label: string } | undefined;
  if (!row) return false;
  const url = patch.url !== undefined ? patch.url.trim() : row.url;
  const label = patch.label !== undefined ? patch.label.trim() || url : row.label;
  if (!url) return false;
  d.prepare("UPDATE sites SET url = ?, label = ? WHERE id = ? AND topic_id = ?").run(
    url,
    label,
    siteId,
    topicId,
  );
  return true;
}

/** 重排站点: orderedIds 为新的 id 顺序, 按数组下标重写 sort */
export function reorderSites(topicId: string, orderedIds: string[]): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const upd = d.prepare("UPDATE sites SET sort = ? WHERE id = ? AND topic_id = ?");
    orderedIds.forEach((id, i) => upd.run(i, id, topicId));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
