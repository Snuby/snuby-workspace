// 用户数据根: 使用过程中产生的数据 (库/主题/Agent), 与软件安装目录分离。
// 默认 ~/snuby-workspace-data; 可用 SNUBY_USER_DATA 覆盖。Electron 主进程启动时会设齐子路径 env。
// 注意: 必须每次读取 env（勿在模块加载时冻死），否则 utilityProcess 继承时机会导致落盘路径漂移。

import os from "node:os";
import path from "node:path";

/** 当前用户数据根（惰性） */
export function getUserDataRoot(): string {
  return process.env.SNUBY_USER_DATA?.trim() || path.join(os.homedir(), "snuby-workspace-data");
}

/**
 * 兼容旧引用。注意：这是模块加载瞬间的快照；业务代码请用 getUserDataRoot() / userDataPath()。
 * Electron 主进程会在启动早期设好 SNUBY_USER_DATA，之后再加载 Next 子进程通常已正确。
 */
export const USER_DATA_ROOT = getUserDataRoot();

/** 拼到用户数据根下的绝对路径（惰性读 env） */
export function userDataPath(...segments: string[]): string {
  return path.join(getUserDataRoot(), ...segments);
}
