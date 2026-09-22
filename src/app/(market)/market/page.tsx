// Spec: 009-market-quotes — 综合对比页 (US-4 核心: 跨资产归一化合并图 + 全部资产卡)

import AssetCard from "@/components/market/asset-card";
import ComparePanel from "@/components/market/compare-panel";
import { getComparison, getMarketOverview } from "@/application/market-service";
import { MarketDataError } from "@/infrastructure/sqlite-market-repository";
import { DEFAULT_COMPARE_SYMBOLS } from "@/domain/market";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  let overview;
  let comparison;
  try {
    [overview, comparison] = await Promise.all([
      getMarketOverview(),
      getComparison([...DEFAULT_COMPARE_SYMBOLS]),
    ]);
  } catch (cause) {
    const message = cause instanceof MarketDataError ? cause.message : "读取行情数据失败";
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">数据不可用</div>
          <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
        </div>
      </div>
    );
  }

  const staleCount = overview.assets.filter((a) => a.stale).length;
  const updatedLabel = overview.updatedAt.slice(0, 16).replace("T", " ");

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
      <header className="mb-5">
        <h1 className="text-[17px] font-semibold">综合对比</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          {overview.assets.length} 项资产归一化到同一基准，直接比较相对强弱。
          抓取于 {updatedLabel}
          {staleCount > 0 ? `，其中 ${staleCount} 项数据源滞后（见卡片标注）` : ""}。
        </p>
      </header>

      <ComparePanel metas={overview.assets} initial={comparison} />

      <section className="mt-8">
        <h2 className="mb-3 text-[13.5px] font-semibold">全部资产</h2>
        {overview.sections.map((section) => (
          <div key={section.id} className="mb-5">
            <h3 className="mb-2 text-[12px] font-medium text-ink-faint">{section.label}</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {section.assets.map((stat) => (
                <AssetCard key={stat.symbol} stat={stat} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
