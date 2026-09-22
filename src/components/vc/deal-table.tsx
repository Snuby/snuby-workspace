// Spec: 010-ai-vc-watch — 事件流表格 (Server)
// 过滤 (赛道/来源) 与分页走 URL 参数, 保持服务端渲染; 金额双展示: USD 近似 + 原币 tooltip。

import Link from "next/link";
import {
  SECTOR_LABELS,
  SOURCE_LABELS,
  formatMoney,
  formatUsd,
  type Sector,
} from "@/domain/vc";
import type { DealStream } from "@/application/vc-service";

const PAGE_SIZE = 50;

function sectorChips(current: string | null): { key: string; label: string }[] {
  return [
    { key: "all", label: "全部赛道" },
    ...Object.entries(SECTOR_LABELS).map(([key, label]) => ({ key, label })),
  ];
}

function sourceChips(current: string | null): { key: string; label: string }[] {
  return [
    { key: "all", label: "全部来源" },
    ...Object.entries(SOURCE_LABELS).map(([key, label]) => ({ key, label })),
  ];
}

function amountChips(current: number | null): { key: string; label: string; minUsd: number | null }[] {
  return [
    { key: "all", label: "全部金额", minUsd: null },
    { key: "100m", label: "≥ 1 亿美元", minUsd: 1e8 },
    { key: "1b", label: "≥ 10 亿美元", minUsd: 1e9 },
  ];
}

function chipHref(base: Record<string, string>, next: Record<string, string>): string {
  const params = new URLSearchParams(base);
  for (const [k, v] of Object.entries(next)) {
    if (v && v !== "all") params.set(k, v);
    else params.delete(k);
  }
  const q = params.toString();
  return q ? `/ai-vc?${q}` : "/ai-vc";
}

export default function DealTable({
  stream,
  sector,
  source,
  minUsd,
  page,
}: {
  stream: DealStream;
  sector: string | null;
  source: string | null;
  minUsd: number | null;
  page: number;
}) {
  const totalPages = Math.max(1, Math.ceil(stream.total / PAGE_SIZE));
  const base: Record<string, string> = {};
  if (sector && sector !== "all") base.sector = sector;
  if (source && source !== "all") base.source = source;
  if (minUsd !== null) base.minUsd = String(minUsd);
  const pageHref = (p: number) => chipHref(base, { page: String(p) });
  const amountActive = minUsd === 1e8 ? "100m" : minUsd === 1e9 ? "1b" : "all";

  return (
    <div>
      {/* 过滤 chips (URL 驱动, Server 渲染) */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] text-ink-faint">赛道</span>
          {sectorChips(sector).map((c) => {
            const active = (sector ?? "all") === c.key;
            return (
              <Link
                key={c.key}
                href={chipHref(base, { sector: c.key })}
                className={[
                  "rounded-md px-2 py-1 text-[11.5px] transition-colors",
                  active
                    ? "bg-accent-soft font-medium text-accent-deep"
                    : "bg-black/[0.03] text-ink-muted hover:bg-black/[0.06]",
                ].join(" ")}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] text-ink-faint">来源</span>
          {sourceChips(source).map((c) => {
            const active = (source ?? "all") === c.key;
            return (
              <Link
                key={c.key}
                href={chipHref(base, { source: c.key })}
                className={[
                  "rounded-md px-2 py-1 text-[11.5px] transition-colors",
                  active
                    ? "bg-accent-soft font-medium text-accent-deep"
                    : "bg-black/[0.03] text-ink-muted hover:bg-black/[0.06]",
                ].join(" ")}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] text-ink-faint">金额</span>
          {amountChips(minUsd).map((c) => {
            const active = amountActive === c.key;
            return (
              <Link
                key={c.key}
                href={chipHref(base, c.minUsd !== null ? { minUsd: String(c.minUsd) } : { minUsd: "all" })}
                className={[
                  "rounded-md px-2 py-1 text-[11.5px] transition-colors",
                  active
                    ? "bg-accent-soft font-medium text-accent-deep"
                    : "bg-black/[0.03] text-ink-muted hover:bg-black/[0.06]",
                ].join(" ")}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      </div>

      {stream.deals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <div className="text-[14px] font-medium">还没有融资事件</div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            点击右上角「更新融资」抓取英文源，或用下方表单手动录入中文事件。
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-black/[0.02] text-left text-[11px] text-ink-faint">
                <th className="px-4 py-2.5 font-medium">公司 / 事件</th>
                <th className="px-3 py-2.5 font-medium">轮次</th>
                <th className="px-3 py-2.5 font-medium">金额</th>
                <th className="px-3 py-2.5 font-medium">日期</th>
                <th className="px-3 py-2.5 font-medium">赛道</th>
                <th className="px-3 py-2.5 font-medium">来源</th>
              </tr>
            </thead>
            <tbody>
              {stream.deals.map((d) => (
                <tr key={d.id} className="border-b border-line/60 last:border-0 hover:bg-black/[0.015]">
                  <td className="max-w-[340px] px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 font-medium text-ink">{d.company}</span>
                      {d.round ? (
                        <span className="shrink-0 rounded bg-black/[0.05] px-1.5 py-px text-[10.5px] text-ink-muted">
                          {d.round}
                        </span>
                      ) : null}
                    </div>
                    {d.title && d.title !== d.company ? (
                      <div className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-accent hover:underline"
                          >
                            {d.title}
                          </a>
                        ) : (
                          d.title
                        )}
                      </div>
                    ) : null}
                    {d.notes ? (
                      <div className="mt-0.5 truncate text-[11px] text-ink-faint" title={d.notes}>
                        {d.notes}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{d.round ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="font-medium text-ink"
                      title={
                        d.amount !== null
                          ? `原币 ${formatMoney(d.amount, d.currency)}`
                          : "金额未披露"
                      }
                    >
                      {formatUsd(d.amountUsd)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{d.announcedAt}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-ink-muted">
                      {SECTOR_LABELS[d.sector as Sector]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-deep">
                      {SOURCE_LABELS[d.source] ?? d.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {stream.total > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between text-[12px] text-ink-muted">
          <span>
            共 {stream.total} 条 · 第 {page + 1}/{totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            {page > 0 ? (
              <Link
                href={pageHref(page - 1)}
                className="rounded-md bg-black/[0.04] px-2.5 py-1 hover:bg-black/[0.08]"
              >
                上一页
              </Link>
            ) : null}
            {page + 1 < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="rounded-md bg-black/[0.04] px-2.5 py-1 hover:bg-black/[0.08]"
              >
                下一页
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[12px] text-ink-faint">共 {stream.total} 条事件</div>
      )}
    </div>
  );
}
