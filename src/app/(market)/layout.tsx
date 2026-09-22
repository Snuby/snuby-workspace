// Spec: 009-market-quotes — 「资产行情」路由组共享外壳 (与 (macro)/layout 同构, design 决策 7)
// 顶栏 + 二级菜单 + 滚动容器统一定义, 五个子页只渲染内容。

import Topbar from "@/components/workbench/topbar";
import SectionTabs, { type SectionTab } from "@/components/workbench/section-tabs";
import MarketFetchButton from "@/components/market/market-fetch-button";
import FreshnessHint from "@/components/market/freshness-hint";
import { MARKET_SECTIONS } from "@/domain/market";

const TABS: readonly SectionTab[] = MARKET_SECTIONS.map((s) => ({ href: s.href, label: s.label }));

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="资产行情" />
      {/* 抓取为全部 11 个资产的全量动作, 故按钮置于模块层级; 随布局常驻, 切 Tab 不丢进度。
          左侧提示数据管道更新到哪一天, 落后时标出天数 (spec 009)。 */}
      <SectionTabs
        tabs={TABS}
        hint={<FreshnessHint />}
        action={<MarketFetchButton />}
      />
      <div className="flex flex-1 flex-col overflow-auto">{children}</div>
    </>
  );
}
