"use client";

// Spec: 009-market-quotes — 合并图资产勾选器 (US-4 AC2: 至少 1 个, 至多全部)
// 分类一键勾选: 点分类标签整组选中/取消, 「全部」一键勾满; 资产 chip 仍可单独增减
// 布局为单行流式 (2026-09-22 用户反馈): 分类标签内联在其资产 chip 前, 避免垂直分布浪费空间

import { ASSET_CATEGORIES, ASSET_COLORS, type AssetMeta } from "@/domain/market";

export default function AssetPicker({
  metas,
  selected,
  onChange,
}: {
  metas: AssetMeta[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const symbols = metas.map((m) => m.symbol);

  function toggle(symbol: string) {
    if (selected.includes(symbol)) {
      if (selected.length <= 1) return; // 至少保留 1 个
      onChange(selected.filter((s) => s !== symbol));
      return;
    }
    // 保持 metas 顺序, 图例/取数顺序稳定
    onChange(symbols.filter((s) => s === symbol || selected.includes(s)));
  }

  function toggleCategory(catSymbols: string[]) {
    const allActive = catSymbols.every((s) => selected.includes(s));
    if (allActive) {
      const remaining = selected.filter((s) => !catSymbols.includes(s));
      if (remaining.length === 0) return; // 至少保留 1 个
      onChange(remaining);
      return;
    }
    const next = new Set(selected);
    for (const s of catSymbols) next.add(s);
    onChange(symbols.filter((s) => next.has(s)));
  }

  function selectAll() {
    onChange([...symbols]);
  }

  const allActive = metas.length > 0 && metas.every((m) => selected.includes(m.symbol));

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      <button
        type="button"
        onClick={selectAll}
        disabled={allActive}
        title={allActive ? "已全部选中" : "一键选中全部资产"}
        className={[
          "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
          allActive
            ? "cursor-not-allowed border-transparent bg-accent-deep/[0.08] font-medium text-accent-deep"
            : "border-line font-medium text-ink hover:border-accent-deep/40 hover:text-accent-deep",
        ].join(" ")}
      >
        全部
      </button>

      {ASSET_CATEGORIES.map((cat) => {
        const group = metas.filter((m) => cat.symbols.includes(m.symbol));
        if (group.length === 0) return null;
        const groupSymbols = group.map((m) => m.symbol);
        const allGroupActive = groupSymbols.every((s) => selected.includes(s));
        const noneGroupActive = groupSymbols.every((s) => !selected.includes(s));
        const groupLocked = allGroupActive && selected.length <= groupSymbols.length;
        return (
          <div key={cat.id} className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleCategory(groupSymbols)}
              disabled={groupLocked}
              title={groupLocked ? "至少保留一个资产" : allGroupActive ? "取消整组" : "选中整组"}
              aria-pressed={allGroupActive}
              className={[
                "rounded-md px-1.5 py-0.5 text-[11.5px] transition-colors",
                allGroupActive
                  ? "bg-black/[0.06] font-semibold text-ink"
                  : noneGroupActive
                    ? "text-ink-faint hover:bg-black/[0.03] hover:text-ink"
                    : "bg-black/[0.03] font-medium text-ink-muted hover:text-ink", // 组内部分选中
              ].join(" ")}
            >
              {cat.label}
            </button>
            {group.map((m) => {
              const active = selected.includes(m.symbol);
              const color = ASSET_COLORS[m.symbol] ?? "#5f5e5a";
              const locked = active && selected.length <= 1;
              return (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => toggle(m.symbol)}
                  aria-pressed={active}
                  disabled={locked}
                  title={locked ? "至少保留一个资产" : undefined}
                  className={[
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                    active
                      ? "border-transparent font-medium"
                      : "border-line text-ink-muted hover:border-line hover:text-ink",
                    locked ? "cursor-not-allowed opacity-70" : "",
                  ].join(" ")}
                  style={active ? { backgroundColor: `${color}1f`, color } : undefined}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: active ? color : "rgba(0,0,0,0.18)" }}
                  />
                  {m.name}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
