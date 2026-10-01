// 作品越界审计：扫其他 works + 全部 sessions

import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { getWorksRoot, workDirOf } from "./work-repository";
import { getSessionsRoot } from "@/infrastructure/agent-session-store";

export type WorkViolation = {
  path: string;
  mtime: number;
  size: number;
  area: "other_work" | "agent_session" | "other";
};

const BOOKKEEPING = new Set([
  "meta.json",
  "messages.jsonl",
  "context-state.json",
  "resources.json",
  "drafts-branches.json",
  "library.json",
]);

function isBookkeeping(name: string): boolean {
  return name.startsWith(".") || BOOKKEEPING.has(name);
}

function walk(
  dir: string,
  cutoff: number,
  ownWork: string,
  area: WorkViolation["area"],
  out: WorkViolation[],
): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (isBookkeeping(name)) continue;
    const p = path.join(dir, name);
    if (p === ownWork) continue;
    try {
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p, cutoff, ownWork, area, out);
        continue;
      }
      if (st.mtimeMs > cutoff) out.push({ path: p, mtime: st.mtimeMs, size: st.size, area });
    } catch {
      /* ignore */
    }
  }
}

export function auditWorkViolations(
  workId: string,
  opts?: { sinceMs?: number; cutoffMs?: number },
): WorkViolation[] {
  const out: WorkViolation[] = [];
  const cutoff = opts?.sinceMs ?? Date.now() - (opts?.cutoffMs ?? 5 * 60_000);
  const ownWork = workDirOf(workId);

  const worksRoot = getWorksRoot();
  if (existsSync(worksRoot)) {
    for (const name of readdirSync(worksRoot)) {
      if (name.startsWith(".") || name === "library.json" || name === workId) continue;
      const p = path.join(worksRoot, name);
      try {
        if (!statSync(p).isDirectory()) continue;
        walk(p, cutoff, ownWork, "other_work", out);
      } catch {
        /* ignore */
      }
    }
  }

  const sessionsRoot = getSessionsRoot();
  if (existsSync(sessionsRoot)) {
    for (const name of readdirSync(sessionsRoot)) {
      if (name.startsWith(".") || !name.includes("-")) {
        // 仍扫描会话目录；跳过根级非会话文件由 isDirectory 过滤
      }
      const p = path.join(sessionsRoot, name);
      try {
        if (!statSync(p).isDirectory()) continue;
        walk(p, cutoff, ownWork, "agent_session", out);
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}
