// Spec: 008-macro-hierarchy — 「宏观经济」路由组共享外壳 (design 决策 1/2/4)
// 顶栏 + 二级菜单 + 滚动容器在此统一定义, 三个子页只渲染内容。

import Topbar from "@/components/workbench/topbar";
import SectionTabs from "@/components/workbench/section-tabs";
import FetchButton from "@/components/macro/fetch-button";

export default function MacroLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="宏观经济" />
      {/* 抓取为整个 36 项指标的全量动作, 故按钮置于模块层级而非某个 Tab 内 (design 决策 4) */}
      <SectionTabs action={<FetchButton />} />
      <div className="flex flex-1 flex-col overflow-auto">{children}</div>
    </>
  );
}
