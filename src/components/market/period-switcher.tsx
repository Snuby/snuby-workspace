"use client";

// Spec: 009-market-quotes — 粒度(日/周/月/年) + 时间窗口 切换器
// 两个正交维度: 粒度决定一根 K 线代表多长时间, 窗口决定展示跨度 (design 决策 5)

import { PERIODS, RANGES, type Period, type Range } from "@/domain/market";

function segmentClass(active: boolean, disabled: boolean): string {
  return [
    "rounded-md px-2.5 py-1 text-[12.5px] transition-colors",
    disabled
      ? "cursor-not-allowed text-ink-faint/50"
      : active
        ? "bg-surface font-semibold text-accent-deep"
        : "text-ink-muted hover:text-ink",
  ].join(" ");
}

export default function PeriodSwitcher({
  period,
  range,
  onPeriodChange,
  onRangeChange,
  disabledPeriods = [],
  disabledHint = "该资产为月频数据，不支持此粒度",
}: {
  period: Period;
  range: Range;
  onPeriodChange: (period: Period) => void;
  onRangeChange: (range: Range) => void;
  disabledPeriods?: readonly Period[];
  disabledHint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-0.5 rounded-lg bg-black/[0.04] p-0.5">
        {PERIODS.map((p) => {
          const disabled = disabledPeriods.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              title={disabled ? disabledHint : undefined}
              onClick={() => {
                if (!disabled) onPeriodChange(p.id);
              }}
              className={segmentClass(period === p.id, disabled)}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-black/[0.04] p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onRangeChange(r.id)}
            className={segmentClass(range === r.id, false)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
