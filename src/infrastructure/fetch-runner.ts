// Spec: 003-manual-fetch — 抓取子进程执行器 (spawn + @@PROGRESS 行解析)

import { spawn } from "node:child_process";
import path from "node:path";

export type FetchProgress = {
  done: number;
  total: number;
  key: string;
  name: string;
  /** skip: 源数据未变化, 幂等短路 (spec 009 增量策略) */
  status: "ok" | "empty" | "fail" | "skip";
};

export type FetchSummary = {
  ok: number;
  empty: number;
  fail: number;
  failures: Array<{ key: string; name: string }>;
  /** spec 009: 命中增量短路而未写入的资产数 */
  skip?: number;
};

export type FetchRunnerHandlers = {
  onProgress: (p: FetchProgress) => void;
  onComplete: (summary: FetchSummary | null, exitCode: number | null, error?: string) => void;
};

// Python 解释器: 默认本地 venv (akshare 已装), 可用 FETCH_PYTHON_BIN 覆盖
const PYTHON_BIN =
  process.env.FETCH_PYTHON_BIN ??
  "/Users/suweijie/.workbuddy/binaries/python/envs/default/bin/python";

export function runFetchScript(
  projectRoot: string,
  handlers: FetchRunnerHandlers,
  scriptPath: string = path.join("scripts", "fetch_data.py"),
): void {
  const child = spawn(PYTHON_BIN, ["-u", scriptPath], {
    cwd: projectRoot,
  });

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      parseLine(line, handlers);
    }
  });

  child.on("error", (cause) => handlers.onComplete(null, null, String(cause)));
  child.on("close", (code) => handlers.onComplete(null, code));
}

function parseLine(line: string, handlers: FetchRunnerHandlers): void {
  const PROGRESS = "@@PROGRESS ";
  const DONE = "@@DONE ";
  try {
    if (line.startsWith(PROGRESS)) {
      handlers.onProgress(JSON.parse(line.slice(PROGRESS.length)) as FetchProgress);
    } else if (line.startsWith(DONE)) {
      handlers.onComplete(JSON.parse(line.slice(DONE.length)) as FetchSummary, null);
    }
  } catch {
    // 非 JSON 行 (普通日志) 忽略
  }
}
