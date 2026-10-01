// AgentRuntime 公共类型（spec 018）
// 会话与作品共用执行层时的契约；不含 ACP 协议细节。

export type TaskKind = "local-session" | "work";

/** 全局锁 / 连接池 / 逻辑 marker 统一键 */
export type TaskKey = `task:${TaskKind}:${string}`;

export type AlignReason =
  | "first_run"
  | "gateway_recreated"
  | "switched_task"
  | "convention_fp_changed"
  | "preload_failed_retry"
  | "same_task_continue";

export type WorkCollabScope = "draft" | "publish" | "resource";

export type WorkCapability =
  | "general"
  | "edit-draft"
  | "analyze-url"
  | "ingest-resource"
  | "resource-note"
  | "publish-prepare";

export type InjectMode = "prefix" | "standalone";

export type PreloadSegment = {
  id: string;
  layer: "L0" | "L1" | "L2";
  bytes: number;
  sha1: string;
  truncated?: boolean;
};

export type PreloadFacts = {
  workId?: string;
  currentDraftId?: string;
  contentPath?: string;
  draftDirty?: boolean;
  resourceCount?: number;
  artifactCount?: number;
  publishCount?: number;
  historyMessageCount?: number;
  scope?: WorkCollabScope;
  capability?: WorkCapability;
  resourceId?: string;
  pubId?: string;
  scopeChanged?: boolean;
};

export type PreloadBundle = {
  reason: AlignReason;
  full: boolean;
  suggestedMode: InjectMode;
  text: string;
  contentFp: string;
  conventionFp: string;
  segments: PreloadSegment[];
  workspaceRoot: string;
  facts?: PreloadFacts;
};

export type RunRequest = {
  taskKey: TaskKey;
  text: string;
  capability?: WorkCapability | string;
  /** 作品多历史轨道；会话侧可省略 */
  scope?: WorkCollabScope;
  resourceId?: string;
  pubId?: string;
  draftDirty?: boolean;
  /** 相对上一轮同 task 是否换了 scope（宿主可算好传入） */
  scopeChanged?: boolean;
  extras?: Record<string, unknown>;
  mode?: InjectMode;
  inactivityTimeoutMs?: number;
};

export type BindingPatch = {
  acpSessionId?: string | null;
  conventionFp?: string | null;
  preloadFailed?: boolean | null;
};

export type AlignSignals = {
  bindingMissing: boolean;
  gatewayRecreated: boolean;
  switchedTask: boolean;
  conventionChanged: boolean;
  preloadFailed: boolean;
  firstAlignMarker: boolean;
};
