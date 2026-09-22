// Spec: 001-workbench-mvp — macro 页错误兜底 (US-2 AC5)
// Spec: 008-macro-hierarchy — 外壳由布局保留, 文案改为指向头部「更新数据」

"use client";

export default function MacroError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">页面出错了</div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          加载宏观数据时发生异常，可点击上方「更新数据」重新抓取，或直接重试。
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-accent px-4 py-1.5 text-[13px] text-white hover:opacity-90"
        >
          重试
        </button>
      </div>
    </div>
  );
}
