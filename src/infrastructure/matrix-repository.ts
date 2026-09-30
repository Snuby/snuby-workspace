// 自媒体账号矩阵 — SQLite 持久化 (与 site_tabs.db 同库)
// 账号 = 本地槽位; partition = persist:snuby-matrix:{platformId}:{accountId} (创建即定)

import type { DatabaseSync } from "node:sqlite";
import { getSiteTabsDb } from "@/infrastructure/site-tabs-repository";
import {
  homeTabIdOf,
  partitionKeyOf,
  type MatrixAccount,
  type MatrixPlatform,
  type MatrixTab,
} from "@/lib/matrix-types";
import {
  MATRIX_FACTORY_SEED_VERSION,
  MATRIX_PLATFORM_PRESETS,
} from "@/lib/matrix-presets";

export type { MatrixAccount, MatrixPlatform, MatrixTab };
export { homeTabIdOf, isHomeTabId, MATRIX_HOME_SUFFIX, partitionKeyOf } from "@/lib/matrix-types";

const PLATFORM_SEED = MATRIX_PLATFORM_PRESETS.filter((p) => p.factory);

function ensureAppMeta(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS matrix_app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getFactorySeedVersion(d: DatabaseSync): number {
  const row = d.prepare("SELECT value FROM matrix_app_meta WHERE key = 'factory_seed_version'").get() as
    | { value: string }
    | undefined;
  if (!row) return 0;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : 0;
}

function setFactorySeedVersion(d: DatabaseSync, version: number): void {
  d.prepare(
    `INSERT INTO matrix_app_meta (key, value) VALUES ('factory_seed_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(version));
}

/** 幂等写入出厂平台; 空表全量播种, 升版时增量补新出厂项 (不恢复用户已删的旧项) */
export function ensureMatrixPlatformsSeeded(dbArg?: DatabaseSync): void {
  const d = dbArg ?? getSiteTabsDb();
  ensureAppMeta(d);
  const insert = d.prepare(
    "INSERT OR IGNORE INTO matrix_platforms (id, name, home_url, home_title, sort) VALUES (?, ?, ?, ?, ?)",
  );
  const count = d.prepare("SELECT COUNT(*) AS n FROM matrix_platforms").get() as { n: number };
  let ver = getFactorySeedVersion(d);

  if (count.n === 0) {
    for (const p of PLATFORM_SEED) {
      insert.run(p.id, p.name, p.homeUrl, p.homeTitle, p.sort);
    }
    setFactorySeedVersion(d, MATRIX_FACTORY_SEED_VERSION);
    return;
  }

  // 已有数据但无版本标记 → 视为 v1 (微信/头条/小红书)
  if (ver === 0) {
    ver = 1;
    setFactorySeedVersion(d, 1);
  }

  if (ver < MATRIX_FACTORY_SEED_VERSION) {
    // v2: 补抖音; 之后升版在此按版本追加 INSERT OR IGNORE
    if (ver < 2) {
      const douyin = PLATFORM_SEED.find((p) => p.id === "douyin");
      if (douyin) insert.run(douyin.id, douyin.name, douyin.homeUrl, douyin.homeTitle, douyin.sort);
    }
    setFactorySeedVersion(d, MATRIX_FACTORY_SEED_VERSION);
  }
}

function db(): DatabaseSync {
  return getSiteTabsDb();
}

export function listMatrixPlatforms(): MatrixPlatform[] {
  ensureMatrixPlatformsSeeded();
  const rows = db()
    .prepare("SELECT id, name, home_url, home_title, sort FROM matrix_platforms ORDER BY sort ASC")
    .all() as Array<{ id: string; name: string; home_url: string; home_title: string; sort: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    homeUrl: r.home_url,
    homeTitle: r.home_title,
    sort: r.sort,
  }));
}

export function getMatrixPlatform(id: string): MatrixPlatform | null {
  ensureMatrixPlatformsSeeded();
  const r = db()
    .prepare("SELECT id, name, home_url, home_title, sort FROM matrix_platforms WHERE id = ?")
    .get(id) as
    | { id: string; name: string; home_url: string; home_title: string; sort: number }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    homeUrl: r.home_url,
    homeTitle: r.home_title,
    sort: r.sort,
  };
}

function normalizeHomeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function derivePlatformId(homeUrl: string): string {
  try {
    const host = new URL(homeUrl).hostname.replace(/^www\./, "").toLowerCase();
    const base = host.split(".")[0]?.replace(/[^a-z0-9-]/g, "") ?? "";
    if (base.length >= 2) return base;
  } catch {
    // fall through
  }
  return `m-${Date.now().toString(36)}`;
}

/** 新增自媒体矩阵平台 (如知乎); id 由主页域名推导, 冲突则加后缀 */
export function createMatrixPlatform(input: {
  name: string;
  homeUrl: string;
  homeTitle?: string;
}): MatrixPlatform {
  ensureMatrixPlatformsSeeded();
  const name = input.name.trim().slice(0, 64);
  if (!name) throw new Error("名称不能为空");
  const homeUrl = normalizeHomeUrl(input.homeUrl);
  if (!homeUrl) throw new Error("主页地址无效");
  const homeTitle = (input.homeTitle?.trim() || name).slice(0, 64);

  let id = derivePlatformId(homeUrl);
  if (getMatrixPlatform(id)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
  }

  const d = db();
  const maxSort = d.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM matrix_platforms").get() as {
    m: number;
  };
  d.prepare(
    "INSERT INTO matrix_platforms (id, name, home_url, home_title, sort) VALUES (?, ?, ?, ?, ?)",
  ).run(id, name, homeUrl, homeTitle, maxSort.m + 1);

  const created = getMatrixPlatform(id);
  if (!created) throw new Error("创建平台失败");
  // 新建平台默认带首个账号槽 + 主页标签
  addMatrixAccount(id);
  return created;
}

/** 更新矩阵平台名称 / 主页地址；同步各账号主标签 url */
export function updateMatrixPlatform(
  id: string,
  patch: { name?: string; homeUrl?: string; homeTitle?: string },
): MatrixPlatform {
  const existing = getMatrixPlatform(id);
  if (!existing) throw new Error("平台不存在");

  const name =
    patch.name !== undefined ? patch.name.trim().slice(0, 64) : existing.name;
  if (!name) throw new Error("名称不能为空");

  let homeUrl = existing.homeUrl;
  if (patch.homeUrl !== undefined) {
    const nextUrl = normalizeHomeUrl(patch.homeUrl);
    if (!nextUrl) throw new Error("主页地址无效");
    homeUrl = nextUrl;
  }

  const homeTitle =
    patch.homeTitle !== undefined
      ? (patch.homeTitle.trim().slice(0, 64) || name)
      : patch.name !== undefined && existing.homeTitle === existing.name
        ? name
        : existing.homeTitle;

  const d = db();
  d.prepare(
    "UPDATE matrix_platforms SET name = ?, home_url = ?, home_title = ? WHERE id = ?",
  ).run(name, homeUrl, homeTitle, id);

  // 各账号主页标签跟平台主页对齐
  const accounts = listMatrixAccounts(id);
  const upd = d.prepare(
    "UPDATE matrix_account_tabs SET url = ?, title = ? WHERE platform = ? AND account = ? AND tab_id = ?",
  );
  for (const acc of accounts) {
    upd.run(homeUrl, homeTitle, id, acc.id, homeTabIdOf(acc.id));
  }

  const next = getMatrixPlatform(id);
  if (!next) throw new Error("更新平台失败");
  return next;
}

/** @deprecated 使用 updateMatrixPlatform */
export function renameMatrixPlatform(id: string, name: string): MatrixPlatform | null {
  try {
    return updateMatrixPlatform(id, { name });
  } catch {
    return null;
  }
}

/**
 * 删除平台及下属全部账号/标签/状态。
 * 返回各账号 partitionKey, 由桌面端 clearPartition 清登录态。
 */
export function deleteMatrixPlatform(id: string): { partitionKeys: string[] } | null {
  const existing = getMatrixPlatform(id);
  if (!existing) return null;
  const accounts = listMatrixAccounts(id);
  const partitionKeys = accounts.map((a) => a.partitionKey);
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM matrix_account_tabs WHERE platform = ?").run(id);
    d.prepare("DELETE FROM matrix_accounts WHERE platform_id = ?").run(id);
    d.prepare("DELETE FROM matrix_platform_state WHERE platform_id = ?").run(id);
    d.prepare("DELETE FROM matrix_platforms WHERE id = ?").run(id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { partitionKeys };
}

export function listMatrixAccounts(platformId: string): MatrixAccount[] {
  const rows = db()
    .prepare(
      "SELECT id, platform_id, display_name, partition_key, sort, created_at FROM matrix_accounts WHERE platform_id = ? ORDER BY sort ASC, created_at ASC",
    )
    .all(platformId) as Array<{
    id: string;
    platform_id: string;
    display_name: string;
    partition_key: string;
    sort: number;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    platformId: r.platform_id,
    displayName: r.display_name,
    partitionKey: r.partition_key,
    sort: r.sort,
    createdAt: r.created_at,
  }));
}

export function getMatrixAccount(platformId: string, accountId: string): MatrixAccount | null {
  const r = db()
    .prepare(
      "SELECT id, platform_id, display_name, partition_key, sort, created_at FROM matrix_accounts WHERE id = ? AND platform_id = ?",
    )
    .get(accountId, platformId) as
    | {
        id: string;
        platform_id: string;
        display_name: string;
        partition_key: string;
        sort: number;
        created_at: number;
      }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    platformId: r.platform_id,
    displayName: r.display_name,
    partitionKey: r.partition_key,
    sort: r.sort,
    createdAt: r.created_at,
  };
}

export function addMatrixAccount(platformId: string, displayName?: string): MatrixAccount {
  const platform = getMatrixPlatform(platformId);
  if (!platform) throw new Error("平台不存在");
  const d = db();
  const id = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxSort = d
    .prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM matrix_accounts WHERE platform_id = ?")
    .get(platformId) as { m: number };
  const sort = maxSort.m + 1;
  const name = (displayName?.trim() || `账号 ${sort + 1}`).slice(0, 64);
  const partition = partitionKeyOf(platformId, id);
  const createdAt = Date.now();
  d.prepare(
    "INSERT INTO matrix_accounts (id, platform_id, display_name, partition_key, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, platformId, name, partition, sort, createdAt);
  // 主标签哨兵
  d.prepare(
    "INSERT INTO matrix_account_tabs (platform, account, tab_id, url, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(platformId, id, homeTabIdOf(id), platform.homeUrl, platform.homeTitle, createdAt);
  // 若尚无激活账号, 设为当前
  const st = d
    .prepare("SELECT active_account_id FROM matrix_platform_state WHERE platform_id = ?")
    .get(platformId) as { active_account_id: string | null } | undefined;
  if (!st) {
    d.prepare("INSERT INTO matrix_platform_state (platform_id, active_account_id) VALUES (?, ?)").run(
      platformId,
      id,
    );
  } else if (!st.active_account_id) {
    d.prepare("UPDATE matrix_platform_state SET active_account_id = ? WHERE platform_id = ?").run(
      id,
      platformId,
    );
  }
  return {
    id,
    platformId,
    displayName: name,
    partitionKey: partition,
    sort,
    createdAt,
  };
}

export function renameMatrixAccount(
  platformId: string,
  accountId: string,
  displayName: string,
): MatrixAccount | null {
  const name = displayName.trim().slice(0, 64);
  if (!name) return null;
  const d = db();
  const r = d
    .prepare("UPDATE matrix_accounts SET display_name = ? WHERE id = ? AND platform_id = ?")
    .run(name, accountId, platformId);
  if (r.changes === 0) return null;
  return getMatrixAccount(platformId, accountId);
}

/** 删除账号记录与标签; 返回 partitionKey 供调用方清 Electron session */
export function deleteMatrixAccount(
  platformId: string,
  accountId: string,
): { partitionKey: string } | null {
  const acc = getMatrixAccount(platformId, accountId);
  if (!acc) return null;
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM matrix_account_tabs WHERE platform = ? AND account = ?").run(
      platformId,
      accountId,
    );
    d.prepare("DELETE FROM matrix_accounts WHERE id = ? AND platform_id = ?").run(accountId, platformId);
    const st = d
      .prepare("SELECT active_account_id FROM matrix_platform_state WHERE platform_id = ?")
      .get(platformId) as { active_account_id: string | null } | undefined;
    if (st?.active_account_id === accountId) {
      const next = d
        .prepare(
          "SELECT id FROM matrix_accounts WHERE platform_id = ? ORDER BY sort ASC, created_at ASC LIMIT 1",
        )
        .get(platformId) as { id: string } | undefined;
      d.prepare("UPDATE matrix_platform_state SET active_account_id = ? WHERE platform_id = ?").run(
        next?.id ?? null,
        platformId,
      );
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { partitionKey: acc.partitionKey };
}

export function getActiveMatrixAccountId(platformId: string): string | null {
  const st = db()
    .prepare("SELECT active_account_id FROM matrix_platform_state WHERE platform_id = ?")
    .get(platformId) as { active_account_id: string | null } | undefined;
  return st?.active_account_id ?? null;
}

export function setActiveMatrixAccountId(platformId: string, accountId: string | null): void {
  const d = db();
  const st = d
    .prepare("SELECT platform_id FROM matrix_platform_state WHERE platform_id = ?")
    .get(platformId);
  if (st) {
    d.prepare("UPDATE matrix_platform_state SET active_account_id = ? WHERE platform_id = ?").run(
      accountId,
      platformId,
    );
  } else {
    d.prepare("INSERT INTO matrix_platform_state (platform_id, active_account_id) VALUES (?, ?)").run(
      platformId,
      accountId,
    );
  }
}

export function loadMatrixTabs(platformId: string, accountId: string): MatrixTab[] {
  const platform = getMatrixPlatform(platformId);
  const rows = db()
    .prepare(
      "SELECT tab_id, url, title, created_at FROM matrix_account_tabs WHERE platform = ? AND account = ? ORDER BY created_at ASC",
    )
    .all(platformId, accountId) as Array<{
    tab_id: string;
    url: string;
    title: string;
    created_at: number;
  }>;
  const tabs = rows.map((r) => ({ id: r.tab_id, url: r.url, title: r.title }));
  const homeId = homeTabIdOf(accountId);
  if (!tabs.some((t) => t.id === homeId) && platform) {
    tabs.unshift({ id: homeId, url: platform.homeUrl, title: platform.homeTitle });
  }
  return tabs;
}

export function saveMatrixTabs(platformId: string, accountId: string, tabs: MatrixTab[]): void {
  const platform = getMatrixPlatform(platformId);
  if (!platform) return;
  const homeId = homeTabIdOf(accountId);
  // 强制主标签在场
  let next = tabs.filter((t) => t.id && t.url);
  if (!next.some((t) => t.id === homeId)) {
    next = [{ id: homeId, url: platform.homeUrl, title: platform.homeTitle }, ...next];
  } else {
    next = next.map((t) =>
      t.id === homeId ? { ...t, url: platform.homeUrl, title: t.title || platform.homeTitle } : t,
    );
  }
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM matrix_account_tabs WHERE platform = ? AND account = ?").run(
      platformId,
      accountId,
    );
    const ins = d.prepare(
      "INSERT INTO matrix_account_tabs (platform, account, tab_id, url, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const now = Date.now();
    next.forEach((t, i) => {
      ins.run(platformId, accountId, t.id, t.url, t.title || "", now + i);
    });
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
