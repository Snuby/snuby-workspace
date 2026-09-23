// Spec: 017-site-tabs — 「自媒体」路由组共享外壳
// 标题已移入站点选项卡栏最左侧 (SiteBrowser title), 不再渲染顶部 Topbar。

export default function CreatorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
  );
}
