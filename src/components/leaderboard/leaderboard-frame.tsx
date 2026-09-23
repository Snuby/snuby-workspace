"use client";

// Spec: 011-ai-leaderboard — iframe 榜单组件 (US-1/US-2/AC-B)
// Spec: 016-nav-modules — Web 版降级容器 (FR-5): 仅保留「在新窗口打开」外链兜底,
// 去掉提示文案行 (用户批复 2026-09-23, 与桌面版顶条移除保持一致)。

export default function LeaderboardFrame({
  src,
  title,
  externalUrl,
}: {
  src: string;
  title: string;
  externalUrl: string;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-line bg-surface px-4 py-1.5">
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[12px] font-medium text-accent-deep hover:underline"
        >
          在新窗口打开 ↗
        </a>
      </div>
      <iframe src={src} title={title} className="h-full w-full flex-1 border-0" allow="fullscreen" />
    </div>
  );
}
