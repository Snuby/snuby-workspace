// Spec: 001-workbench-mvp — 指标卡 (US-2 AC2)

import type { IndicatorView } from "@/application/macro-service";
import TrendChart from "@/components/macro/trend-chart";

function formatValue(value: number, unit: string): string {
  const abs = Math.abs(value);
  const num = abs >= 10000 ? value.toLocaleString("zh-CN") : String(value);
  return `${num}${unit}`;
}

export default function IndicatorCard({ indicator }: { indicator: IndicatorView }) {
  const { name, unit, freq, description, trend, latest, lag } = indicator;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-semibold">{name}</span>
        <span className="text-[18px] font-semibold text-accent-deep">
          {latest ? formatValue(latest.value, unit) : "—"}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <span>{latest ? `最新: ${latest.date} · ${freq}` : "暂无数据"}</span>
        {lag !== null ? (
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-600">
            数据源滞后 {lag} 个月
          </span>
        ) : null}
      </div>
      <div className="mt-2.5">
        {trend.length > 1 ? (
          <TrendChart
            dates={trend.map((p) => p.date)}
            values={trend.map((p) => p.value)}
            unit={unit}
          />
        ) : (
          <div className="flex h-[150px] items-center justify-center text-[12px] text-ink-faint">
            数据不足，无法绘图
          </div>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">{description}</p>
    </div>
  );
}
