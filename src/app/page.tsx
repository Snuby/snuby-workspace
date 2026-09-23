// Spec: 001-workbench-mvp — 工作台首页 (US-1 AC3); 卡片摘要见 spec 002 US-3
// Spec: 008-macro-hierarchy — 三个数据模块收敛到「宏观经济」, 卡片计数由用例层实际范围推导 (US-3 AC3)
// Spec: 009-market-quotes — 新增「资产行情」卡片
// Spec: 011-ai-leaderboard — 新增「AI 模型榜单」卡片 (纯链接, 无数据库依赖)

import Link from "next/link";
import Topbar from "@/components/workbench/topbar";
import { getAlertsDigest, type AlertSummary, type AlertView } from "@/application/alert-service";
import { getIndustryDashboard, getNationalDashboard } from "@/application/macro-service";
import { getMarketOverview } from "@/application/market-service";

export const dynamic = "force-dynamic";

function AlertsCard({ summary, topItems }: { summary: AlertSummary | null; topItems: AlertView[] }) {
  const hasData = summary !== null;
  return (
    <Link
      href="/alerts"
      className="rounded-xl border border-line bg-surface p-5 transition hover:-translate-y-px hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FAEEDA]">
          <svg viewBox="0 0 24 24" fill="none" stroke="#854F0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </div>
        <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10.5px] text-ink-faint">
          宏观经济
        </span>
      </div>
      <div className="mb-1.5 text-[14.5px] font-semibold">跟踪提醒</div>
      {!hasData ? (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          数据不可用，请先更新数据。
        </p>
      ) : summary.triggered > 0 ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            当前触发 <b className="text-ink">{summary.triggered}</b> 项异动
            {summary.danger > 0 ? (
              <span className="ml-1 text-red-600">（严重 {summary.danger}）</span>
            ) : null}
          </p>
          <ul className="mt-2 space-y-1">
            {topItems.map((item) => (
              <li key={item.ruleId} className="flex items-center gap-1.5 text-[12.5px]">
                <span
                  className={[
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    item.severity === "danger" ? "bg-red-500" : "bg-amber-500",
                  ].join(" ")}
                />
                <span className="truncate text-ink">{item.label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          一切正常，{summary.normal} 项指标均在阈值内。
        </p>
      )}
      <span className="mt-3 inline-block rounded-md bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
        查看详情
      </span>
    </Link>
  );
}

export default async function HomePage() {
  let digest: Awaited<ReturnType<typeof getAlertsDigest>> | null = null;
  try {
    digest = await getAlertsDigest();
  } catch {
    digest = null; // DB 缺失时卡片降级提示, 不影响首页
  }

  // 数据卡片的计数由用例层实际范围推导, 不硬编码 (spec 008 US-3 AC3)
  let national: { count: number; staleCount: number } | null = null;
  try {
    const dashboard = await getNationalDashboard();
    national = {
      count: dashboard.sections.reduce((n, s) => n + s.indicators.length, 0),
      staleCount: dashboard.staleCount,
    };
  } catch {
    national = null;
  }

  let industry: { count: number; latestMonth: string | null } | null = null;
  try {
    const dashboard = await getIndustryDashboard();
    const items = dashboard.sections.flatMap((s) => s.indicators);
    industry = {
      count: items.length,
      latestMonth: items.map((i) => i.latest?.date ?? "").filter(Boolean).sort().pop() ?? null,
    };
  } catch {
    industry = null;
  }

  let market: { count: number; latestDate: string | null; staleCount: number } | null = null;
  try {
    const overview = await getMarketOverview();
    market = {
      count: overview.assets.length,
      latestDate:
        overview.assets
          .map((a) => a.lastDate ?? "")
          .filter(Boolean)
          .sort()
          .pop() ?? null,
      staleCount: overview.assets.filter((a) => a.stale).length,
    };
  } catch {
    market = null;
  }

  return (
    <>
      <Topbar title="工作台" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-8 py-10">
          <h1 className="text-[21px] font-semibold">下午好，苏伟杰</h1>
          <p className="mt-1.5 mb-7 text-[13px] text-ink-faint">
            左侧四个板块：<b className="font-medium text-ink-muted">宏观经济</b>（国家经济数据 / 行业观察 /
            跟踪提醒）、<b className="font-medium text-ink-muted">资产行情</b>（跨资产 K 线与归一化对比）与{" "}
            <b className="font-medium text-ink-muted">AI 模型榜单</b>（Artificial Analysis 官网原页
            + OpenRouter 官方实时排名），
            也可以从下方卡片直接进入。
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            <Link
              href="/macro"
              className="rounded-xl border border-line bg-surface p-5 transition hover:-translate-y-px hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#185FA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M3 3v18h18" />
                    <path d="M7 14l4-5 3 3 5-7" />
                  </svg>
                </div>
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                  宏观经济
                </span>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">国家经济数据</div>
              {national ? (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  中国宏观经济大盘：GDP、物价、PMI、货币社融、进出口、房地产等{" "}
                  <b className="font-medium text-ink">{national.count}</b> 项核心指标，手动更新、实时读库。
                  {national.staleCount > 0 ? (
                    <span className="text-amber-600">
                      其中 {national.staleCount} 项数据源滞后。
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  数据不可用，请点击「更新数据」抓取。
                </p>
              )}
              <span className="mt-3 inline-block rounded-md bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                进入模块
              </span>
            </Link>

            <Link
              href="/industry"
              className="rounded-xl border border-line bg-surface p-5 transition hover:-translate-y-px hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E1F5EE]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M3 21h18" />
                    <path d="M4 21V9l5 3V9l5 3V7l6 4v10" />
                  </svg>
                </div>
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                  宏观经济
                </span>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">行业观察</div>
              {industry ? (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  {industry.count} 项行业与高频指标：用电量、货运量、客座率、物流景气、大宗商品与建材价格
                  {industry.latestMonth ? `，最新期 ${industry.latestMonth}` : ""}。
                </p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  数据不可用，请先更新数据。
                </p>
              )}
              <span className="mt-3 inline-block rounded-md bg-[#E1F5EE] px-2 py-0.5 text-[11px] text-[#0F6E56]">
                进入模块
              </span>
            </Link>

            <AlertsCard summary={digest?.summary ?? null} topItems={digest?.topItems ?? []} />

            <Link
              href="/market"
              className="rounded-xl border border-line bg-surface p-5 transition hover:-translate-y-px hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEEDFE]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#534AB7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M6 3v3" />
                    <path d="M6 18v3" />
                    <rect x="4" y="6" width="4" height="12" rx="1" />
                    <path d="M17 2v5" />
                    <path d="M17 17v5" />
                    <rect x="15" y="7" width="4" height="10" rx="1" />
                  </svg>
                </div>
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                  资产行情
                </span>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">综合对比</div>
              {market ? (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  黄金、白银、加密货币、美股、中国香港股与 A 股指数、京沪房价共{" "}
                  <b className="font-medium text-ink">{market.count}</b> 项资产，支持日/周/月/年 K 线，
                  并归一化到同一基准比较相对走势。
                  {market.latestDate ? `数据最新 ${market.latestDate}。` : ""}
                </p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  数据不可用，请点击「更新行情」抓取。
                </p>
              )}
              <span className="mt-3 inline-block rounded-md bg-[#EEEDFE] px-2 py-0.5 text-[11px] text-[#534AB7]">
                进入模块
              </span>
            </Link>

            <Link
              href="/ai-leaderboard"
              className="rounded-xl border border-line bg-surface p-5 transition hover:-translate-y-px hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E3EEF9]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#1F5E8E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M8 21h8" />
                    <path d="M12 17v4" />
                    <path d="M7 4h10" />
                    <path d="M17 4v8a5 5 0 0 1-10 0V4" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                </div>
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                  AI 模型榜单
                </span>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">权威榜单</div>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                桌面版内嵌官网原页（Artificial Analysis 独立评测 / OpenRouter 真实用量排名）；
                网页版保持 iframe 与官方 API 自渲染降级。零本地数据。
              </p>
              <span className="mt-3 inline-block rounded-md bg-[#E3EEF9] px-2 py-0.5 text-[11px] text-[#1F5E8E]">
                进入模块
              </span>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
