"use client";

// Spec: 011-ai-leaderboard — iframe 榜单组件 (US-1/US-2/AC-B)
// 纯 iframe 容器: 内容跟随官方页面实时更新, 零本地数据; 交互/滚动在框架内进行。

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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 text-[12px] text-ink-muted">
        <span>内容跟随官方页面实时更新；交互与滚动在框架内进行。</span>
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium text-accent-deep hover:underline"
        >
          在新窗口打开 ↗
        </a>
      </div>
      <iframe src={src} title={title} className="h-full w-full flex-1 border-0" allow="fullscreen" />
    </div>
  );
}
