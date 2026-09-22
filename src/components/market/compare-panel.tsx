"use client";

// Spec: 009-market-quotes — 综合对比面板: 资产勾选 + 周期切换 + 归一化合并图
// 周期/窗口为纯客户端状态, 变更时按需向后端取对比数据 (聚合与归一化在服务端完成)

import { useEffect, useRef, useState } from "react";
import AssetPicker from "./asset-picker";
import NormalizedChart from "./normalized-chart";
import PeriodSwitcher from "./period-switcher";
import type { AssetMeta, Period, Range } from "@/domain/market";
import type { ComparisonResult } from "@/application/market-service";

export default function ComparePanel({
  metas,
  initial,
}: {
  metas: AssetMeta[];
  initial: ComparisonResult;
}) {
  const [selected, setSelected] = useState<string[]>([...initial.symbols]);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [range, setRange] = useState<Range>(initial.range);
  const [data, setData] = useState<ComparisonResult>(initial);
  const [loading, setLoading] = useState(false);
  const skipFirst = useRef(true);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false; // 首屏已由服务端渲染, 不重复取数
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ symbols: selected.join(","), period, range });
    setLoading(true);
    fetch(`/api/market/compare?${query}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((next: ComparisonResult | null) => {
        if (next) setData(next);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => controller.abort();
  }, [selected, period, range]);

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <PeriodSwitcher
          period={period}
          range={range}
          onPeriodChange={setPeriod}
          onRangeChange={setRange}
        />
        <div className="text-[11.5px] text-ink-faint">
          {loading ? "更新中…" : `${data.dates.length} 个数据点 · ${data.symbols.length} 项资产`}
        </div>
      </div>

      <div className="px-4 pt-3.5">
        <AssetPicker metas={metas} selected={selected} onChange={setSelected} />
      </div>

      <div className="px-2 pb-1 pt-1">
        <NormalizedChart
          dates={data.dates}
          series={data.series}
          metas={data.metas}
          bases={data.bases}
        />
      </div>

      <div className="border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-faint">
        归一化口径：各资产以自身基准日收盘价折算为 100，图中数值即「相对基准日的涨跌倍数」，故纵轴可直接横向比较强弱。
        日期轴取所选资产交易日的并集，非交易日沿用前一收盘价（前向填充）；某资产在其基准日之前的区间保持断线，不用回填值伪造历史。
        图例中标注「自 YYYY-MM-DD」者，表示该资产起始晚于区间起点、另取了自身首个数据日为基准。
      </div>
    </div>
  );
}
