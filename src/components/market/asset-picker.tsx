"use client";

// Spec: 009-market-quotes — 合并图资产勾选器 (US-4 AC2: 至少 1 个, 至多全部)

import { ASSET_COLORS, type AssetMeta } from "@/domain/market";

export default function AssetPicker({
  metas,
  selected,
  onChange,
}: {
  metas: AssetMeta[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(symbol: string) {
    if (selected.includes(symbol)) {
      if (selected.length <= 1) return; // 至少保留 1 个
      onChange(selected.filter((s) => s !== symbol));
      return;
    }
    onChange([...selected, symbol]);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {metas.map((m) => {
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
}
