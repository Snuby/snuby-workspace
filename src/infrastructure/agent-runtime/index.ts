// AgentRuntime 公共出口（spec 018 W0）
// 队列/连接仍由 workbuddy-acp 承载；本包先提供 TaskKey 与 Align 判定，供作品与后续回迁使用。

export type {
  TaskKind,
  TaskKey,
  AlignReason,
  AlignSignals,
  WorkCollabScope,
  WorkCapability,
  InjectMode,
  PreloadSegment,
  PreloadFacts,
  PreloadBundle,
  RunRequest,
  BindingPatch,
} from "./types";

export {
  formatTaskKey,
  parseTaskKey,
  isTaskKey,
  normalizeQueueKey,
  legacySessionIdOf,
  workIdOf,
} from "./keys";

export { resolveAlignReason, isFullPreload, needsHistorySnippet } from "./align-reason";
