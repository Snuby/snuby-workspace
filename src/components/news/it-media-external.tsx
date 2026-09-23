"use client";

// Spec: 016-nav-modules — Web 版「外链卡片」降级 (2026-09-23 实测修复)
// 量子位/新智元/机器之心/InfoQ 等中文媒体站存在反 iframe 机制 (点击文章强制顶层跳转或被静默拦截),
// 无法在 iframe 内提供可靠阅读 → Web 版降级为媒体站点入口卡片, 点击在新窗口打开原文。
// 桌面版 webview 不受影响 (webview 为独立窗口环境, 无 iframe 检测)。

export default function ItMediaExternal({
  label,
  url,
  desc,
}: {
  label: string;
  url: string;
  desc?: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div className="w-[400px] max-w-[85%] rounded-xl border border-line bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-[22px] font-bold text-accent-deep">
          {label.slice(0, 1)}
        </div>
        <h2 className="mb-1 text-[17px] font-semibold text-ink">{label}</h2>
        {desc ? <p className="mb-1 text-[12.5px] text-ink-muted">{desc}</p> : null}
        <p className="mb-6 truncate text-[12px] text-ink-faint">{url}</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90"
        >
          在新窗口打开 ↗
        </a>
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-faint">
          该站点不兼容内嵌阅读，点击按钮在新标签页访问原文
        </p>
      </div>
    </div>
  );
}
