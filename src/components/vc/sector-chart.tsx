"use client";

// Spec: 010-ai-vc-watch — 赛道分布图 (Client, ECharts)
// 计数/金额双口径内部切换; 横向柱 Top 12; 金额口径在标题标注「近似换算」。
// ECharts 惰性初始化 (009 I4 教训): init 与 setOption 合并进同一 effect, 否则空数据首帧永久空白。

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { SECTOR_LABELS, formatUsd } from "@/domain/vc";
import type { StatsItem } from "@/application/vc-service";

const AXIS = "#888780";
const BAR = "#185FA5";
const OTHER = "#c9c7bf";

export default function SectorChart({ items }: { items: StatsItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"count" | "amount">("count");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    const labels = items.map((i) => SECTOR_LABELS[i.key as keyof typeof SECTOR_LABELS] ?? i.key);
    const values = items.map((i) => (mode === "count" ? i.count : Math.round(i.amountUsd)));

    const option: EChartsOption = {
      title: {
        text: mode === "count" ? "赛道分布（事件数）" : "赛道分布（融资额，近似换算）",
        textStyle: { fontSize: 13, fontWeight: 600, color: "#2c2c2a" },
        left: 0,
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        triggerOn: "mousemove|click",
        renderMode: "richText",
        confine: true,
        axisPointer: { type: "shadow" },
        valueFormatter: (v) =>
          mode === "count" ? `${v} 条` : formatUsd(Number(v ?? 0)),
      },
      grid: { left: 8, right: 20, top: 34, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        name: mode === "count" ? "事件数" : "融资额 (USD)",
        nameTextStyle: { color: AXIS, fontSize: 11 },
        axisLabel: {
          color: AXIS,
          fontSize: 11,
          formatter: (v: number) =>
            mode === "count" ? String(v) : formatUsd(v).replace("$", ""),
        },
        splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#2c2c2a", fontSize: 11.5 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: values.map((v) => ({
            value: v,
            itemStyle: { color: v === 0 ? OTHER : BAR, borderRadius: [0, 4, 4, 0] },
          })),
          barMaxWidth: 18,
          label: {
            show: true,
            position: "right",
            fontSize: 10.5,
            color: "#5f5e5a",
            formatter: (p) => (mode === "count" ? `${p.value} 条` : formatUsd(Number(p.value))),
          },
        },
      ],
    };

    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [items, mode]);

  if (items.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-[12.5px] text-ink-faint">
        暂无数据，抓取或录入后展示赛道分布
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => setMode("count")}
          className={[
            "rounded-md px-2 py-1 text-[11.5px] transition-colors",
            mode === "count"
              ? "bg-accent-soft font-medium text-accent-deep"
              : "bg-black/[0.03] text-ink-muted hover:bg-black/[0.06]",
          ].join(" ")}
        >
          事件数
        </button>
        <button
          type="button"
          onClick={() => setMode("amount")}
          className={[
            "rounded-md px-2 py-1 text-[11.5px] transition-colors",
            mode === "amount"
              ? "bg-accent-soft font-medium text-accent-deep"
              : "bg-black/[0.03] text-ink-muted hover:bg-black/[0.06]",
          ].join(" ")}
        >
          融资额
        </button>
      </div>
      <div ref={ref} className="h-[300px] w-full" />
    </div>
  );
}
