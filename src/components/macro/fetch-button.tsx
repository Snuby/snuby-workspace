"use client";

// Spec: 003-manual-fetch — 数据更新按钮: 异步触发 + 轮询进度 + 防重复

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type FetchJobState = {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  summary: { ok: number; empty: number; fail: number; failures: { key: string; name: string }[] } | null;
  error: string | null;
};

const POLL_MS = 1200;

export default function FetchButton() {
  const router = useRouter();
  const [job, setJob] = useState<FetchJobState | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/macro/fetch/status", { cache: "no-store" });
      if (!res.ok) return;
      const state: FetchJobState = await res.json();
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
    if (!timer.current) {
      timer.current = setInterval(poll, POLL_MS);
    }
  }, [poll]);

  useEffect(() => {
    // 挂载时同步一次状态; 若任务已在运行, 由下方 effect 启动轮询
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
      const res = await fetch("/api/macro/fetch", { method: "POST" });
      const body = await res.json();
      setJob(body.state as FetchJobState);
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

  // SectionTabs 是固定 46px 的导航条, action 必须保持单行高度;
  // 摘要文案放按钮左侧, 失败明细收进 hover 提示 (纵向堆叠会溢出压到页面内容)
  const summaryText = summary
    ? [
        `成功 ${summary.ok + summary.empty}/${summary.ok + summary.empty + summary.fail}`,
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
        <div className="min-w-0 max-w-[280px] truncate text-[11.5px] text-red-600" title={job.error ?? ""}>
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
            抓取中 {job?.done ?? 0}/{job?.total ?? 36}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            更新数据
          </>
        )}
      </button>
    </div>
  );
}
