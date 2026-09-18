"use client";

// Spec: 001-workbench-mvp — ECharts 趋势图封装 (US-2 AC2)
// 只收纯数据 props, 内部不做数据加工 (docs/conventions.md 代码风格 #4)
// 注: 使用 echarts 完整包导入 — 按需导入 (echarts/core) 在 Turbopack 下存在模块初始化兼容问题

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type Props = {
  dates: string[];
  values: number[];
  unit: string;
};

export default function TrendChart({ dates, values, unit }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      grid: { left: 8, right: 8, top: 10, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis",
        confine: true,
        valueFormatter: (v: unknown) => `${v as number}${unit}`,
      },
      xAxis: {
        type: "category",
        data: dates,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(0,0,0,0.1)" } },
        axisLabel: { color: "#888780", fontSize: 10, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
        axisLabel: { color: "#888780", fontSize: 10 },
      },
      series: [
        {
          type: "line",
          data: values,
          symbol: "none",
          lineStyle: { color: "#185FA5", width: 2 },
          areaStyle: { color: "rgba(24,95,165,0.08)" },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [dates, values, unit]);

  return <div ref={ref} className="h-[150px] w-full" />;
}
