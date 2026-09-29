"use client";

// 灵活工作台: 主题常驻容器 (TopicHost, 原 ModuleHost 泛化)
// - /topic/{id}: 访问过的主题 SiteBrowser 常驻渲染, 路由切换只改容器可见性
//   → webview 实例/页面状态/登录态跨主题保留, 切回秒回 (无重载、无白屏)
// - /browser: Web 访问 (地址栏模式) 特殊保留 (自由浏览+站点发现), 同样常驻
// - 其余页面 (首页/设置等): children 容器, 正常路由生命周期
// ★ 容器可见性一律用 opacity + pointer-events (绝不用 visibility: 会分离 webview
//   guest, 恢复后真实鼠标输入失效, 实测复现); 隐藏层 pe:none 不拦截下层点击。
// 站点配置实时从 /api/sites 读取: 用户增删站点后全局状态刷新 → 本容器重新注入 SiteBrowser。

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import SiteBrowser from "@/components/site-browser/site-browser";
import { useTopics } from "@/components/workbench/topics-context";

const BROWSER_PATH = "/browser";
const BROWSER_HOME = [{ id: "default", label: "主页", url: "https://www.google.com/" }];
const TOPIC_RE = /^\/topic\/([^/]+)$/;

export default function TopicHost({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { topics, sitesByTopic, refreshSites } = useTopics();
  const [visitedTopics, setVisitedTopics] = useState<Record<string, boolean>>({});

  const topicMatch = TOPIC_RE.exec(pathname ?? "");
  const topicId = topicMatch ? topicMatch[1] : null;
  const isBrowser = pathname === BROWSER_PATH;

  // 懒挂载: 主题首次被进入才挂载, 之后永不卸载
  useEffect(() => {
    if (topicId) setVisitedTopics((v) => ({ ...v, [topicId]: true }));
    if (isBrowser) setVisitedTopics((v) => ({ ...v, [BROWSER_PATH]: true }));
  }, [topicId, isBrowser]);

  // 进入主题时拉取/刷新其站点配置
  useEffect(() => {
    if (topicId) void refreshSites(topicId);
  }, [topicId, refreshSites]);

  const visitedList = Object.keys(visitedTopics).filter(
    (id) => id !== BROWSER_PATH || true,
  );

  const isSitePage =
    (topicId !== null && !!visitedTopics[topicId]) ||
    (isBrowser && !!visitedTopics[BROWSER_PATH]);

  return (
    <>
      {visitedList.map((id) => {
        if (id === BROWSER_PATH) {
          const active = pathname === BROWSER_PATH;
          return (
            <div
              key={id}
              style={{
                opacity: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
                // 激活主题容器显式置顶: Electron webview 命中测试不完全遵循
                // pointer-events, 隐藏层即使 opacity:0 也可能拦截真实鼠标 →
                // 激活层 z-index 提升, 命中从最顶层开始, 隐藏层全部沉底
                zIndex: active ? 10 : 0,
              }}
              className="absolute inset-0 z-0 overflow-hidden"
            >
              <SiteBrowser
                moduleKey="browser"
                sites={BROWSER_HOME}
                addressMode
                title="Web 访问"
                active={active}
              />
            </div>
          );
        }
        const active = pathname === `/topic/${id}`;
        const sites = (sitesByTopic[id] ?? []).map((s) => ({
          id: s.id,
          label: s.label,
          url: s.url,
        }));
        const name = topics?.find((t) => t.id === id)?.name ?? id;
        return (
          <div
            key={id}
            style={{
              opacity: active ? 1 : 0,
              pointerEvents: active ? "auto" : "none",
              zIndex: active ? 10 : 0,
            }}
            className="absolute inset-0 z-0 overflow-hidden"
          >
            <SiteBrowser moduleKey={id} sites={sites} title={name} active={active} />
          </div>
        );
      })}
      {/* 非站点型页面: 首页/设置等 */}
      <div
        style={{
          opacity: isSitePage ? 0 : 1,
          pointerEvents: isSitePage ? "none" : "auto",
          zIndex: isSitePage ? 0 : 10,
        }}
        className="absolute inset-0 z-0 overflow-auto"
      >
        {children}
      </div>
    </>
  );
}
