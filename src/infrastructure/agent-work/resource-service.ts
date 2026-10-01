// ResourceService：白名单 + revision CAS（spec 018）

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { workDirOf } from "./work-repository";
import { removeCollabResourceMessages } from "./collab-messages";

export type ResourceKind = "url" | "document" | "media";

export type ResourceItem = {
  id: string;
  name: string;
  kind: ResourceKind;
  url?: string | null;
  relativePath?: string | null;
  mime?: string | null;
  size?: number | null;
  note?: string;
  noteUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type ResourcesFile = {
  version: 1;
  revision: number;
  items: ResourceItem[];
};

const TEXT_EXT = new Set([".md", ".txt", ".markdown"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function resourcesDir(workId: string): string {
  return path.join(workDirOf(workId), "resources");
}

function resourcesJsonPath(workId: string): string {
  return path.join(resourcesDir(workId), "resources.json");
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

export function readResources(workId: string): ResourcesFile {
  const p = resourcesJsonPath(workId);
  if (!existsSync(p)) return { version: 1, revision: 0, items: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as ResourcesFile;
    return {
      version: 1,
      revision: typeof raw.revision === "number" ? raw.revision : 0,
      items: Array.isArray(raw.items) ? raw.items : [],
    };
  } catch {
    return { version: 1, revision: 0, items: [] };
  }
}

function writeResources(workId: string, file: ResourcesFile): void {
  atomicWriteJson(resourcesJsonPath(workId), file);
}

function newResourceId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function classifyByExt(filename: string): ResourceKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXT.has(ext)) return "document";
  if (IMAGE_EXT.has(ext)) return "media";
  return null;
}

export type ResourceWriteResult =
  | { ok: true; file: ResourcesFile; item: ResourceItem }
  | { ok: false; code: "not_found" | "resource_conflict" | "resource_type_unsupported" | "bad_request"; message: string };

function checkRevision(file: ResourcesFile, baseRevision?: number): ResourceWriteResult | null {
  if (baseRevision !== undefined && baseRevision !== file.revision) {
    return { ok: false, code: "resource_conflict", message: "resources revision 冲突" };
  }
  return null;
}

export function addUrlResource(
  workId: string,
  input: { name: string; url: string; note?: string; baseRevision?: number },
): ResourceWriteResult {
  if (!existsSync(workDirOf(workId))) {
    return { ok: false, code: "not_found", message: "作品不存在" };
  }
  const url = input.url.trim();
  if (!url) return { ok: false, code: "bad_request", message: "url 不能为空" };
  const file = readResources(workId);
  const revErr = checkRevision(file, input.baseRevision);
  if (revErr) return revErr;

  const now = Date.now();
  const item: ResourceItem = {
    id: newResourceId(),
    name: input.name.trim() || url,
    kind: "url",
    url,
    relativePath: null,
    mime: null,
    size: null,
    note: input.note,
    noteUpdatedAt: input.note ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
  file.items.push(item);
  file.revision += 1;
  writeResources(workId, file);
  return { ok: true, file, item };
}

export function addFileResource(
  workId: string,
  input: {
    name: string;
    sourcePath: string;
    mime?: string;
    size?: number;
    note?: string;
    baseRevision?: number;
  },
): ResourceWriteResult {
  if (!existsSync(workDirOf(workId))) {
    return { ok: false, code: "not_found", message: "作品不存在" };
  }
  const kind = classifyByExt(input.name);
  if (!kind) {
    return { ok: false, code: "resource_type_unsupported", message: "不支持的文件类型" };
  }
  const file = readResources(workId);
  const revErr = checkRevision(file, input.baseRevision);
  if (revErr) return revErr;

  const safeName = path.basename(input.name).replace(/[^\w.\u4e00-\u9fff\-]+/g, "_");
  const destName = `${Date.now().toString(36)}_${safeName}`;
  const dest = path.join(resourcesDir(workId), destName);
  mkdirSync(resourcesDir(workId), { recursive: true });
  copyFileSync(input.sourcePath, dest);

  const now = Date.now();
  const item: ResourceItem = {
    id: newResourceId(),
    name: input.name.trim() || safeName,
    kind,
    url: null,
    relativePath: destName,
    mime: input.mime ?? null,
    size: input.size ?? null,
    note: input.note,
    noteUpdatedAt: input.note ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
  file.items.push(item);
  file.revision += 1;
  writeResources(workId, file);
  return { ok: true, file, item };
}

/** 从 Buffer 写入（上传 API） */
export function addFileBufferResource(
  workId: string,
  input: {
    name: string;
    buffer: Buffer;
    mime?: string;
    note?: string;
    baseRevision?: number;
  },
): ResourceWriteResult {
  if (!existsSync(workDirOf(workId))) {
    return { ok: false, code: "not_found", message: "作品不存在" };
  }
  const kind = classifyByExt(input.name);
  if (!kind) {
    return { ok: false, code: "resource_type_unsupported", message: "不支持的文件类型" };
  }
  const file = readResources(workId);
  const revErr = checkRevision(file, input.baseRevision);
  if (revErr) return revErr;

  const safeName = path.basename(input.name).replace(/[^\w.\u4e00-\u9fff\-]+/g, "_");
  const destName = `${Date.now().toString(36)}_${safeName}`;
  const dest = path.join(resourcesDir(workId), destName);
  mkdirSync(resourcesDir(workId), { recursive: true });
  writeFileSync(dest, input.buffer);

  const now = Date.now();
  const item: ResourceItem = {
    id: newResourceId(),
    name: input.name.trim() || safeName,
    kind,
    url: null,
    relativePath: destName,
    mime: input.mime ?? null,
    size: input.buffer.length,
    note: input.note,
    noteUpdatedAt: input.note ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
  file.items.push(item);
  file.revision += 1;
  writeResources(workId, file);
  return { ok: true, file, item };
}

export function updateResourceNote(
  workId: string,
  resourceId: string,
  note: string,
  baseRevision?: number,
): ResourceWriteResult {
  const file = readResources(workId);
  const revErr = checkRevision(file, baseRevision);
  if (revErr) return revErr;
  const item = file.items.find((x) => x.id === resourceId);
  if (!item) return { ok: false, code: "not_found", message: "资源不存在" };
  item.note = note;
  item.noteUpdatedAt = Date.now();
  item.updatedAt = item.noteUpdatedAt;
  file.revision += 1;
  writeResources(workId, file);
  return { ok: true, file, item };
}

export function renameResource(
  workId: string,
  resourceId: string,
  name: string,
  baseRevision?: number,
): ResourceWriteResult {
  const file = readResources(workId);
  const revErr = checkRevision(file, baseRevision);
  if (revErr) return revErr;
  const item = file.items.find((x) => x.id === resourceId);
  if (!item) return { ok: false, code: "not_found", message: "资源不存在" };
  item.name = name.trim() || item.name;
  item.updatedAt = Date.now();
  file.revision += 1;
  writeResources(workId, file);
  return { ok: true, file, item };
}

export function deleteResource(
  workId: string,
  resourceId: string,
  baseRevision?: number,
): { ok: true; file: ResourcesFile } | { ok: false; code: string; message: string } {
  const file = readResources(workId);
  if (baseRevision !== undefined && baseRevision !== file.revision) {
    return { ok: false, code: "resource_conflict", message: "resources revision 冲突" };
  }
  const idx = file.items.findIndex((x) => x.id === resourceId);
  if (idx < 0) return { ok: false, code: "not_found", message: "资源不存在" };
  const [item] = file.items.splice(idx, 1);
  if (item.relativePath) {
    const fp = path.join(resourcesDir(workId), item.relativePath);
    try {
      if (existsSync(fp)) unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }
  file.revision += 1;
  writeResources(workId, file);
  removeCollabResourceMessages(workId, resourceId);
  return { ok: true, file };
}

export function getResource(workId: string, resourceId: string): ResourceItem | null {
  return readResources(workId).items.find((x) => x.id === resourceId) ?? null;
}

export function absoluteResourcePath(workId: string, item: ResourceItem): string | null {
  if (!item.relativePath) return null;
  return path.join(resourcesDir(workId), item.relativePath);
}
