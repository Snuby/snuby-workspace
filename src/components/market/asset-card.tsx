// Spec: 009-market-quotes — 资产卡 (最新价 / 涨跌 / 迷你走势 / 滞后标注 / 口径说明)
// 纯展示组件; 精度由 asset.precision 驱动, 不做全局统一取整 (design 决策 11)

import { formatPrice, formatPct } from "@/domain/market";
import type { AssetStat } from "@/application/market-service";

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 110;
  const H = 30;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[30px] w-[110px] shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={up ? "#c0392b" : "#0f7b4f"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AssetCard({
  stat,
  children,
}: {
  stat: AssetStat;
  /** 分类页把 K 线图挂进卡片内, 使价格信息与走势同屏 (spec 009 US-2) */
  children?: React.ReactNode;
}) {
  const change = stat.changePct;
  const up = (change ?? 0) >= 0;
  const changeClass = change === null ? "text-ink-faint" : up ? "text-up" : "text-down";
  const year = stat.yearChangePct;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold">{stat.name}</span>
            {stat.stale ? (
              <span
                className="shrink-0 rounded bg-amber-500/10 px-1 py-px text-[10.5px] text-amber-700"
                title={`数据源滞后约 ${stat.lagDays} 天`}
              >
                滞后
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">{stat.unit}</div>
        </div>
        {stat.spark.length > 1 ? <Spark values={stat.spark} up={(year ?? 0) >= 0} /> : null}
      </div>

      <div className="mt-2.5 flex items-end gap-2">
        <div className="text-[21px] font-semibold leading-none tracking-tight">
          {stat.latest ? formatPrice(stat.latest.close, stat.precision) : "—"}
        </div>
        <div className={`pb-0.5 text-[12.5px] font-medium ${changeClass}`}>
          {formatPct(change)}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
        <span>
          近一年{" "}
          <b className={`font-medium ${(year ?? 0) >= 0 ? "text-up" : "text-down"}`}>
            {formatPct(year)}
          </b>
        </span>
        <span>截至 {stat.latest?.date ?? "—"}</span>
      </div>

      {stat.note ? (
        <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-faint">
          {stat.note}
        </p>
      ) : null}

      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
