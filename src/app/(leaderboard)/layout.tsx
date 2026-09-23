// Spec: 017-site-tabs — 「AI 模型榜单」路由组共享外壳
// 标题已移入站点选项卡栏最左侧 (SiteBrowser title), 不再渲染顶部 Topbar。
// 内容容器用 overflow-hidden: webview 是独立滚动上下文, 外层滚动会导致双滚动条。

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
  );
}
