// Spec: 016-nav-modules — 「IT 资讯」路由组共享外壳 (与 (leaderboard) 同构)
// 顶栏 + 内容容器; 选项卡为客户端状态 (页面内渲染), 故 layout 只负责外壳。

import Topbar from "@/components/workbench/topbar";

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="IT 资讯" />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </>
  );
}
