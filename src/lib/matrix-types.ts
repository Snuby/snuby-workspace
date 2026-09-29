/** 自媒体账号矩阵 — 前后端共享类型 (无 Node 依赖) */

export type MatrixPlatform = {
  id: string;
  name: string;
  homeUrl: string;
  homeTitle: string;
  sort: number;
};

export type MatrixAccount = {
  id: string;
  platformId: string;
  displayName: string;
  partitionKey: string;
  sort: number;
  createdAt: number;
};

export type MatrixTab = { id: string; url: string; title: string };

export const MATRIX_HOME_SUFFIX = "::home";

export function homeTabIdOf(accountId: string): string {
  return `${accountId}${MATRIX_HOME_SUFFIX}`;
}

export function isHomeTabId(tabId: string): boolean {
  return tabId.endsWith(MATRIX_HOME_SUFFIX);
}

export function partitionKeyOf(platformId: string, accountId: string): string {
  return `persist:snuby-matrix:${platformId}:${accountId}`;
}
