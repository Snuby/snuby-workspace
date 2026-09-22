// Spec: 009-market-quotes — 贵金属页

import MarketCategoryPage from "@/components/market/category-page";

export const dynamic = "force-dynamic";

export default function MetalPage() {
  return (
    <MarketCategoryPage
      categories={["metal"]}
      title="贵金属"
      description="COMEX 黄金与白银期货主力连续，单位美元/盎司，数据自 2016-09 起。外盘期货源不含成交量，故不渲染量副图。"
    />
  );
}
