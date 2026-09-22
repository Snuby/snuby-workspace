"use client";

// Spec: 005-industry-watch — /industry 错误兜底 (US-2 AC3)

export default function IndustryError() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">页面出错</div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          行业数据读取失败，请确认已抓取数据（国家经济数据页「更新数据」）后重试。
        </p>
      </div>
    </div>
  );
}
