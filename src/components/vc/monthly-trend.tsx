"use client";

// Spec: 010-ai-vc-watch — 月度融资趋势 (Client, ECharts)
// 柱=事件数 (左轴), 线=融资额 USD 近似 (右轴), 双轴必须显式绑定 yAxisIndex (009 教训)。
// 惰性初始化: init 与 setOption 合并进同一 effect。

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { formatUsd } from "@/domain/vc";
import type { StatsItem } from "@/application/vc-service";

const AXIS = "#888780";
const BAR = "rgba(24, 95, 165, 0.65)";
const LINE = "#c0392b";

export default function MonthlyTrend({
  items,
  totalAmount,
}: {
  items: StatsItem[];
  totalAmount: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (items.length === 0) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    const chart = echarts.init(el);
    const months = items.map((i) => i.key);
    const counts = items.map((i) => i.count);
    const amounts = items.map((i) => Math.round(i.amountUsd));

    const option: EChartsOption = {
      title: {
        text: "月度融资趋势（事件数 + 融资额）",
        textStyle: { fontSize: 13, fontWeight: 600, color: "#2c2c2a" },
        left: 0,
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        triggerOn: "mousemove|click",
        renderMode: "richText",
        confine: true,
      },
      legend: {
        data: ["事件数", "融资额 (近似)"],
        top: 24,
        left: 0,
        textStyle: { fontSize: 11, color: "#5f5e5a" },
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 8, right: 8, top: 56, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { color: AXIS, fontSize: 10.5 },
        axisLine: { lineStyle: { color: "rgba(0,0,0,0.1)" } },
      },
      yAxis: [
        {
          type: "value",
          name: "事件数",
          nameTextStyle: { color: AXIS, fontSize: 10.5 },
          axisLabel: { color: AXIS, fontSize: 10.5 },
          splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
        },
        {
          type: "value",
          name: "USD",
          nameTextStyle: { color: AXIS, fontSize: 10.5 },
          axisLabel: {
            color: AXIS,
            fontSize: 10.5,
            formatter: (v: number) => formatUsd(v).replace("$", ""),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "事件数",
          type: "bar",
          yAxisIndex: 0,
          data: counts,
          barMaxWidth: 22,
          itemStyle: { color: BAR, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "融资额 (近似)",
          type: "line",
          yAxisIndex: 1,
          data: amounts,
          showSymbol: true,
          symbolSize: 5,
          lineStyle: { width: 2, color: LINE },
          itemStyle: { color: LINE },
          label: {
            show: true,
            position: "top",
            fontSize: 9.5,
            color: "#5f5e5a",
            formatter: (p) => formatUsd(Number(p.value)),
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
  }, [items]);

  if (empty || items.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-[12.5px] text-ink-faint">
        暂无数据，抓取或录入后展示月度趋势
      </div>
    );
  }

  return (
    <div>
      <div ref={ref} className="h-[320px] w-full" />
      <p className="mt-1 text-[11px] text-ink-faint">
        累计融资额（近似换算，未披露不计入）{formatUsd(totalAmount)}
      </p>
    </div>
  );
}
