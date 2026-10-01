// TaskKey 格式化 / 解析 / 与旧 localSessionId 过渡（spec 018 E5）

import type { TaskKey, TaskKind } from "./types";

const TASK_RE = /^task:(local-session|work):(.+)$/;

export function formatTaskKey(kind: TaskKind, id: string): TaskKey {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("task id 不能为空");
  if (trimmed.includes(":")) throw new Error("task id 不能包含冒号");
  return `task:${kind}:${trimmed}`;
}

export function parseTaskKey(key: string): { kind: TaskKind; id: string } | null {
  const m = TASK_RE.exec(key);
  if (!m) return null;
  return { kind: m[1] as TaskKind, id: m[2] };
}

export function isTaskKey(key: string): key is TaskKey {
  return parseTaskKey(key) !== null;
}

/**
 * 队列 / 连接池 key 规范化。
 * - 已是 TaskKey → 原样
 * - 裸 id → 默认视为 local-session（017 兼容）
 */
export function normalizeQueueKey(key: string, fallbackKind: TaskKind = "local-session"): TaskKey {
  if (isTaskKey(key)) return key;
  return formatTaskKey(fallbackKind, key);
}

/** 从 TaskKey 或裸会话 id 取出 local-session 的 id；非会话 key 返回 null */
export function legacySessionIdOf(key: string): string | null {
  const parsed = parseTaskKey(key);
  if (parsed) return parsed.kind === "local-session" ? parsed.id : null;
  // 裸 id：历史调用方
  if (key && !key.includes(":")) return key;
  return null;
}

export function workIdOf(key: string): string | null {
  const parsed = parseTaskKey(key);
  if (parsed?.kind === "work") return parsed.id;
  return null;
}
