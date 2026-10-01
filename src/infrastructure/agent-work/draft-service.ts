// DraftService：保存 / checkout / 分支图（spec 018）

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  getWork,
  workDirOf,
  writeWorkMeta,
  contentPathOf,
} from "./work-repository";

export type DraftMeta = {
  id: string;
  parentId: string | null;
  createdAt: number;
  source: "manual" | "restore";
  label?: string;
  charCount?: number;
};

export type DraftBranchNode = {
  id: string;
  parentId: string | null;
  createdAt: number;
  label?: string;
};

export type DraftBranches = {
  version: 1;
  nodes: DraftBranchNode[];
  currentId: string;
};

export type DraftBaseline = {
  draftId: string;
  contentSha1: string;
  mtimeMs?: number;
};

function atomicWrite(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
}

function atomicWriteJson(filePath: string, data: unknown): void {
  atomicWrite(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function newDraftId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeContent(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sha1Of(text: string): string {
  return createHash("sha1").update(normalizeContent(text), "utf8").digest("hex");
}

function branchesPath(workId: string): string {
  return path.join(workDirOf(workId), "drafts", "drafts-branches.json");
}

export function readBranches(workId: string): DraftBranches | null {
  const p = branchesPath(workId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DraftBranches;
  } catch {
    return null;
  }
}

export function readDraftMeta(workId: string, draftId: string): DraftMeta | null {
  const p = path.join(workDirOf(workId), "drafts", draftId, "draft_meta.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DraftMeta;
  } catch {
    return null;
  }
}

export function readDraftContent(workId: string, draftId: string): string | null {
  const p = contentPathOf(workId, draftId);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

export function getCurrentDraft(workId: string): {
  draftId: string;
  content: string;
  meta: DraftMeta | null;
  contentSha1: string;
} | null {
  const work = getWork(workId);
  if (!work) return null;
  const content = readDraftContent(workId, work.currentDraftId) ?? "";
  return {
    draftId: work.currentDraftId,
    content,
    meta: readDraftMeta(workId, work.currentDraftId),
    contentSha1: sha1Of(content),
  };
}

/** meta 权威；branches.currentId 不一致时回写 */
export function repairPointers(workId: string): void {
  const work = getWork(workId);
  if (!work) return;
  const branches = readBranches(workId);
  if (!branches) return;
  if (branches.currentId !== work.currentDraftId) {
    branches.currentId = work.currentDraftId;
    if (!branches.nodes.some((n) => n.id === work.currentDraftId)) {
      branches.nodes.push({
        id: work.currentDraftId,
        parentId: null,
        createdAt: Date.now(),
        label: "修复",
      });
    }
    atomicWriteJson(branchesPath(workId), branches);
  }
}

export type SaveDraftResult =
  | { ok: true; unchanged: true; draftId: string; contentSha1: string }
  | {
      ok: true;
      unchanged: false;
      draftId: string;
      parentId: string;
      contentSha1: string;
    }
  | { ok: false; code: "not_found" | "draft_conflict" | "draft_pointer_changed"; message: string; diskSha1?: string };

export function saveDraft(
  workId: string,
  content: string,
  baseline?: DraftBaseline,
): SaveDraftResult {
  const work = getWork(workId);
  if (!work) return { ok: false, code: "not_found", message: "作品不存在" };

  if (baseline && baseline.draftId !== work.currentDraftId) {
    return { ok: false, code: "draft_pointer_changed", message: "当前稿件已切换" };
  }

  const disk = readDraftContent(workId, work.currentDraftId) ?? "";
  const diskSha1 = sha1Of(disk);
  if (baseline && baseline.contentSha1 !== diskSha1) {
    return {
      ok: false,
      code: "draft_conflict",
      message: "磁盘内容相对打开时已变化",
      diskSha1,
    };
  }

  const next = normalizeContent(content);
  const nextSha1 = sha1Of(next);
  if (nextSha1 === diskSha1) {
    return { ok: true, unchanged: true, draftId: work.currentDraftId, contentSha1: diskSha1 };
  }

  const parentId = work.currentDraftId;
  const draftId = newDraftId();
  const dir = path.join(workDirOf(workId), "drafts", draftId);
  mkdirSync(dir, { recursive: true });
  atomicWrite(path.join(dir, "content.md"), next);
  const draftMeta: DraftMeta = {
    id: draftId,
    parentId,
    createdAt: Date.now(),
    source: "manual",
    label: "手动保存",
    charCount: next.length,
  };
  atomicWriteJson(path.join(dir, "draft_meta.json"), draftMeta);

  const branches = readBranches(workId) ?? {
    version: 1 as const,
    nodes: [],
    currentId: parentId,
  };
  branches.nodes.push({
    id: draftId,
    parentId,
    createdAt: draftMeta.createdAt,
    label: draftMeta.label,
  });
  branches.currentId = draftId;
  atomicWriteJson(branchesPath(workId), branches);

  work.currentDraftId = draftId;
  writeWorkMeta(work);

  return { ok: true, unchanged: false, draftId, parentId, contentSha1: nextSha1 };
}

export type CheckoutResult =
  | { ok: true; draftId: string; contentSha1: string }
  | { ok: false; code: "not_found" | "draft_missing"; message: string };

export function checkoutDraft(workId: string, draftId: string): CheckoutResult {
  const work = getWork(workId);
  if (!work) return { ok: false, code: "not_found", message: "作品不存在" };
  const content = readDraftContent(workId, draftId);
  if (content === null) return { ok: false, code: "draft_missing", message: "稿件版本不存在" };

  const branches = readBranches(workId);
  if (!branches || !branches.nodes.some((n) => n.id === draftId)) {
    return { ok: false, code: "draft_missing", message: "版本图中无此节点" };
  }

  branches.currentId = draftId;
  atomicWriteJson(branchesPath(workId), branches);
  work.currentDraftId = draftId;
  writeWorkMeta(work);

  return { ok: true, draftId, contentSha1: sha1Of(content) };
}

/**
 * Agent 直接改写了当前 content.md 后：若相对 before 有 diff，
 * 先把旧正文写回当前 draft 目录，再新建子版本承载新正文（parent=旧 current）。
 */
export function checkpointDiskIfChanged(
  workId: string,
  beforeSha1: string,
  beforeContent: string,
  label = "AI 修订",
): SaveDraftResult {
  const work = getWork(workId);
  if (!work) return { ok: false, code: "not_found", message: "作品不存在" };
  const disk = readDraftContent(workId, work.currentDraftId) ?? "";
  const diskSha1 = sha1Of(disk);
  if (diskSha1 === beforeSha1) {
    return { ok: true, unchanged: true, draftId: work.currentDraftId, contentSha1: diskSha1 };
  }

  const parentId = work.currentDraftId;
  // 恢复被 Agent 覆盖的父版本正文
  atomicWrite(contentPathOf(workId, parentId), normalizeContent(beforeContent));

  const draftId = newDraftId();
  const dir = path.join(workDirOf(workId), "drafts", draftId);
  mkdirSync(dir, { recursive: true });
  atomicWrite(path.join(dir, "content.md"), normalizeContent(disk));
  const draftMeta: DraftMeta = {
    id: draftId,
    parentId,
    createdAt: Date.now(),
    source: "restore",
    label,
    charCount: disk.length,
  };
  atomicWriteJson(path.join(dir, "draft_meta.json"), draftMeta);

  const branches = readBranches(workId) ?? {
    version: 1 as const,
    nodes: [],
    currentId: parentId,
  };
  branches.nodes.push({
    id: draftId,
    parentId,
    createdAt: draftMeta.createdAt,
    label,
  });
  branches.currentId = draftId;
  atomicWriteJson(branchesPath(workId), branches);
  work.currentDraftId = draftId;
  writeWorkMeta(work);

  return { ok: true, unchanged: false, draftId, parentId, contentSha1: diskSha1 };
}
