// Spec: 009-market-quotes — 分类页共享实现 (四个分类页只传类别与文案, 避免四份重复)

import AssetGallery from "./asset-gallery";
import { getMarketOverview } from "@/application/market-service";
import { MarketDataError } from "@/infrastructure/sqlite-market-repository";
import type { AssetCategory } from "@/domain/market";

export default async function MarketCategoryPage({
  categories,
  title,
  description,
}: {
  categories: readonly AssetCategory[];
  title: string;
  description: string;
}) {
  let stats;
  try {
    const overview = await getMarketOverview();
    stats = overview.assets.filter((a) => categories.includes(a.category));
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

  return (
    <div className="mx-auto w-full max-w-[980px] px-6 py-7">
      <header className="mb-5">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{description}</p>
      </header>

      {stats.length === 0 ? (
        <p className="text-[13px] text-ink-faint">该分类暂无资产数据，请先更新行情。</p>
      ) : (
        <AssetGallery stats={stats} />
      )}
    </div>
  );
}
