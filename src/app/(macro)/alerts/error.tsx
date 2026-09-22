"use client";

// Spec: 002-macro-alerts — /alerts 错误兜底 (US-2 AC4)

export default function AlertsError() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">页面出错</div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          跟踪提醒评估失败，请确认数据已抓取（npm run fetch）后重试。
        </p>
      </div>
    </div>
  );
}
