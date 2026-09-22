// Spec: 010-ai-vc-watch — 「AI 创投观察」路由组共享外壳 (与 (macro)/(market) layout 同构, design 决策 7)
// 顶栏 + 二级菜单 + 抓取按钮 + 新鲜度提示 + 滚动容器; 两个子页只渲染内容。

import Topbar from "@/components/workbench/topbar";
import SectionTabs, { type SectionTab } from "@/components/workbench/section-tabs";
import VcFetchButton from "@/components/vc/vc-fetch-button";
import VcFreshnessHint from "@/components/vc/freshness-hint";
import { VC_SECTIONS } from "@/domain/vc";

const TABS: readonly SectionTab[] = VC_SECTIONS.map((s) => ({ href: s.href, label: s.label }));

export default function VcLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="AI 创投观察" />
      {/* 抓取覆盖全部英文源 (techcrunch + hn), 按钮置于模块层级; 随布局常驻, 切 Tab 不丢进度 */}
      <SectionTabs tabs={TABS} hint={<VcFreshnessHint />} action={<VcFetchButton />} />
      <div className="flex flex-1 flex-col overflow-auto">{children}</div>
    </>
  );
}
