// Spec: 009-market-quotes — 房产页 (月频 + 无 OHLC, 触发折线降级与粒度禁用)

import MarketCategoryPage from "@/components/market/category-page";

export const dynamic = "force-dynamic";

export default function RealEstatePage() {
  return (
    <MarketCategoryPage
      categories={["realestate"]}
      title="房产"
      description="北京、上海新建商品住宅价格指数（70 城口径，环比连乘构造，起点 2011-01 = 100）。该序列衡量价格变动幅度，不是成交均价（「192.7」不代表 19.27 万元/平米）；数据为月度粒度，故不支持日/周切换。"
    />
  );
}
