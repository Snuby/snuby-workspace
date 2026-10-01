// AlignReason 判定（纯函数；spec 018 §5.4）

import type { AlignReason, AlignSignals } from "./types";

/**
 * 按优先级取单一 reason。
 * scopeChanged 不升格为 switched_task——由 needsHistorySnippet / 软隔离声明处理。
 */
export function resolveAlignReason(s: AlignSignals): AlignReason {
  if (s.gatewayRecreated) return "gateway_recreated";
  if (s.bindingMissing) return "first_run";
  if (s.switchedTask || s.firstAlignMarker) return "switched_task";
  if (s.conventionChanged) return "convention_fp_changed";
  if (s.preloadFailed) return "preload_failed_retry";
  return "same_task_continue";
}

export function isFullPreload(reason: AlignReason): boolean {
  return reason !== "same_task_continue";
}

/**
 * 方案 A：每轮都附当前 scope 历史摘录（含 same_task_continue），
 * 减轻同 ACP 多轨道串话；后续可按效果收紧为「仅 scopeChanged」。
 */
export function needsHistorySnippet(_reason: AlignReason, _scopeChanged: boolean): boolean {
  return true;
}
