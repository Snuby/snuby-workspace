// Spec: 016-nav-modules — 「自媒体」路由组共享外壳
// 顶栏 + SectionTabs 二级菜单两页 (小红书创作中心 / 微信公众号后台), 登录态持久化分区 persist:snuby-creators (D3 定案)。

import Topbar from "@/components/workbench/topbar";
import SectionTabs, { type SectionTab } from "@/components/workbench/section-tabs";

const TABS: readonly SectionTab[] = [
  { href: "/creators/xiaohongshu", label: "小红书创作中心" },
  { href: "/creators/wechat", label: "微信公众号后台" },
];

export default function CreatorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="自媒体" />
      <SectionTabs tabs={TABS} />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </>
  );
}
