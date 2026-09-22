"use client";

// Spec: 009-market-quotes — 单资产 K 线图
// 有 OHLC → 蜡烛图; 无 OHLC (房价) → 折线降级, 不伪造「一字」蜡烛 (design 决策 6)
// 有成交量 → 主图下方渲染量副图; 无 → 不渲染副图也不留空白 (US-2 AC4)
// 蜡烛与量柱均遵循中国习惯「红涨绿跌」(design 决策 9)

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { Candle } from "@/domain/market";

const UP = "#c0392b";
const DOWN = "#0f7b4f";
const LINE = "#185FA5";
const AXIS = "#888780";
const GRID = "rgba(0, 0, 0, 0.06)";

function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return String(Math.round(v));
}

type Params = {
  candles: Candle[];
  name: string;
  precision: number;
  hasOhlc: boolean;
  hasVolume: boolean;
};

function buildOption({ candles, name, precision, hasOhlc, hasVolume }: Params): EChartsOption {
  const dates = candles.map((c) => c.date);
  const num = (v: number | null) => (v === null ? "—" : v.toFixed(precision));
  const showVolume = hasVolume && candles.some((c) => c.volume !== null && c.volume > 0);

  const series: Array<Record<string, unknown>> = [];

  if (hasOhlc) {
    series.push({
      name,
      type: "candlestick",
      // ECharts 的蜡烛数据顺序是 [open, close, low, high] — 与 OHLC 直觉顺序不同, 写反会静默畸变
      data: candles.map((c) => [c.open, c.close, c.low, c.high]),
      itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
      barMaxWidth: 14,
    });
  } else {
    series.push({
      name,
      type: "line",
      data: candles.map((c) => c.close),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.6, color: LINE },
      itemStyle: { color: LINE },
      areaStyle: { color: "rgba(24, 95, 165, 0.08)" },
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: "rgba(0,0,0,0.18)", type: "dashed", width: 1 },
        data: [{ yAxis: candles[0]?.close ?? 0 }],
        label: { formatter: "起点", color: AXIS, fontSize: 11 },
      },
    });
  }

  if (showVolume) {
    series.push({
      name: "成交量",
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: candles.map((c, i) => ({
        value: c.volume,
        itemStyle: {
          color: i > 0 && candles[i].close < candles[i - 1].close ? DOWN : UP,
          opacity: 0.55,
        },
      })),
      barMaxWidth: 14,
    });
  }

  const grids = showVolume
    ? [
        { left: 66, right: 22, top: 24, height: "52%" },
        { left: 66, right: 22, top: "72%", height: "13%" },
      ]
    : [{ left: 66, right: 22, top: 24, bottom: 52 }];

  const xAxis = grids.map((_, i) => ({
    type: "category" as const,
    gridIndex: i,
    data: dates,
    boundaryGap: true,
    axisLine: { lineStyle: { color: GRID } },
    axisTick: { show: false },
    axisLabel: {
      show: i === grids.length - 1,
      color: AXIS,
      fontSize: 11,
      hideOverlap: true,
    },
    splitLine: { show: false },
  }));

  const yAxis = grids.map((_, i) => ({
    type: "value" as const,
    gridIndex: i,
    scale: true,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: AXIS,
      fontSize: 11,
      formatter: (v: number) => (i === 0 ? num(v) : compact(v)),
    },
    splitLine: { lineStyle: { color: GRID } },
    splitNumber: i === 0 ? 5 : 2,
  }));

  const xAxisIndex = grids.map((_, i) => i);
  // dataZoom 默认展示全时间段 (2026-09-22 用户决策): 滑块仅用于手动缩放, 不预裁窗口
  const start = 0;

  // ECharts 的联合类型对字面量推断过于苛刻, 此处经 unknown 中转后断言 (非 any)
  return {
    animation: false,
    grid: grids,
    xAxis,
    yAxis,
    series,
    axisPointer: { link: [{ xAxisIndex }], label: { backgroundColor: "#5f5e5a" } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(255,255,255,0.97)",
      borderColor: "rgba(0,0,0,0.1)",
      borderWidth: 0.5,
      textStyle: { color: "#2c2c2a", fontSize: 12 },
      formatter: (raw: unknown) => {
        const list = Array.isArray(raw) ? raw : [raw];
        const first = list[0] as { dataIndex: number } | undefined;
        if (!first) return "";
        const idx = first.dataIndex;
        const c = candles[idx];
        if (!c) return "";
        const prev = idx > 0 ? candles[idx - 1] : null;
        const chg = prev && prev.close !== 0 ? (c.close / prev.close - 1) * 100 : null;

        const rows: string[] = [`<div style="font-weight:500;margin-bottom:4px">${c.date}</div>`];
        if (hasOhlc) {
          rows.push(`<div>开 ${num(c.open)}　高 ${num(c.high)}</div>`);
          rows.push(`<div>低 ${num(c.low)}　收 ${num(c.close)}</div>`);
        } else {
          rows.push(`<div>值 ${num(c.close)}</div>`);
        }
        if (chg !== null) {
          const color = chg >= 0 ? UP : DOWN;
          rows.push(
            `<div>涨跌 <span style="color:${color}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span></div>`,
          );
        }
        if (c.volume !== null) rows.push(`<div>量 ${compact(c.volume)}</div>`);
        return rows.join("");
      },
    },
    dataZoom: [
      { type: "inside", xAxisIndex, start, end: 100 },
      {
        type: "slider",
        xAxisIndex,
        height: 16,
        bottom: 6,
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

export default function KLineChart({
  candles,
  name,
  precision,
  hasOhlc,
  hasVolume,
  height = 280,
}: Params & { height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const option = useMemo(
    () => buildOption({ candles, name, precision, hasOhlc, hasVolume }),
    [candles, name, precision, hasOhlc, hasVolume],
  );

  // 挂载首帧 candles 可能为空 (画廊先渲染载入态), 图表 div 尚不在 DOM 中;
  // 若初始化只依赖 [] 会在首帧空跑且不再重试, 导致数据到达后图表永久空白。
  // 因此把「初始化 + setOption」合并进同一 effect, 数据到达后惰性补初始化。
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

  if (candles.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-[12.5px] text-ink-faint"
      >
        该区间无数据
      </div>
    );
  }

  return <div ref={ref} style={{ height }} className="w-full" />;
}
