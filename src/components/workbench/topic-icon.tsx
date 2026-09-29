import type { ReactNode } from "react";

/** 主题侧栏图标 — 与左侧菜单主题区共用 */
const ICON_CLASS = "h-[17px] w-[17px] shrink-0";

const NEWS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
    <path d="M4 5h15v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M19 8h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2" />
    <path d="M8 9h7" />
    <path d="M8 13h7" />
    <path d="M8 17h4" />
  </svg>
);

const CREATOR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

const LEADERBOARD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <path d="M7 4h10" />
    <path d="M17 4v8a5 5 0 0 1-10 0V4" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

const LAYERS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
    <path d="m12 2 10 6-10 6L2 8z" />
    <path d="m2 14 10 6 10-6" />
  </svg>
);

/** 出厂主题图标映射 (新主题用通用 layers 图标) */
export function topicIcon(id: string): ReactNode {
  if (id === "it-news") return NEWS;
  if (id === "creators") return CREATOR;
  if (id === "leaderboard") return LEADERBOARD;
  return LAYERS;
}
