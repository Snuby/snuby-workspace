// WorkRepository：作品目录 CRUD 与骨架（spec 018）
//
//   ~/snuby-workspace-data/agent-works/
//     library.json
//     <workId>/ meta.json · collab/ · drafts/ · resources/ · artifacts/ · publish/

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import path from "path";
import { userDataPath } from "@/infrastructure/user-data-paths";

export type WorkStatus = "drafting" | "ready" | "published" | "archived";

export type WorkMeta = {
  id: string;
  title: string;
  type: "article";
  status: WorkStatus;
  currentDraftId: string;
  folderId?: string | null;
  createdAt: number;
  updatedAt: number;
  acpSessionId?: string;
  conventionFp?: string;
  preloadFailed?: boolean;
  model?: string;
};

export type LibraryFolder = {
  id: string;
  name: string;
  parentId: string | null;
  workIds: string[];
};

export type WorkLibrary = {
  version: 1;
  folders: LibraryFolder[];
  /** 未进任何文件夹的作品 */
  rootWorkIds: string[];
};

function worksRoot(): string {
  return process.env.AGENT_WORKS_PATH?.trim() || userDataPath("agent-works");
}

/** 当前作品根目录（惰性读 env） */
export function getWorksRoot(): string {
  return worksRoot();
}

function ensureRoot(): void {
  mkdirSync(worksRoot(), { recursive: true });
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function workDirOf(id: string): string {
  return path.join(worksRoot(), id);
}

function metaPath(id: string): string {
  return path.join(workDirOf(id), "meta.json");
}

function libraryPath(): string {
  return path.join(worksRoot(), "library.json");
}

export function emptyLibrary(): WorkLibrary {
  return { version: 1, folders: [], rootWorkIds: [] };
}

export function readLibrary(): WorkLibrary {
  ensureRoot();
  const lib = readJsonFile<WorkLibrary>(libraryPath(), emptyLibrary());
  if (!lib.folders) lib.folders = [];
  if (!lib.rootWorkIds) lib.rootWorkIds = [];
  lib.version = 1;
  return lib;
}

export function writeLibrary(lib: WorkLibrary): void {
  ensureRoot();
  atomicWriteJson(libraryPath(), lib);
}

function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function scaffoldWorkDir(workId: string, draftId: string): void {
  const wd = workDirOf(workId);
  mkdirSync(path.join(wd, "artifacts"), { recursive: true });
  mkdirSync(path.join(wd, "resources"), { recursive: true });
  mkdirSync(path.join(wd, "drafts", draftId), { recursive: true });
  mkdirSync(path.join(wd, "publish"), { recursive: true });
  mkdirSync(path.join(wd, "collab", "draft"), { recursive: true });
  mkdirSync(path.join(wd, "collab", "publish"), { recursive: true });
  mkdirSync(path.join(wd, "collab", "resources"), { recursive: true });

  atomicWriteJson(path.join(wd, "resources", "resources.json"), {
    version: 1,
    revision: 0,
    items: [],
  });

  writeFileSync(path.join(wd, "drafts", draftId, "content.md"), "", "utf8");
  atomicWriteJson(path.join(wd, "drafts", draftId, "draft_meta.json"), {
    id: draftId,
    parentId: null,
    createdAt: Date.now(),
    source: "manual",
    label: "初始",
  });
  atomicWriteJson(path.join(wd, "drafts", "drafts-branches.json"), {
    version: 1,
    nodes: [{ id: draftId, parentId: null, createdAt: Date.now(), label: "初始" }],
    currentId: draftId,
  });
  writeFileSync(path.join(wd, "collab", "draft", "messages.jsonl"), "", "utf8");
}

export function getWork(id: string): WorkMeta | null {
  const p = metaPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as WorkMeta;
  } catch {
    return null;
  }
}

export function writeWorkMeta(meta: WorkMeta): void {
  meta.updatedAt = Date.now();
  atomicWriteJson(metaPath(meta.id), meta);
}

export function listWorks(): WorkMeta[] {
  ensureRoot();
  const root = worksRoot();
  if (!existsSync(root)) return [];
  const out: WorkMeta[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith(".") || name === "library.json") continue;
    const meta = getWork(name);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * 把磁盘上有 meta 但未进 library 的作品补回 rootWorkIds；
 * 清掉 library 里已不存在的 id。重启/路径漂移后恢复可见性。
 */
export function repairLibrary(): WorkLibrary {
  const lib = readLibrary();
  const works = listWorks();
  const known = new Set(works.map((w) => w.id));
  const inLib = new Set<string>([
    ...lib.rootWorkIds,
    ...lib.folders.flatMap((f) => f.workIds),
  ]);

  lib.rootWorkIds = lib.rootWorkIds.filter((id) => known.has(id));
  for (const f of lib.folders) {
    f.workIds = f.workIds.filter((id) => known.has(id));
  }
  for (const w of works) {
    if (inLib.has(w.id)) continue;
    if (w.folderId && lib.folders.some((f) => f.id === w.folderId)) {
      const folder = lib.folders.find((f) => f.id === w.folderId)!;
      if (!folder.workIds.includes(w.id)) folder.workIds.push(w.id);
    } else {
      w.folderId = null;
      writeWorkMeta(w);
      if (!lib.rootWorkIds.includes(w.id)) lib.rootWorkIds.push(w.id);
    }
  }
  writeLibrary(lib);
  return lib;
}

export function renameLibraryFolder(folderId: string, name: string): LibraryFolder {
  const lib = readLibrary();
  const folder = lib.folders.find((f) => f.id === folderId);
  if (!folder) throw new Error("文件夹不存在");
  folder.name = name.trim() || folder.name;
  writeLibrary(lib);
  return folder;
}

export function renameWork(workId: string, title: string): WorkMeta {
  const meta = getWork(workId);
  if (!meta) throw new Error("作品不存在");
  meta.title = title.trim() || meta.title;
  writeWorkMeta(meta);
  return meta;
}

export function deleteLibraryFolder(folderId: string): void {
  const lib = readLibrary();
  const folder = lib.folders.find((f) => f.id === folderId);
  if (!folder) throw new Error("文件夹不存在");
  // 文件夹内作品挂回根；子文件夹一并删索引（作品不丢）
  const removeIds = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of lib.folders) {
      if (f.parentId && removeIds.has(f.parentId) && !removeIds.has(f.id)) {
        removeIds.add(f.id);
        changed = true;
      }
    }
  }
  const orphanWorks: string[] = [];
  for (const f of lib.folders) {
    if (removeIds.has(f.id)) orphanWorks.push(...f.workIds);
  }
  lib.folders = lib.folders.filter((f) => !removeIds.has(f.id));
  for (const wid of orphanWorks) {
    if (!lib.rootWorkIds.includes(wid)) lib.rootWorkIds.push(wid);
    const meta = getWork(wid);
    if (meta) {
      meta.folderId = null;
      writeWorkMeta(meta);
    }
  }
  writeLibrary(lib);
}

export type CreateWorkInput = {
  title: string;
  folderId?: string | null;
};

export function createWork(input: CreateWorkInput): WorkMeta {
  ensureRoot();
  const id = newId("w");
  const draftId = newId("d");
  const now = Date.now();
  scaffoldWorkDir(id, draftId);

  const meta: WorkMeta = {
    id,
    title: input.title.trim() || "未命名作品",
    type: "article",
    status: "drafting",
    currentDraftId: draftId,
    folderId: input.folderId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  atomicWriteJson(metaPath(id), meta);

  const lib = readLibrary();
  if (input.folderId) {
    const folder = lib.folders.find((f) => f.id === input.folderId);
    if (folder) {
      if (!folder.workIds.includes(id)) folder.workIds.push(id);
    } else {
      lib.rootWorkIds.push(id);
      meta.folderId = null;
      atomicWriteJson(metaPath(id), meta);
    }
  } else {
    if (!lib.rootWorkIds.includes(id)) lib.rootWorkIds.push(id);
  }
  writeLibrary(lib);
  return meta;
}

export function deleteWork(id: string): boolean {
  const dir = workDirOf(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  const lib = readLibrary();
  lib.rootWorkIds = lib.rootWorkIds.filter((x) => x !== id);
  for (const f of lib.folders) {
    f.workIds = f.workIds.filter((x) => x !== id);
  }
  writeLibrary(lib);
  return true;
}

export function createLibraryFolder(name: string, parentId: string | null = null): LibraryFolder {
  const lib = readLibrary();
  if (parentId && !lib.folders.some((f) => f.id === parentId)) {
    throw new Error("父文件夹不存在");
  }
  const folder: LibraryFolder = {
    id: newId("f"),
    name: name.trim() || "未命名文件夹",
    parentId,
    workIds: [],
  };
  lib.folders.push(folder);
  writeLibrary(lib);
  return folder;
}

/** 将作品挂到文件夹或根；不移动磁盘目录 */
export function moveWorkToFolder(workId: string, folderId: string | null): void {
  const meta = getWork(workId);
  if (!meta) throw new Error("作品不存在");
  const lib = readLibrary();
  lib.rootWorkIds = lib.rootWorkIds.filter((x) => x !== workId);
  for (const f of lib.folders) {
    f.workIds = f.workIds.filter((x) => x !== workId);
  }
  if (folderId) {
    const folder = lib.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("文件夹不存在");
    folder.workIds.push(workId);
    meta.folderId = folderId;
  } else {
    lib.rootWorkIds.push(workId);
    meta.folderId = null;
  }
  writeLibrary(lib);
  writeWorkMeta(meta);
}

export function contentPathOf(workId: string, draftId: string): string {
  return path.join(workDirOf(workId), "drafts", draftId, "content.md");
}

export function currentContentPath(workId: string): string | null {
  const meta = getWork(workId);
  if (!meta) return null;
  return contentPathOf(workId, meta.currentDraftId);
}
