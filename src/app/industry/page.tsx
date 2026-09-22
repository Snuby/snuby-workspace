// Spec: 005-industry-watch — 行业观察页 (US-2)

import Topbar from "@/components/workbench/topbar";
import IndicatorCard from "@/components/macro/indicator-card";
import { getIndustryDashboard } from "@/application/macro-service";
import { MacroDataError } from "@/infrastructure/sqlite-macro-repository";

export const dynamic = "force-dynamic";

export default async function IndustryPage() {
  let dashboard;
  try {
    dashboard = await getIndustryDashboard();
  } catch (cause) {
    const message = cause instanceof MacroDataError ? cause.message : "读取行业数据失败";
    return (
      <>
        <Topbar title="行业观察" crumb="数据观察" />
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
            <div className="mb-2 text-[15px] font-semibold">数据不可用</div>
            <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
          </div>
        </div>
      </>
    );
  }

  const indicators = dashboard.sections.flatMap((s) => s.indicators);
  const latestMonth = indicators
    .map((i) => i.latest?.date ?? "")
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <>
      <Topbar title="行业观察" crumb="数据观察" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1240px] px-6 py-7">
          <div className="mb-6 text-[13px] text-ink-faint">
            数据来源: 中国物流与采购联合会 · 交通运输部 · 中电联 · 东方财富 | 数据更新:{" "}
            {dashboard.updatedAt.replace("T", " ")} | 共 {indicators.length} 项指标
            {latestMonth ? ` | 最新期: ${latestMonth}` : ""}
            {dashboard.staleCount > 0 ? (
              <span className="ml-1 text-amber-600">
                （其中 {dashboard.staleCount} 项数据源滞后，见卡片标注）
              </span>
            ) : null}
          </div>

          {dashboard.sections.map(({ group, indicators: items }) => (
            <section key={group.id} className="mb-7">
              <h2 className="mb-3 border-l-4 border-accent pl-2.5 text-[15px] font-semibold">
                {group.label}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
                {items.map((ind) => (
                  <IndicatorCard key={ind.key} indicator={ind} />
                ))}
              </div>
            </section>
          ))}

          <footer className="mt-8 text-[12px] leading-relaxed text-ink-faint">
            说明: 以实物量与价格口径观察行业景气，与「国家经济数据」互补。用电量、货运量、客座率为月度官方数据；
            大宗商品、农产品、建材指数为日频源，按每月最后一个观测值月末采样，使近 36 期窗口统一为 36 个月。
          </footer>
        </div>
      </div>
    </>
  );
}
