// Spec: 001-workbench-mvp — 国家经济数据页 (US-2 AC1/AC2/AC3/AC5)

import Topbar from "@/components/workbench/topbar";
import IndicatorCard from "@/components/macro/indicator-card";
import { getMacroDashboard } from "@/application/macro-service";
import { MacroDataError } from "@/infrastructure/sqlite-macro-repository";

export const dynamic = "force-dynamic";

function formatUpdatedAt(iso: string): string {
  return iso.replace("T", " ");
}

export default async function MacroPage() {
  let dashboard;
  try {
    dashboard = await getMacroDashboard();
  } catch (cause) {
    const message =
      cause instanceof MacroDataError
        ? cause.message
        : "读取宏观数据失败";
    return (
      <>
        <Topbar title="国家经济数据" crumb="数据观察" />
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
            <div className="mb-2 text-[15px] font-semibold">数据不可用</div>
            <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
          </div>
        </div>
      </>
    );
  }

  const total = dashboard.sections.reduce((n, s) => n + s.indicators.length, 0);

  return (
    <>
      <Topbar title="国家经济数据" crumb="数据观察" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1240px] px-6 py-7">
          <div className="mb-6 text-[13px] text-ink-faint">
            数据来源: 国家统计局 · 中国人民银行 · 海关总署 · 国家外汇管理局 | 数据更新:{" "}
            {formatUpdatedAt(dashboard.updatedAt)} | 共 {total} 项指标
          </div>

          {dashboard.sections.map(({ group, indicators }) =>
            indicators.length === 0 ? null : (
              <section key={group.id} className="mb-7">
                <h2 className="mb-3 border-l-4 border-accent pl-2.5 text-[15px] font-semibold">
                  {group.label}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
                  {indicators.map((ind) => (
                    <IndicatorCard key={ind.key} indicator={ind} />
                  ))}
                </div>
              </section>
            ),
          )}

          <footer className="mt-8 text-[12px] leading-relaxed text-ink-faint">
            说明: 同比看趋势、环比看拐点；M1-M2 剪刀差反映资金活化；PMI 50 为荣枯线；
            LPR 与 M2/社融反映政策取向，出口与贸易差额反映外需。数据由
            scripts/fetch_data.py 定时抓取入库 (SQLite)，页面每次加载实时读取。
          </footer>
        </div>
      </div>
    </>
  );
}
