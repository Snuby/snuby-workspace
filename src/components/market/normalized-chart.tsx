"use client";

// Spec: 009-market-quotes — 跨资产归一化合并图
// 归一化 = 基准点 100 的指数化 (保留涨跌幅语义, 非 min-max) — design 决策 3
// 日期轴取并集 + 前向填充; 各曲线起点之前为 null, 断线不连接 — design 决策 4
// 曲线颜色表达「资产身份」(分类色), 与涨跌色语义分离 — design 决策 10

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { ASSET_COLORS, NORMALIZE_BASE, type AssetMeta } from "@/domain/market";

const AXIS = "#888780";
const GRID = "rgba(0, 0, 0, 0.06)";
const FALLBACK = "#5f5e5a";

type Params = {
  dates: string[];
  series: Record<string, Array<number | null>>;
  metas: AssetMeta[];
  bases: Record<string, string>;
};

function buildOption({ dates, series, metas, bases }: Params): EChartsOption {
  const visible = metas.filter((m) => (series[m.symbol] ?? []).length > 0);
  const firstDate = dates[0];
  const start = dates.length > 200 ? 55 : 0;

  const datasets = visible.map((m) => {
    const color = ASSET_COLORS[m.symbol] ?? FALLBACK;
    return {
      name: m.name,
      type: "line" as const,
      data: series[m.symbol],
      showSymbol: false,
      connectNulls: false, // 起点之前与缺失处保持断线
      lineStyle: { width: 1.8, color },
      itemStyle: { color },
      emphasis: { focus: "series" as const },
    };
  });

  if (datasets.length > 0) {
    Object.assign(datasets[0], {
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: "rgba(0,0,0,0.22)", type: "dashed", width: 1 },
        data: [{ yAxis: NORMALIZE_BASE }],
        label: {
          formatter: `基准 ${NORMALIZE_BASE}`,
          color: AXIS,
          fontSize: 11,
          position: "insideStartTop",
        },
      },
    });
  }

  // ECharts 联合类型对字面量推断过于苛刻, 此处断言 (非 any)
  return {
    animation: false,
    grid: { left: 58, right: 24, top: 20, bottom: 76 },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
    },
    series: datasets,
    legend: {
      bottom: 0,
      type: "scroll",
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 12, color: "#5f5e5a" },
      // 各资产起始日期不同, 基准日与区间起点不一致者就地标注 (US-4 AC7)
      formatter: (name: string) => {
        const meta = visible.find((m) => m.name === name);
        if (!meta) return name;
        const base = bases[meta.symbol];
        return base && base !== firstDate ? `${name}（自 ${base}）` : name;
      },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      backgroundColor: "rgba(255,255,255,0.97)",
      borderColor: "rgba(0,0,0,0.1)",
      borderWidth: 0.5,
      textStyle: { color: "#2c2c2a", fontSize: 12 },
      formatter: (raw: unknown) => {
        const list = Array.isArray(raw) ? raw : [raw];
        const rows = list
          .filter((p) => {
            const v = (p as { value: unknown }).value;
            return typeof v === "number";
          })
          .sort((a, b) => (b as { value: number }).value - (a as { value: number }).value)
          .map((p) => {
            const item = p as { marker: string; seriesName: string; value: number };
            return `<div style="display:flex;justify-content:space-between;gap:14px">
              <span>${item.marker}${item.seriesName}</span>
              <b style="font-weight:500">${item.value.toFixed(1)}</b></div>`;
          });
        const title = (list[0] as { axisValue?: string } | undefined)?.axisValue ?? "";
        return `<div style="font-weight:500;margin-bottom:4px">${title}</div>${rows.join("")}`;
      },
    },
    dataZoom: [
      { type: "inside", start, end: 100 },
      {
        type: "slider",
        height: 16,
        bottom: 34,
        start,
        end: 100,
        borderColor: "transparent",
        fillerColor: "rgba(24, 95, 165, 0.08)",
        handleStyle: { color: "#b5d4f4" },
        textStyle: { color: AXIS, fontSize: 10 },
      },
    ],
  } as unknown as EChartsOption;
}

export default function NormalizedChart({
  dates,
  series,
  metas,
  bases,
  height = 380,
}: Params & { height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const option = useMemo(
    () => buildOption({ dates, series, metas, bases }),
    [dates, series, metas, bases],
  );

  // 与 KLineChart 同一套惰性初始化: 首帧 dates 可能为空, div 不在 DOM;
  // 初始化与 setOption 合并进同一 effect, 数据到达后补初始化, 避免图表永久空白。
  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) {
      const chart = echarts.init(ref.current);
      chartRef.current = chart;
      const onResize = () => chartRef.current?.resize();
      window.addEventListener("resize", onResize);
      resizeRef.current = onResize;
    }
    chartRef.current.setOption(option, true);
  }, [option]);

  useEffect(
    () => () => {
      if (resizeRef.current) window.removeEventListener("resize", resizeRef.current);
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    [],
  );

  if (dates.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-[12.5px] text-ink-faint"
      >
        所选资产在该区间无数据
      </div>
    );
  }

  return <div ref={ref} style={{ height }} className="w-full" />;
}
