"use client";

// 灵活工作台常驻壳:
// - /topic/{id} 主题 SiteBrowser
// - /browser Web 访问
// - /lab/local-agent 本地 Agent
// - /matrix/{platformId} 自媒体账号矩阵平台页
// 可见性一律 opacity + pointer-events, 切回不重载 webview。

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import SiteBrowser from "@/components/site-browser/site-browser";
import LocalAgentPanel from "@/components/site-browser/local-agent-panel";
import MatrixPlatformView from "@/components/matrix/matrix-platform-view";
import { useTopics } from "@/components/workbench/topics-context";

const BROWSER_PATH = "/browser";
const LAB_PATH = "/lab/local-agent";
const BROWSER_HOME = [{ id: "default", label: "主页", url: "https://www.google.com/" }];
const TOPIC_RE = /^\/topic\/([^/]+)$/;
const MATRIX_RE = /^\/matrix\/([^/]+)$/;

export default function TopicHost({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { topics, sitesByTopic, refreshSites } = useTopics();
  const [visited, setVisited] = useState<Record<string, boolean>>({});

  const topicMatch = TOPIC_RE.exec(pathname ?? "");
  const topicId = topicMatch ? topicMatch[1] : null;
  const matrixMatch = MATRIX_RE.exec(pathname ?? "");
  const matrixPlatformId = matrixMatch ? matrixMatch[1] : null;
  const isBrowser = pathname === BROWSER_PATH;
  const isLab = pathname === LAB_PATH || (pathname?.startsWith("/lab/") ?? false);
  const isMatrix = !!matrixPlatformId;

  useEffect(() => {
    if (topicId) setVisited((v) => ({ ...v, [`topic:${topicId}`]: true }));
    if (isBrowser) setVisited((v) => ({ ...v, [BROWSER_PATH]: true }));
    if (isLab) setVisited((v) => ({ ...v, [LAB_PATH]: true }));
    if (matrixPlatformId) setVisited((v) => ({ ...v, [`matrix:${matrixPlatformId}`]: true }));
  }, [topicId, isBrowser, isLab, matrixPlatformId]);

  useEffect(() => {
    if (topicId) void refreshSites(topicId);
  }, [topicId, refreshSites]);

  const visitedKeys = Object.keys(visited);

  const isPersistentPage =
    (topicId !== null && !!visited[`topic:${topicId}`]) ||
    (isBrowser && !!visited[BROWSER_PATH]) ||
    (isLab && !!visited[LAB_PATH]) ||
    (isMatrix && !!visited[`matrix:${matrixPlatformId}`]);

  return (
    <>
      {visitedKeys.map((key) => {
        if (key === BROWSER_PATH) {
          const active = pathname === BROWSER_PATH;
          return (
            <div
              key={key}
              style={{
                opacity: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
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
        if (key === LAB_PATH) {
          const active = isLab;
          return (
            <div
              key={key}
              style={{
                opacity: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
                zIndex: active ? 10 : 0,
              }}
              className="absolute inset-0 z-0 overflow-hidden"
            >
              <LocalAgentPanel />
            </div>
          );
        }
        if (key.startsWith("matrix:")) {
          const pid = key.slice("matrix:".length);
          const active = pathname === `/matrix/${pid}`;
          return (
            <div
              key={key}
              style={{
                opacity: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
                zIndex: active ? 10 : 0,
              }}
              className="absolute inset-0 z-0 overflow-hidden"
            >
              <MatrixPlatformView platformId={pid} active={active} />
            </div>
          );
        }
        if (key.startsWith("topic:")) {
          const id = key.slice("topic:".length);
          const active = pathname === `/topic/${id}`;
          const sites = (sitesByTopic[id] ?? []).map((s) => ({
            id: s.id,
            label: s.label,
            url: s.url,
          }));
          const name = topics?.find((t) => t.id === id)?.name ?? id;
          return (
            <div
              key={key}
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
        }
        return null;
      })}
      <div
        style={{
          opacity: isPersistentPage ? 0 : 1,
          pointerEvents: isPersistentPage ? "none" : "auto",
          zIndex: isPersistentPage ? 0 : 10,
        }}
        className="absolute inset-0 z-0 overflow-auto"
      >
        {children}
      </div>
    </>
  );
}
