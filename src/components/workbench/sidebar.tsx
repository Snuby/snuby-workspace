"use client";

// Spec: 001-workbench-mvp — 工作台外壳左侧菜单 (US-1 AC1/AC2)
// Spec: 008-macro-hierarchy — 三个数据模块收敛为单一「宏观经济」一级菜单 (US-1)

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLeaf = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** 一对多激活判定 (spec 008 决策 6): 缺省时按路径精确相等 */
  match?: readonly string[];
};

const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-5 3 3 5-7" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  ),
  market: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M6 3v3" />
      <path d="M6 18v3" />
      <rect x="4" y="6" width="4" height="12" rx="1" />
      <path d="M17 2v5" />
      <path d="M17 17v5" />
      <rect x="15" y="7" width="4" height="10" rx="1" />
    </svg>
  ),
  leaderboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10" />
      <path d="M17 4v8a5 5 0 0 1-10 0V4" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  news: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M4 5h15v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M19 8h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2" />
      <path d="M8 9h7" />
      <path d="M8 13h7" />
      <path d="M8 17h4" />
    </svg>
  ),
  creator: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </svg>
  ),
};

/** 「宏观经济」一级菜单对应的全部子页路径 (即二级菜单项, 见 section-tabs.tsx) */
const MACRO_PATHS: readonly string[] = ["/macro", "/industry", "/alerts"];

/** 「资产行情」一级菜单对应的全部子页路径 (spec 009) */
const MARKET_PATHS: readonly string[] = ["/market", "/metal", "/crypto", "/equity", "/realestate"];

/** 「AI 模型榜单」一级菜单对应的全部子页路径 (spec 011) */
const LEADERBOARD_PATHS: readonly string[] = ["/ai-leaderboard", "/ai-leaderboard/openrouter"];

/** 「自媒体」一级菜单对应的全部子页路径 (spec 016) */
const CREATORS_PATHS: readonly string[] = ["/creators/xiaohongshu", "/creators/wechat"];

const NAV: NavLeaf[] = [
  { href: "/", label: "工作台", icon: ICONS.home },
  { href: "/macro", label: "宏观经济", icon: ICONS.chart, match: MACRO_PATHS },
  { href: "/market", label: "资产行情", icon: ICONS.market, match: MARKET_PATHS },
  { href: "/ai-leaderboard", label: "AI 模型榜单", icon: ICONS.leaderboard, match: LEADERBOARD_PATHS },
  { href: "/it-news", label: "IT 资讯", icon: ICONS.news },
  { href: "/creators", label: "自媒体", icon: ICONS.creator, match: CREATORS_PATHS },
  { href: "/browser", label: "Web 访问", icon: ICONS.globe },
  { href: "/settings", label: "设置", icon: ICONS.gear },
];

function itemClass(active: boolean): string {
  return [
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors",
    active
      ? "bg-accent-soft font-semibold text-accent-deep"
      : "text-ink hover:bg-black/5",
  ].join(" ");
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-base font-bold text-white">
          S
        </div>
        <div className="text-[17px] font-semibold tracking-wide">Snuby</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1">
        {NAV.map((item) => {
          const active = item.match ? item.match.includes(pathname) : pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={itemClass(active)}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-3.5 text-[11px] text-ink-faint">
        Snuby Workbench v0.1
      </div>
    </aside>
  );
}
