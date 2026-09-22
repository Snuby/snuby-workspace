// Spec: 009-market-quotes — 加密货币页

import MarketCategoryPage from "@/components/market/category-page";

export const dynamic = "force-dynamic";

export default function CryptoPage() {
  return (
    <MarketCategoryPage
      categories={["crypto"]}
      title="加密货币"
      description="比特币、以太坊、狗狗币对 USDT 日线（Binance）。7×24 交易，无休市日；价格波动显著大于其他资产类别。"
    />
  );
}
