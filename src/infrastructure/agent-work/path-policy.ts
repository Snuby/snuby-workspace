// path-policy：capability × 路径 × dirty（spec 018）

import path from "path";
import type { WorkCapability } from "@/infrastructure/agent-runtime";
import { workDirOf } from "./work-repository";

export type PathClass =
  | "PROTECTED"
  | "CURRENT_CONTENT"
  | "OTHER_DRAFT"
  | "RESOURCES_BLOB"
  | "RESOURCES_JSON"
  | "ARTIFACTS"
  | "PUBLISH"
  | "COLLAB"
  | "WORK_OTHER"
  | "OUTSIDE";

export type PolicyDecision = "allow" | "deny" | "ask";

function norm(p: string): string {
  return path.resolve(p);
}

export function classifyWorkPath(
  workId: string,
  absPath: string,
  currentDraftId: string,
): PathClass {
  const root = norm(workDirOf(workId));
  const target = norm(absPath);
  if (target !== root && !target.startsWith(root + path.sep)) return "OUTSIDE";

  const rel = target.slice(root.length).replace(/^[/\\]/, "").replace(/\\/g, "/");
  if (
    rel === "meta.json" ||
    rel === "context-state.json" ||
    rel === "drafts/drafts-branches.json" ||
    rel === "resources/resources.json"
  ) {
    return "PROTECTED";
  }
  if (rel.startsWith("collab/") || rel === "collab") return "COLLAB";
  if (rel === `drafts/${currentDraftId}/content.md`) return "CURRENT_CONTENT";
  if (rel.startsWith("drafts/") && (rel.endsWith("/content.md") || rel.endsWith("draft_meta.json"))) {
    return "OTHER_DRAFT";
  }
  if (rel === "resources/resources.json") return "RESOURCES_JSON";
  if (rel.startsWith("resources/")) return "RESOURCES_BLOB";
  if (rel.startsWith("artifacts/")) return "ARTIFACTS";
  if (rel.startsWith("publish/")) return "PUBLISH";
  return "WORK_OTHER";
}

export function decideWritePermission(opts: {
  workId: string;
  absPath: string;
  currentDraftId: string;
  capability: WorkCapability | string;
  draftDirty: boolean;
}): PolicyDecision {
  const cls = classifyWorkPath(opts.workId, opts.absPath, opts.currentDraftId);
  const cap = opts.capability || "general";

  if (cls === "OUTSIDE" || cls === "PROTECTED" || cls === "COLLAB" || cls === "RESOURCES_JSON") {
    return "deny";
  }
  if (cls === "OTHER_DRAFT" || cls === "WORK_OTHER") return "deny";

  if (cls === "CURRENT_CONTENT") {
    if (cap !== "edit-draft") return "deny";
    if (opts.draftDirty) return "deny";
    return "allow";
  }
  if (cls === "ARTIFACTS") return "allow";
  if (cls === "RESOURCES_BLOB") {
    return cap === "ingest-resource" ? "allow" : "deny";
  }
  if (cls === "PUBLISH") {
    return cap === "publish-prepare" ? "allow" : "deny";
  }
  return "deny";
}

/** 从工具 detail 粗提取路径（启发式） */
export function extractPathsFromDetail(detail: string, workRoot: string): string[] {
  const out: string[] = [];
  const root = norm(workRoot);
  // 绝对路径
  const absRe = /(?:^|[\s"'`])(\/[^\s"'`]+)/g;
  let m: RegExpExecArray | null;
  while ((m = absRe.exec(detail))) {
    out.push(m[1]);
  }
  // work 相对
  for (const prefix of ["drafts/", "resources/", "artifacts/", "publish/", "collab/", "meta.json"]) {
    if (detail.includes(prefix)) {
      const idx = detail.indexOf(prefix);
      const slice = detail.slice(idx).split(/[\s"'`]/)[0];
      if (slice) out.push(path.join(root, slice));
    }
  }
  return out;
}

const DESTRUCTIVE = /\b(rm|rmdir|mv|unlink)\b/i;

export function decideToolPermission(opts: {
  workId: string;
  currentDraftId: string;
  capability: WorkCapability | string;
  draftDirty: boolean;
  toolTitle: string;
  detail: string;
}): PolicyDecision {
  const root = workDirOf(opts.workId);
  const paths = extractPathsFromDetail(opts.detail || "", root);
  if (DESTRUCTIVE.test(opts.detail || "") || DESTRUCTIVE.test(opts.toolTitle || "")) {
    for (const p of paths) {
      const cls = classifyWorkPath(opts.workId, p, opts.currentDraftId);
      if (
        cls === "PROTECTED" ||
        cls === "COLLAB" ||
        cls === "CURRENT_CONTENT" ||
        cls === "OTHER_DRAFT" ||
        cls === "RESOURCES_BLOB" ||
        cls === "PUBLISH"
      ) {
        return "deny";
      }
    }
  }

  // Write/Edit 类：对提取到的路径逐个判定
  const writeish = /write|edit|create|save/i.test(opts.toolTitle || "");
  if (writeish && paths.length) {
    let anyDeny = false;
    let anyAsk = false;
    for (const p of paths) {
      const d = decideWritePermission({
        workId: opts.workId,
        absPath: p,
        currentDraftId: opts.currentDraftId,
        capability: opts.capability,
        draftDirty: opts.draftDirty,
      });
      if (d === "deny") anyDeny = true;
      if (d === "ask") anyAsk = true;
    }
    if (anyDeny) return "deny";
    if (anyAsk) return "ask";
    return "allow";
  }

  if (!paths.length && writeish) return "ask";
  return "allow";
}
