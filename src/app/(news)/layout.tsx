// Spec: 017-site-tabs — 「IT 资讯」路由组共享外壳
// 标题已移入选项卡栏最左侧 (ItMediaTabs title), 不再渲染顶部 Topbar, 省出一行高度。

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
  );
}
