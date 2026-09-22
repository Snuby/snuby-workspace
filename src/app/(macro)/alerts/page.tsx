// Spec: 002-macro-alerts — 跟踪提醒页 (US-2: 统计条 + 三段状态列表)
// Spec: 008-macro-hierarchy — 外壳由「宏观经济」布局提供; 新增模块自述 (US-4)

import { getAlertsReport, type AlertView } from "@/application/alert-service";
import { MacroDataError } from "@/infrastructure/sqlite-macro-repository";

export const dynamic = "force-dynamic";

const SEVERITY_BAR: Record<string, string> = {
  danger: "bg-red-500",
  warning: "bg-amber-500",
};

const STATUS_LABEL: Record<string, string> = {
  triggered: "触发中",
  normal: "正常",
  no_data: "无数据",
};

function AlertRow({ item }: { item: AlertView }) {
  const isTriggered = item.status === "triggered";
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-line bg-surface px-4 py-3">
      <span
        className={[
          "mt-0.5 h-9 w-1 shrink-0 rounded-full",
          isTriggered ? SEVERITY_BAR[item.severity] : "bg-black/10",
        ].join(" ")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold">{item.label}</span>
          <span className="text-[12px] text-ink-faint">{item.indicatorName}</span>
          {item.lag !== null ? (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-600">
              数据源滞后 {item.lag} 个月
            </span>
          ) : null}
          {isTriggered ? (
            <span
              className={[
                "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                item.severity === "danger"
                  ? "bg-red-50 text-red-600"
                  : "bg-amber-50 text-amber-600",
              ].join(" ")}
            >
              {item.severity === "danger" ? "严重" : "关注"}
            </span>
          ) : null}
        </div>
        <p
          className={[
            "mt-1 text-[12.5px] leading-relaxed",
            isTriggered ? "text-ink" : "text-ink-faint",
          ].join(" ")}
        >
          {item.message}
        </p>
      </div>
    </div>
  );
}

export default async function AlertsPage() {
  let report;
  try {
    report = await getAlertsReport();
  } catch (cause) {
    const message =
      cause instanceof MacroDataError ? cause.message : "读取宏观数据失败";
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">数据不可用</div>
          <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
        </div>
      </div>
    );
  }

  const { summary, items } = report;
  const groups: Array<{ status: string; label: string; items: AlertView[] }> = [
    { status: "triggered", label: "触发中", items: items.filter((i) => i.status === "triggered") },
    { status: "normal", label: "正常", items: items.filter((i) => i.status === "normal") },
    { status: "no_data", label: "无数据", items: items.filter((i) => i.status === "no_data") },
  ];

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      {/* Spec 008 US-4: 模块自述 —— 首次进入就知道这一栏在做什么 */}
      <p className="mb-5 text-[12.5px] leading-relaxed text-ink-muted">
        这一栏把「数据」变成「判断」：用代码里预置的规则，对你已入库的指标最新数据点做实时评估，
        分三类 ——
        <b className="font-medium text-ink">阈值</b>（如 PMI 跌破 50 荣枯线）、
        <b className="font-medium text-ink">异动</b>（如出口单月环比骤降）、
        <b className="font-medium text-ink">相对比较</b>（如 M1 增速低于 M2，资金未活化）。
        触发项即为当前值得留意的地方；本模块不推送通知，每次进入页面重新评估。
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-faint">
        <span>
          触发中 <b className="text-ink">{summary.triggered}</b> 项
        </span>
        <span className="text-red-600">严重 {summary.danger}</span>
        <span className="text-amber-600">关注 {summary.warning}</span>
        <span>· 正常 {summary.normal} 项 · 无数据 {summary.noData} 项</span>
        <span>| 数据更新: {report.updatedAt.replace("T", " ")}</span>
      </div>

      {groups.map(
        ({ status, label, items: groupItems }) =>
          groupItems.length > 0 && (
            <section key={status} className="mb-6">
              <h2 className="mb-2.5 text-[13.5px] font-semibold">
                {label}
                <span className="ml-1.5 text-[12px] font-normal text-ink-faint">
                  {groupItems.length} 项
                </span>
              </h2>
              <div className="flex flex-col gap-2">
                {groupItems.map((item) => (
                  <AlertRow key={item.ruleId} item={item} />
                ))}
              </div>
            </section>
          ),
      )}

      <footer className="mt-8 text-[12px] leading-relaxed text-ink-faint">
        说明: 规则为代码内预置（spec 002 design.md 规则表），基于数据库最新两个数据点实时评估，
        无推送通知；阈值口径与依据见规则表 rationale 字段。
      </footer>
    </div>
  );
}
