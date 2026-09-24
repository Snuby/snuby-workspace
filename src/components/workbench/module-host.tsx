"use client";

// Spec: 017-site-tabs — 模块常驻容器 (跨模块状态保留)
//
// 站点型模块 (自媒体/IT资讯/AI模型榜单/Web访问) 的 SiteBrowser 常驻渲染于此,
// 路由切换只改容器 visibility → 组件不卸载 → webview 实例/页面状态/登录态跨模块保留,
// 切回秒回 (无重载、无白屏)。
//
// - 懒挂载: 模块首次被进入才挂载 (visited), 之后永不卸载 → 首启不预加载全部站点
// - 非站点型页面 (首页/宏观经济/资产行情/设置) 走 children 容器, 正常路由生命周期
// - 容器 visibility:hidden 时内部 webview 不可见但不销毁, 恢复即用

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import CreatorsModule from "@/components/site-browser/modules/creators-module";
import ItNewsModule from "@/components/site-browser/modules/it-news-module";
import LeaderboardModule from "@/components/site-browser/modules/leaderboard-module";
import BrowserModule from "@/components/site-browser/modules/browser-module";

const MODULE_PATHS = ["/creators", "/it-news", "/ai-leaderboard", "/browser"] as const;
const MODULES: { path: string; render: (active: boolean) => React.ReactNode }[] = [
  { path: "/creators", render: (active) => <CreatorsModule active={active} /> },
  { path: "/it-news", render: (active) => <ItNewsModule active={active} /> },
  { path: "/ai-leaderboard", render: (active) => <LeaderboardModule active={active} /> },
  { path: "/browser", render: (active) => <BrowserModule active={active} /> },
];

export default function ModuleHost({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [visited, setVisited] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if ((MODULE_PATHS as readonly string[]).includes(pathname)) {
      setVisited((v) => ({ ...v, [pathname]: true }));
    }
  }, [pathname]);

  const isModule = (MODULE_PATHS as readonly string[]).includes(pathname);

  return (
    <>
      {MODULES.map((m) =>
        visited[m.path] ? (
          <div
            key={m.path}
            style={{ visibility: pathname === m.path ? "visible" : "hidden" }}
            className="absolute inset-0 z-0 overflow-hidden"
          >
            {m.render(pathname === m.path)}
          </div>
        ) : null,
      )}
      {/* 非站点型页面: 首页/宏观经济/资产行情/设置等 */}
      <div
        style={{ visibility: isModule ? "hidden" : "visible" }}
        className="absolute inset-0 z-0 overflow-auto"
      >
        {children}
      </div>
    </>
  );
}
