// Spec: 010-ai-vc-watch — 创投抓取任务状态 (内存单例, 防重复触发; 结构对齐 spec 003/009)

import path from "node:path";
import { runFetchScript, type FetchSummary } from "@/infrastructure/fetch-runner";

export type VcFetchJobState = {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  done: number;
  total: number;
  current: { key: string; name: string } | null;
  summary: FetchSummary | null;
  error: string | null;
};

const PROJECT_ROOT = process.cwd();
const VC_SCRIPT = path.join("scripts", "fetch_vc.py");
/** 来源总数 (scripts/fetch_vc.py 的 SOURCES 长度); 运行时由 @@PROGRESS 的 total 校正 */
const VC_TOTAL = 2;

let job: VcFetchJobState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  done: 0,
  total: VC_TOTAL,
  current: null,
  summary: null,
  error: null,
};

export function getVcFetchStatus(): VcFetchJobState {
  return job;
}

export function startVcFetch(): { started: boolean; state: VcFetchJobState } {
  if (job.status === "running") {
    return { started: false, state: job };
  }

  job = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    done: 0,
    total: VC_TOTAL,
    current: null,
    summary: null,
    error: null,
  };

  runFetchScript(
    PROJECT_ROOT,
    {
      onProgress: (p) => {
        if (job.status !== "running") return;
        job.done = p.done;
        job.total = p.total;
        job.current = { key: p.key, name: p.name };
      },
      onComplete: (summary, _exitCode, error) => {
        if (job.status !== "running") return; // @@DONE 与 close 双回调只取第一次
        job.finishedAt = new Date().toISOString();
        if (error) {
          job.status = "error";
          job.error = error;
          return;
        }
        job.summary = summary;
        job.status = "done";
      },
    },
    VC_SCRIPT,
  );

  return { started: true, state: job };
}
