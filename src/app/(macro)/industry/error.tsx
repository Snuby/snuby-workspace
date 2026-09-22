"use client";

// Spec: 005-industry-watch — /industry 错误兜底 (US-2 AC3)
// Spec: 008-macro-hierarchy — 外壳由布局保留, 文案改为指向头部「更新数据」

export default function IndustryError() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">页面出错</div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          行业数据读取失败，请确认已抓取数据（点击上方「更新数据」）后重试。
        </p>
      </div>
    </div>
  );
}
