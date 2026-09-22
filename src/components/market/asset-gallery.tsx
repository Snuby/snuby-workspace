"use client";

// Spec: 009-market-quotes — 分类页的 K 线画廊: 统一周期切换 + 批量取数
// 周期/窗口用客户端状态, 变化时并行取各资产的 K 线 (无 OHLC 的资产在图表内部降级折线)

import { useEffect, useState } from "react";
import AssetCard from "./asset-card";
import KLineChart from "./kline-chart";
import PeriodSwitcher from "./period-switcher";
import {
  DEFAULT_PERIOD,
  DEFAULT_RANGE,
  type Candle,
  type Period,
  type Range,
} from "@/domain/market";
import type { AssetStat } from "@/application/market-service";

export default function AssetGallery({ stats }: { stats: AssetStat[] }) {
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [series, setSeries] = useState<Record<string, Candle[]>>({});
  const [loading, setLoading] = useState(true);

  const symbols = stats.map((s) => s.symbol).join(",");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all(
      stats.map((s) =>
        fetch(`/api/market/kline?symbol=${s.symbol}&period=${period}&range=${range}`, {
          signal: controller.signal,
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((body: { candles?: Candle[] } | null) => [s.symbol, body?.candles ?? []] as const)
          .catch(() => [s.symbol, [] as Candle[]] as const),
      ),
    ).then((pairs) => {
      setSeries(Object.fromEntries(pairs) as Record<string, Candle[]>);
      setLoading(false);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, period, range]);

  // 该页全部资产均为月频时 (房产), 禁用日/周粒度 (US-3 AC1)
  const allMonthly = stats.length > 0 && stats.every((s) => s.baseFreq === "M");
  const disabledPeriods: Period[] = allMonthly ? ["D", "W"] : [];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PeriodSwitcher
          period={period}
          range={range}
          onPeriodChange={setPeriod}
          onRangeChange={setRange}
          disabledPeriods={disabledPeriods}
        />
        <div className="text-[11.5px] text-ink-faint">
          {loading ? "载入中…" : `${stats.length} 项资产 · 蜡烛图为涨红跌绿`}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {stats.map((stat) => (
          <AssetCard key={stat.symbol} stat={stat}>
            <KLineChart
              candles={series[stat.symbol] ?? []}
              name={stat.name}
              precision={stat.precision}
              hasOhlc={stat.hasOhlc}
              hasVolume={stat.hasVolume}
              height={280}
            />
          </AssetCard>
        ))}
      </div>
    </>
  );
}
