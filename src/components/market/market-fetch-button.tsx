"use client";

// Spec: 009-market-quotes — 行情更新按钮: 异步触发 + 轮询进度 + 防重复 (交互模型同 spec 003)

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type MarketFetchJobState = {
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
const DEFAULT_TOTAL = 11;

export default function MarketFetchButton() {
  const router = useRouter();
  const [job, setJob] = useState<MarketFetchJobState | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/market/fetch/status", { cache: "no-store" });
      if (!res.ok) return;
      const state: MarketFetchJobState = await res.json();
      setJob(state);
      if (state.status !== "running" && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
        if (state.status === "done") router.refresh(); // 完成后刷新服务端数据
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
      const res = await fetch("/api/market/fetch", { method: "POST" });
      const body = await res.json();
      setJob(body.state as MarketFetchJobState);
      if (res.status === 409) return; // 已有任务在跑, 采纳服务端状态即可
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

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={running || starting}
        className={[
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
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
            更新行情
          </>
        )}
      </button>

      {running && job ? (
        <div className="h-1 w-36 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.round((job.done / Math.max(job.total, 1)) * 100)}%` }}
          />
        </div>
      ) : null}

      {summary ? (
        <div className="text-[11.5px] text-ink-faint">
          上次抓取: 写入 {summary.ok}
          {summary.skip ? `，已最新 ${summary.skip}` : ""}
          {failItems ? `，失败: ${failItems.map((f) => f.name).join("、")}` : ""}
        </div>
      ) : null}

      {job?.status === "error" ? (
        <div className="text-[11.5px] text-red-600">抓取进程异常: {job.error}</div>
      ) : null}
    </div>
  );
}
