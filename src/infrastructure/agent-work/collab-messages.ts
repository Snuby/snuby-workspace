// CollabMessageStore：多 scope 历史轨道（spec 018）
// ACP 仍作品级；此处只负责 jsonl 读写。

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { workDirOf } from "./work-repository";
import type { WorkCollabScope } from "@/infrastructure/agent-runtime";

export type CollabMessage = {
  role: "user" | "assistant";
  text: string;
  kind?: "user" | "assistant" | "inject";
  capability?: string;
  scope?: WorkCollabScope;
  error?: boolean;
  ts: number;
  tools?: { tool: string; state?: string; detail?: string; toolCallId?: string; ts?: number; endTs?: number }[];
};

export type CollabScopeRef =
  | { scope: "draft" }
  | { scope: "publish"; pubId: string }
  | { scope: "resource"; resourceId: string };

export function collabMessagesPath(workId: string, ref: CollabScopeRef): string {
  const base = path.join(workDirOf(workId), "collab");
  if (ref.scope === "draft") return path.join(base, "draft", "messages.jsonl");
  if (ref.scope === "publish") return path.join(base, "publish", `${ref.pubId}.jsonl`);
  return path.join(base, "resources", `${ref.resourceId}.jsonl`);
}

export function parseScopeRef(opts: {
  scope: string;
  resourceId?: string;
  pubId?: string;
}): CollabScopeRef | { error: string } {
  if (opts.scope === "draft") return { scope: "draft" };
  if (opts.scope === "publish") {
    if (!opts.pubId?.trim()) return { error: "publish scope 需要 pubId" };
    return { scope: "publish", pubId: opts.pubId.trim() };
  }
  if (opts.scope === "resource") {
    if (!opts.resourceId?.trim()) return { error: "resource scope 需要 resourceId" };
    return { scope: "resource", resourceId: opts.resourceId.trim() };
  }
  return { error: "无效 scope" };
}

export function appendCollabMessage(workId: string, ref: CollabScopeRef, msg: CollabMessage): void {
  const p = collabMessagesPath(workId, ref);
  mkdirSync(path.dirname(p), { recursive: true });
  const line = JSON.stringify({ ...msg, scope: ref.scope, ts: msg.ts || Date.now() });
  appendFileSync(p, `${line}\n`, "utf8");
}

export type MessagePage = {
  messages: CollabMessage[];
  nextCursor: number;
  hasMore: boolean;
};

const TAIL_CHUNK = 256 * 1024;
const TAIL_MAX = 8 * 1024 * 1024;

type LineEntry = { msg: CollabMessage; off: number };

function scanLines(text: string, base: number): LineEntry[] {
  const out: LineEntry[] = [];
  const n = text.length;
  let i = 0;
  if (base > 0 && text[0] !== "\n") {
    const nl = text.indexOf("\n");
    if (nl === -1) return out;
    i = nl + 1;
  }
  while (i < n) {
    const nl = text.indexOf("\n", i);
    const line = nl === -1 ? text.slice(i) : text.slice(i, nl);
    if (line.trim()) {
      try {
        out.push({ msg: JSON.parse(line) as CollabMessage, off: base + i });
      } catch {
        /* skip */
      }
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  return out;
}

export function readCollabMessages(
  workId: string,
  ref: CollabScopeRef,
  opts?: { limit?: number; cursor?: number; includeInject?: boolean },
): MessagePage {
  const p = collabMessagesPath(workId, ref);
  if (!existsSync(p)) return { messages: [], nextCursor: 0, hasMore: false };
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const size = statSync(p).size;
  if (size === 0) return { messages: [], nextCursor: 0, hasMore: false };
  const end = Math.max(0, Math.min(opts?.cursor === undefined ? size : opts.cursor, size));
  const fd = openSync(p, "r");
  try {
    let win = Math.min(TAIL_CHUNK, TAIL_MAX);
    let start = Math.max(0, end - win);
    let entries: LineEntry[] = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      start = Math.max(0, end - win);
      const buf = Buffer.alloc(end - start);
      readSync(fd, buf, 0, buf.length, start);
      entries = scanLines(buf.toString("utf8"), start);
      if (entries.length >= limit + 1 || start === 0 || win >= TAIL_MAX) break;
      win = Math.min(win * 2, TAIL_MAX);
    }
    const filtered = opts?.includeInject
      ? entries
      : entries.filter((e) => e.msg.kind !== "inject");
    const slice = filtered.slice(-limit);
    const hasMore = filtered.length > limit || start > 0;
    const nextCursor = slice.length ? slice[0].off : 0;
    return {
      messages: slice.map((e) => e.msg),
      nextCursor: hasMore ? nextCursor : 0,
      hasMore,
    };
  } finally {
    closeSync(fd);
  }
}

/** 近期摘录（预加载用）；排除 inject */
export function recentCollabSnippet(
  workId: string,
  ref: CollabScopeRef,
  limit = 24,
): string {
  const { messages } = readCollabMessages(workId, ref, { limit, includeInject: false });
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role === "user" ? "用户" : "助手";
    const text = (m.text ?? "").trim();
    if (!text) continue;
    const clipped = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    lines.push(`${role}: ${clipped}`);
  }
  return lines.join("\n\n");
}

export function removeCollabResourceMessages(workId: string, resourceId: string): void {
  const p = collabMessagesPath(workId, { scope: "resource", resourceId });
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function removeCollabPublishMessages(workId: string, pubId: string): void {
  const p = collabMessagesPath(workId, { scope: "publish", pubId });
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/** 确保 draft 消息文件存在 */
export function ensureCollabDraftFile(workId: string): void {
  const p = collabMessagesPath(workId, { scope: "draft" });
  if (!existsSync(p)) {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "", "utf8");
  }
}
