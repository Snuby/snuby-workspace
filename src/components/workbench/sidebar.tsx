"use client";

// Spec: 001-workbench-mvp — 左侧菜单 (US-1 AC1/AC2)

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLeaf = { href: string; label: string; icon: React.ReactNode };
type NavSection =
  | { kind: "leaf"; item: NavLeaf }
  | { kind: "group"; label: string; items: NavLeaf[] };

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

const NAV: NavSection[] = [
  { kind: "leaf", item: { href: "/", label: "工作台", icon: ICONS.home } },
  {
    kind: "group",
    label: "数据观察",
    items: [{ href: "/macro", label: "国家经济数据", icon: ICONS.chart }],
  },
  { kind: "leaf", item: { href: "/settings", label: "设置", icon: ICONS.gear } },
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

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {NAV.map((section, i) =>
          section.kind === "leaf" ? (
            <Link
              key={section.item.href}
              href={section.item.href}
              className={itemClass(pathname === section.item.href)}
            >
              {section.item.icon}
              {section.item.label}
            </Link>
          ) : (
            <div key={section.label} className={i > 0 ? "mt-4" : "mt-2"}>
              <div className="px-2.5 pb-1.5 text-[11px] tracking-widest text-ink-faint select-none">
                {section.label}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={itemClass(pathname.startsWith(item.href))}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>
          ),
        )}
      </nav>

      <div className="border-t border-line px-4 py-3.5 text-[11px] text-ink-faint">
        Snuby Workbench v0.1
      </div>
    </aside>
  );
}
