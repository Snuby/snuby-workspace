"use client";

// 灵活工作台: 左侧菜单 = 固定区 (工作台/宏观经济/资产行情/Web访问/设置)
// + 主题区 (用户动态创建的主题, 来自 /api/topics; 主题 = 可配置的站点集合)

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTopics, type Topic } from "@/components/workbench/topics-context";
import { useClickOutside } from "@/lib/use-click-outside";

type NavLeaf = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** 一对多激活判定: 缺省时按路径精确相等 */
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
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
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
  leaderboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10" />
      <path d="M17 4v8a5 5 0 0 1-10 0V4" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="m12 2 10 6-10 6L2 8z" />
      <path d="m2 14 10 6 10-6" />
    </svg>
  ),
  flask: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M9 3h6" />
      <path d="M10 3v6.3L4.7 19a2 2 0 0 0 1.8 3h11a2 2 0 0 0 1.8-3L14 9.3V3" />
      <path d="M7 15h10" />
    </svg>
  ),
};

/** 「宏观经济」一级菜单对应的全部子页路径 */
const MACRO_PATHS: readonly string[] = ["/macro", "/industry", "/alerts"];

/** 「资产行情」一级菜单对应的全部子页路径 */
const MARKET_PATHS: readonly string[] = ["/market", "/metal", "/crypto", "/equity", "/realestate"];

/** 固定区导航 (主题区动态渲染在下) */
const NAV: NavLeaf[] = [
  { href: "/", label: "工作台", icon: ICONS.home },
  { href: "/macro", label: "宏观经济", icon: ICONS.chart, match: MACRO_PATHS },
  { href: "/market", label: "资产行情", icon: ICONS.market, match: MARKET_PATHS },
  { href: "/browser", label: "Web 访问", icon: ICONS.globe },
  { href: "/settings", label: "设置", icon: ICONS.gear },
];

/** 出厂主题图标映射 (新主题用通用 layers 图标) */
function topicIcon(id: string): React.ReactNode {
  if (id === "it-news") return ICONS.news;
  if (id === "creators") return ICONS.creator;
  if (id === "leaderboard") return ICONS.leaderboard;
  return ICONS.layers;
}

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
  const router = useRouter();
  const { topics, createTopic, renameTopic, deleteTopic } = useTopics();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  /** 当前展开 ⋯ 菜单的主题 id (null = 无) */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 正在重命名的主题 id (null = 无) */
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** ⋯ 菜单容器 ref (点击外部关闭) */
  const menuRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(menuRef, menuFor !== null, () => setMenuFor(null));

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const id = await createTopic(name);
    if (id) {
      setNewName("");
      setNewOpen(false);
      router.push(`/topic/${id}`);
    }
  }

  async function handleRename(t: Topic) {
    const name = renameValue.trim();
    if (name && name !== t.name) await renameTopic(t.id, name);
    setRenameFor(null);
    setMenuFor(null);
  }

  async function handleDelete(t: Topic) {
    if (!window.confirm(`删除主题「${t.name}」？主题内站点、标签与历史将一并清除。`)) return;
    await deleteTopic(t.id);
    setMenuFor(null);
    if (pathname === `/topic/${t.id}`) router.push("/");
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-base font-bold text-white">
          S
        </div>
        <div className="text-[17px] font-semibold tracking-wide">Snuby</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1">
        {/* 固定区 */}
        {NAV.map((item) => {
          const active = item.match ? item.match.includes(pathname) : pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={itemClass(active)}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}

        {/* 主题区 */}
        <div className="mb-1 mt-4 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">主题</span>
          <button
            type="button"
            title="新建主题"
            onClick={() => {
              setNewOpen((v) => !v);
              setMenuFor(null);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>

        {newOpen ? (
          <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-black/5 p-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") setNewOpen(false);
              }}
              placeholder="主题名称"
              className="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="shrink-0 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-white hover:opacity-90"
            >
              创建
            </button>
          </div>
        ) : null}

        {topics === null ? (
          <div className="px-2.5 py-2 text-[12px] text-ink-faint">加载中…</div>
        ) : topics.length === 0 ? (
          <div className="px-2.5 py-2 text-[12px] text-ink-faint">暂无主题，点右上角 + 新建</div>
        ) : (
          topics.map((t) => {
            const active = pathname === `/topic/${t.id}`;
            return (
              <div key={t.id} className="group relative">
                <Link href={`/topic/${t.id}`} className={itemClass(active)}>
                  {topicIcon(t.id)}
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.isPreset ? (
                    <span className="shrink-0 text-[10px] text-ink-faint">出厂</span>
                  ) : null}
                </Link>
                {/* hover ⋯ 菜单 */}
                <button
                  type="button"
                  aria-label={`管理主题 ${t.name}`}
                  onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                  className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/10 hover:text-ink group-hover:flex"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                    <circle cx="12" cy="5" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="12" cy="19" r="1.6" />
                  </svg>
                </button>
                {menuFor === t.id ? (
                  <div ref={menuRef} className="absolute right-0 top-full z-50 mt-1 w-[150px] rounded-lg border border-line bg-white p-1 shadow-xl">
                    {renameFor === t.id ? (
                      <div className="flex items-center gap-1 p-1">
                        <input
                          autoFocus
                          defaultValue={t.name}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRename(t);
                            if (e.key === "Escape") setRenameFor(null);
                          }}
                          className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-[12px] text-ink outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRename(t)}
                          className="shrink-0 text-[12px] text-accent-deep"
                        >
                          存
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameFor(t.id);
                            setRenameValue(t.name);
                          }}
                          className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-black/5"
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(t)}
                          className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-red-500 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        {/* 实验室区 (与主题同级的大板块): 内置实验性子板块, 独立新模式 */}
        <div className="mb-1 mt-4 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">实验室</span>
        </div>
        <Link href="/lab/local-agent" className={itemClass(pathname.startsWith("/lab"))}>
          {ICONS.flask}
          本地 Agent
        </Link>
      </nav>

      <div className="border-t border-line px-4 py-3.5 text-[11px] text-ink-faint">
        Snuby Workbench v0.1
      </div>
    </aside>
  );
}
