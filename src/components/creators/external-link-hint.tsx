"use client";

// Spec: 016-nav-modules — 自媒体 Web 版外链兜底 (FR-5: 登录页无 iframe 内嵌价值)

export default function ExternalLinkHint({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface">
      <p className="text-[14px] text-ink">{label}</p>
      <p className="text-[12.5px] text-ink-muted">该页面需要登录操作，请在浏览器新窗口打开。</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
      >
        在新窗口打开 ↗
      </a>
    </div>
  );
}
