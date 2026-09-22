"use client";

// Spec: 009-market-quotes — /market 错误兜底 (不让白屏; 布局仍在, 顶栏与二级菜单可用)

export default function MarketError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">页面出错</div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          行情数据读取失败，请确认已抓取数据（右上角「更新行情」）后重试。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90"
        >
          重试
        </button>
      </div>
    </div>
  );
}
