"use client";

// Spec: 010-ai-vc-watch — 融资事件抓取按钮: 异步触发 + 轮询进度 + 防重复
// 交互模型同 spec 003/009 (market-fetch-button); 来源数 = 2 (techcrunch + hn)

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type VcFetchJobState = {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  summary: {
    ok: number;
    empty: number;
    fail: number;
    skip?: number;
    failures: { key: string; name: string }[];
  } | null;
  error: string | null;
};

const POLL_MS = 1200;
const DEFAULT_TOTAL = 2;

export default function VcFetchButton() {
  const router = useRouter();
  const [job, setJob] = useState<VcFetchJobState | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/vc/fetch/status", { cache: "no-store" });
      if (!res.ok) return;
      const state: VcFetchJobState = await res.json();
      setJob(state);
      if (state.status !== "running" && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
        if (state.status === "done") router.refresh();
      }
    } catch {
      // 本地服务不可达, 下轮重试
    }
  }, [router]);

  const ensurePolling = useCallback(() => {
    if (!timer.current) timer.current = setInterval(poll, POLL_MS);
  }, [poll]);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (job?.status === "running") ensurePolling();
  }, [job?.status, ensurePolling]);

  async function handleClick() {
    if (starting || job?.status === "running") return;
    setStarting(true);
    try {
      const res = await fetch("/api/vc/fetch", { method: "POST" });
      const body = await res.json();
      setJob(body.state as VcFetchJobState);
      if (res.status === 409) return;
      ensurePolling();
    } catch {
      // 按钮保持原状, 用户可重试
    } finally {
      setStarting(false);
    }
  }

  const running = job?.status === "running";
  const summary = job?.status === "done" ? job.summary : null;
  const failItems = summary && summary.failures.length > 0 ? summary.failures : null;

  const summaryText = summary
    ? [
        `写入 ${summary.ok}`,
        summary.skip ? `已最新 ${summary.skip}` : null,
        summary.empty ? `无数据 ${summary.empty}` : null,
        failItems
          ? failItems.length <= 2
            ? `失败: ${failItems.map((f) => f.name).join("、")}`
            : `失败 ${failItems.length} 项`
          : null,
      ]
        .filter((p): p is string => p !== null)
        .join(" · ")
    : null;
  const summaryTip =
    failItems && failItems.length > 2
      ? `失败: ${failItems.map((f) => f.name).join("、")}`
      : null;

  return (
    <div className="flex items-center gap-3">
      {running && job ? (
        <div className="h-1 w-16 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.round((job.done / Math.max(job.total, 1)) * 100)}%` }}
          />
        </div>
      ) : null}

      {summaryText ? (
        <div
          className="min-w-0 max-w-[420px] truncate text-[11.5px] text-ink-faint"
          title={summaryTip ?? undefined}
        >
          上次抓取: {summaryText}
        </div>
      ) : null}

      {job?.status === "error" ? (
        <div
          className="min-w-0 max-w-[280px] truncate text-[11.5px] text-red-600"
          title={job.error ?? ""}
        >
          抓取进程异常: {job.error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleClick}
        disabled={running || starting}
        className={[
          "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
          running || starting
            ? "cursor-not-allowed bg-black/5 text-ink-faint"
            : "bg-accent text-white hover:opacity-90",
        ].join(" ")}
      >
        {running ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-faint border-t-transparent" />
            抓取中 {job?.done ?? 0}/{job?.total ?? DEFAULT_TOTAL}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            更新融资
          </>
        )}
      </button>
    </div>
  );
}
