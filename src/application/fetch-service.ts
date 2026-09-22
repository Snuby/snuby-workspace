// Spec: 003-manual-fetch — 抓取任务状态管理 (内存单例, 防重复触发)

import { runFetchScript, type FetchSummary } from "@/infrastructure/fetch-runner";

export type FetchJobState = {
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

let job: FetchJobState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  done: 0,
  total: 26,
  current: null,
  summary: null,
  error: null,
};

export function getFetchStatus(): FetchJobState {
  return job;
}

export function startFetch(): { started: boolean; state: FetchJobState } {
  if (job.status === "running") {
    return { started: false, state: job };
  }

  job = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    done: 0,
    total: 26,
    current: null,
    summary: null,
    error: null,
  };

  runFetchScript(PROJECT_ROOT, {
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
  });

  return { started: true, state: job };
}
