"use client";

// Spec: 016-nav-modules — IT 资讯客户端选项卡 (D2 定案: 视觉同款 SectionTabs, 客户端状态切换 + 动态添加/删除)
// 与榜单的 SectionTabs 差异: 媒体由用户动态增删, 不适合路由级 tab → 单路由 + 状态切换 (见 design §2.2)。

import { useState } from "react";
import { normalizeUrl } from "@/domain/url-utils";
import type { MediaItem } from "@/domain/it-media";

export default function ItMediaTabs({
  items,
  activeSlug,
  onSelect,
  onAdd,
  onRemove,
}: {
  items: readonly MediaItem[];
  activeSlug: string;
  onSelect: (slug: string) => void;
  onAdd: (item: MediaItem) => void;
  onRemove: (slug: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submitAdd() {
    const label = name.trim();
    if (!label) {
      setError("请填写名称");
      return;
    }
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError("网址无效，请检查格式（如 example.com）");
      return;
    }
    onAdd({ slug: `custom-${Date.now()}`, label, url: normalized, builtin: false });
    setShowAdd(false);
    setName("");
    setUrl("");
    setError(null);
  }

  return (
    <div className="flex h-[46px] shrink-0 items-stretch justify-between gap-4 border-b border-line bg-surface px-6">
      <nav className="flex min-w-0 items-stretch gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = item.slug === activeSlug;
          return (
            <button
              key={item.slug}
              type="button"
              onClick={() => onSelect(item.slug)}
              title={item.desc}
              className={[
                "group relative flex shrink-0 items-center gap-1 px-2.5 text-[13.5px] transition-colors",
                active ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {item.label}
              {!item.builtin ? (
                <span
                  role="button"
                  aria-label={`删除 ${item.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.slug);
                  }}
                  className="rounded px-0.5 text-[12px] text-ink-faint opacity-0 transition-opacity hover:bg-black/5 hover:text-red-500 group-hover:opacity-100"
                >
                  ×
                </span>
              ) : null}
              {active ? (
                <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center py-1.5">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex h-8 items-center gap-1 rounded-lg bg-accent-soft px-2.5 text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/10"
        >
          ＋ 添加
        </button>
      </div>

      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-[360px] rounded-xl border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-[15px] font-semibold">添加媒体</div>
            <label className="mb-1 block text-[12.5px] text-ink-muted">名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：少数派"
              className="mb-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-accent"
            />
            <label className="mb-1 block text-[12.5px] text-ink-muted">网址</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
              }}
              placeholder="如：sspai.com"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-accent"
            />
            {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setError(null);
                }}
                className="rounded-lg px-3 py-1.5 text-[13px] text-ink-muted hover:bg-black/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitAdd}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
