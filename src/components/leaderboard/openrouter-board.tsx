"use client";

// Spec: 011-ai-leaderboard — OpenRouter 榜单自渲染面板
// 用户决策 (2026-09-23): OpenRouter 官方页面拒绝 iframe 且代理无法激活动态数据层,
// 改用其公开 API (/api/frontend/v1/rankings/models?view=week) 服务端聚合后自渲染。
// 图表: 横向柱状图 Top 15 (长类目优先横向, 见 echarts 规范); 表格: Top 50 全量列示。

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { formatTokens, type OrRankingRow } from "@/domain/or-rankings";

const AXIS = "#888780";
const GRID = "rgba(0, 0, 0, 0.06)";
const BAR = "#2563eb";

export default function OpenRouterBoard({
  rows,
  updatedAt,
  error,
}: {
  rows: OrRankingRow[];
  updatedAt: string | null;
  error: string | null;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const top = useMemo(() => rows.slice(0, 15).reverse(), [rows]);

  useEffect(() => {
    if (!chartRef.current || top.length === 0) return;
    const chart = echarts.init(chartRef.current);
    const option = {
      animation: false,
      grid: { left: 8, right: 70, top: 12, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: AXIS, fontSize: 11, formatter: (v: unknown) => formatTokens(Number(v)) },
        splitLine: { lineStyle: { color: GRID } },
      },
      yAxis: {
        type: "category",
        data: top.map((r) => r.name),
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#2c2c2a", fontSize: 11.5, width: 150, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          data: top.map((r) => r.tokens),
          barMaxWidth: 18,
          itemStyle: { color: BAR, borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            fontSize: 11,
            color: AXIS,
            formatter: (p: unknown) => formatTokens(Number((p as { value?: number }).value ?? 0)),
          },
        },
      ],
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove|click",
        confine: true,
        formatter: (p: unknown) => {
          const item = p as { name?: string; value?: number };
          return `${item.name ?? ""}<br/><b style="font-weight:500">${formatTokens(item.value ?? 0)} tokens</b>`;
        },
      },
    } as unknown as EChartsOption;
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [top]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 text-[12px] text-ink-muted">
        <span>
          OpenRouter 官方公开 API 实时数据{updatedAt ? `，数据截至 ${updatedAt}` : ""}；按真实 token
          用量排名。
        </span>
        <a
          href="https://openrouter.ai/rankings"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium text-accent-deep hover:underline"
        >
          打开官方页面 ↗
        </a>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-8 py-6">
          {error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-[13px] leading-relaxed text-amber-800">
              榜单数据暂不可用（{error}）。可前往
              <a href="https://openrouter.ai/rankings" target="_blank" rel="noreferrer" className="font-medium underline">
                 OpenRouter 官方排名页
              </a>
              查看。
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-5 text-[13px] text-ink-muted">
              暂无数据。
            </div>
          ) : (
            <>
              <h2 className="mb-1 text-[16px] font-semibold">Top 15 模型 · 周 token 用量</h2>
              <p className="mb-4 text-[12px] text-ink-faint">prompt + completion tokens 合计，来源 OpenRouter API。</p>
              <div className="rounded-xl border border-line bg-surface p-4">
                <div ref={chartRef} className="h-[420px] w-full" />
              </div>

              <h2 className="mb-1 mt-8 text-[16px] font-semibold">完整榜单 Top 50</h2>
              <p className="mb-3 text-[12px] text-ink-faint">共 {rows.length} 个模型进入周榜。</p>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-black/[0.02] text-left text-[12px] text-ink-faint">
                      <th className="w-14 px-4 py-2.5 font-medium">排名</th>
                      <th className="px-4 py-2.5 font-medium">模型</th>
                      <th className="w-40 px-4 py-2.5 text-right font-medium">周 tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r) => (
                      <tr key={r.slug} className="border-b border-line/60 last:border-0 hover:bg-black/[0.015]">
                        <td className="px-4 py-2 text-ink-faint">
                          {r.rank <= 3 ? (
                            <span className={["font-semibold", r.rank === 1 ? "text-amber-600" : r.rank === 2 ? "text-slate-500" : "text-orange-700"].join(" ")}>
                              {r.rank}
                            </span>
                          ) : (
                            r.rank
                          )}
                        </td>
                        <td className="px-4 py-2 font-medium text-ink">{r.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{formatTokens(r.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
