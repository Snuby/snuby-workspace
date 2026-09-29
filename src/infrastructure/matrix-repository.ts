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

export type { MatrixAccount, MatrixPlatform, MatrixTab };
export { homeTabIdOf, isHomeTabId, MATRIX_HOME_SUFFIX, partitionKeyOf } from "@/lib/matrix-types";

const PLATFORM_SEED: MatrixPlatform[] = [
  {
    id: "weixin",
    name: "微信公众号",
    homeUrl: "https://mp.weixin.qq.com/",
    homeTitle: "公众号主页",
    sort: 0,
  },
  {
    id: "toutiao",
    name: "今日头条",
    homeUrl: "https://mp.toutiao.com/profile_v4/index",
    homeTitle: "头条创作主页",
    sort: 1,
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    homeUrl: "https://creator.xiaohongshu.com/",
    homeTitle: "小红书创作主页",
    sort: 2,
  },
];

/** 幂等写入出厂平台 (可被 getDb 启动路径调用) */
export function ensureMatrixPlatformsSeeded(dbArg?: DatabaseSync): void {
  const d = dbArg ?? getSiteTabsDb();
  const insert = d.prepare(
    "INSERT OR IGNORE INTO matrix_platforms (id, name, home_url, home_title, sort) VALUES (?, ?, ?, ?, ?)",
  );
  for (const p of PLATFORM_SEED) {
    insert.run(p.id, p.name, p.homeUrl, p.homeTitle, p.sort);
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
