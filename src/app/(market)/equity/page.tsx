// Spec: 009-market-quotes — 股票指数页 (四个指数同页, 便于跨市场对比 — design 决策 7)

import MarketCategoryPage from "@/components/market/category-page";

export const dynamic = "force-dynamic";

export default function EquityPage() {
  return (
    <MarketCategoryPage
      categories={["us", "hk", "cn"]}
      title="股票指数"
      description="道琼斯、纳斯达克、恒生指数与上证指数四大市场的代表性指数。各市场交易日与假期不同，做合并对比时按日期并集对齐、非交易日沿用前一收盘价。"
    />
  );
}
