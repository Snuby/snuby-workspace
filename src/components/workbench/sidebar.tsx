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
};

/** 「宏观经济」一级菜单对应的全部子页路径 (即二级菜单项, 见 section-tabs.tsx) */
const MACRO_PATHS: readonly string[] = ["/macro", "/industry", "/alerts"];

const NAV: NavLeaf[] = [
  { href: "/", label: "工作台", icon: ICONS.home },
  { href: "/macro", label: "宏观经济", icon: ICONS.chart, match: MACRO_PATHS },
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
