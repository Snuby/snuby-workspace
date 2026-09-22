// Spec: 009-market-quotes — 行情抓取任务状态 (内存单例, 防重复触发; 结构对齐 spec 003)

import path from "node:path";
import { runFetchScript, type FetchSummary } from "@/infrastructure/fetch-runner";

export type MarketFetchJobState = {
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
const MARKET_SCRIPT = path.join("scripts", "fetch_market.py");
/** 资产总数 (scripts/fetch_market.py 的 ASSETS 长度); 运行时由 @@PROGRESS 的 total 校正 */
const MARKET_TOTAL = 11;

let job: MarketFetchJobState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  done: 0,
  total: MARKET_TOTAL,
  current: null,
  summary: null,
  error: null,
};

export function getMarketFetchStatus(): MarketFetchJobState {
  return job;
}

export function startMarketFetch(): { started: boolean; state: MarketFetchJobState } {
  if (job.status === "running") {
    return { started: false, state: job };
  }

  job = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    done: 0,
    total: MARKET_TOTAL,
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
    MARKET_SCRIPT,
  );

  return { started: true, state: job };
}
