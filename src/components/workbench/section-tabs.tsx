"use client";

// Spec: 008-macro-hierarchy — 顶部二级菜单 (US-2): 纯导航, 不发数据请求; 右侧 action 插槽由布局传入
// Spec: 009-market-quotes — 参数化 tabs 以复用; 不传时保持 spec 008 的「宏观经济」默认行为

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SectionTab = { href: string; label: string };

/** 「宏观经济」的二级菜单项 (缺省值, 见 spec 008 design 决策 3) */
const MACRO_TABS: readonly SectionTab[] = [
  { href: "/macro", label: "国家经济数据" },
  { href: "/industry", label: "行业观察" },
  { href: "/alerts", label: "跟踪提醒" },
];

export default function SectionTabs({
  tabs = MACRO_TABS,
  action,
}: {
  tabs?: readonly SectionTab[];
  action?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-[46px] shrink-0 items-stretch justify-between gap-4 border-b border-line bg-surface px-6">
      <nav className="flex items-stretch gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={[
                "relative flex items-center px-2.5 text-[13.5px] transition-colors",
                active ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
              {active ? (
                <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {action ? <div className="flex items-center py-1.5">{action}</div> : null}
    </div>
  );
}
