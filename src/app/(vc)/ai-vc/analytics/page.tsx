// Spec: 010-ai-vc-watch — 分析页 (US-5): 赛道分布 + 月度趋势
// 服务端取聚合, 图表组件 Client 渲染; 数据覆盖说明如实标注 (design 八节风险缓解)

import SectorChart from "@/components/vc/sector-chart";
import MonthlyTrend from "@/components/vc/monthly-trend";
import { getVcStats } from "@/application/vc-service";
import { VcDataError } from "@/infrastructure/sqlite-vc-repository";

export const dynamic = "force-dynamic";

export default async function VcAnalyticsPage() {
  let sectorStats;
  let monthStats;
  try {
    [sectorStats, monthStats] = await Promise.all([getVcStats("sector"), getVcStats("month")]);
  } catch (cause) {
    const message = cause instanceof VcDataError ? cause.message : "读取创投统计失败";
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">数据不可用</div>
          <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
        </div>
      </div>
    );
  }

  const totalAmount = monthStats.items.reduce((n, i) => n + i.amountUsd, 0);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
      <header className="mb-5">
        <h1 className="text-[17px] font-semibold">分析</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          {monthStats.period} · 赛道口径按关键词规则自动归类（未命中归「未分类」）；
          金额为 USD 近似换算，未披露事件不计入金额。中文事件目前依赖手动录入，覆盖偏英文源。
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-5">
          <SectorChart items={sectorStats.items} />
        </section>
        <section className="rounded-xl border border-line bg-surface p-5">
          <MonthlyTrend items={monthStats.items} totalAmount={totalAmount} />
        </section>
      </div>
    </div>
  );
}
