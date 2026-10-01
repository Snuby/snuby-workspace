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

/**
 * 清洗解读落盘内容：去掉思考/过程/工具旁白，只保留可给人看的结论要点。
 */
export function sanitizeResourceNotePatch(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  // 常见思考块
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  t = t.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, "");

  // 若含明确「最终/结论」分段，取其后
  const finalMarkers =
    /(?:^|\n)#{1,3}\s*(?:最终|结论|要点|Note|NOTE|解读结果|精炼结果|短 note)[^\n]*\n([\s\S]*)$/i;
  const fm = t.match(finalMarkers);
  if (fm?.[1]?.trim()) t = fm[1].trim();

  // 去掉过程性前缀段
  const processHead =
    /^(?:好的|嗯|让我|我将|我来|首先|接下来|分析过程|思考过程|工具调用|正在|先看一下)[^\n]*\n+/;
  while (processHead.test(t)) t = t.replace(processHead, "");

  // 去掉「我调用了 XX」类旁白行
  t = t
    .split("\n")
    .filter((line) => {
      const s = line.trim();
      if (!s) return true;
      if (/^(?:工具|tool|function_call|Thought|Thinking)\b/i.test(s)) return false;
      if (/^(?:我(?:将|会|已|正在)|让我|首先|接下来).{0,40}(?:调用|读取|打开|浏览)/.test(s))
        return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return t;
}

/** resources.json 内联 note 软上限：更长的说明落到 artifacts */
export const RESOURCE_NOTE_SOFT_MAX = 480;

function summarizeNoteHead(text: string, max: number): string {
  const lines = text.split("\n");
  const keep: string[] = [];
  for (const line of lines) {
    const candidate = keep.length ? `${keep.join("\n")}\n${line}` : line;
    if (candidate.length > max) break;
    keep.push(line);
    const bullets = keep.filter((l) => /^\s*[-*•\d]+[.)、\s]/.test(l)).length;
    if (keep.join("\n").length >= Math.floor(max * 0.65) && bullets >= 3) break;
  }
  let out = keep.join("\n").trim();
  if (!out) out = text.slice(0, max).trim();
  if (out.length > max) out = `${out.slice(0, max - 1).trimEnd()}…`;
  return out;
}

/**
 * 把解读结果落成：短 note（进 resources.json）+ 可选详报文件（artifacts/resource-brief-<rid>.md）。
 * 规格：note 短结论；长内容用文件表示。
 */
export function materializeResourceNoteFromPatch(
  workDir: string,
  resourceId: string,
  patchRaw: string,
): string {
  const cleaned = sanitizeResourceNotePatch(patchRaw);
  if (!cleaned) return "";

  const briefRel = `artifacts/resource-brief-${resourceId}.md`;
  const briefAbs = path.join(workDir, briefRel);
  const longRel = `artifacts/url-analyze-${resourceId}.md`;
  const hasLong = existsSync(path.join(workDir, longRel));

  const footerBits: string[] = [];
  if (cleaned.length > RESOURCE_NOTE_SOFT_MAX) {
    const artDir = path.join(workDir, "artifacts");
    if (!existsSync(artDir)) mkdirSync(artDir, { recursive: true });
    writeFileSync(briefAbs, cleaned, "utf8");
    footerBits.push(`详报: ${briefRel}`);
    if (hasLong) footerBits.push(`长文: ${longRel}`);
    const budget = Math.max(120, RESOURCE_NOTE_SOFT_MAX - footerBits.join("\n").length - 4);
    return `${summarizeNoteHead(cleaned, budget)}\n\n${footerBits.join("\n")}`;
  }

  if (hasLong) footerBits.push(`长文: ${longRel}`);
  return footerBits.length ? `${cleaned}\n${footerBits.join("\n")}` : cleaned;
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
