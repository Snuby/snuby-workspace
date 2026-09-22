// Spec: 009-market-quotes — 房产页 (月频 + 无 OHLC, 触发折线降级与粒度禁用)

import MarketCategoryPage from "@/components/market/category-page";

export const dynamic = "force-dynamic";

export default function RealEstatePage() {
  return (
    <MarketCategoryPage
      categories={["realestate"]}
      title="房产"
      description="北京、上海二手住宅价格指数（国家统计局 70 城口径，环比连乘构造，起点 2011-01 = 100）。采用二手住宅而非新建商品住宅：新房口径受高端盘集中入市的结构效应主导，上海新房指数 2026-08 仍创历史新高，与存量市场体感严重背离；二手房同质可比性更好，上海自 2023-03 峰值回撤 11.9%、北京自 2023-04 峰值回撤 15.3%。指数本身只表达价格变动幅度、不是成交均价，故每张卡片另标注中指研究院「二手住宅样本均价」作为绝对价位锚点。数据为月度粒度，不支持日/周切换。"
    />
  );
}
