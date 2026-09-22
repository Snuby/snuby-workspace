"use client";

// Spec: 010-ai-vc-watch — 事件流页错误兜底 (Next error boundary)

import { useEffect } from "react";

export default function VcPageError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">事件流加载失败</div>
        <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90"
        >
          重试
        </button>
      </div>
    </div>
  );
}
