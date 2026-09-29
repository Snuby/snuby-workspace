// 用户数据根: 使用过程中产生的数据 (库/主题/Agent), 与软件安装目录分离。
// 默认 ~/snuby-workspace-data; 可用 SNUBY_USER_DATA 覆盖。Electron 主进程启动时会设齐子路径 env。

import os from "node:os";
import path from "node:path";

/** 用户数据根目录 */
export const USER_DATA_ROOT =
  process.env.SNUBY_USER_DATA?.trim() || path.join(os.homedir(), "snuby-workspace-data");

/** 拼到用户数据根下的绝对路径 */
export function userDataPath(...segments: string[]): string {
  return path.join(USER_DATA_ROOT, ...segments);
}
