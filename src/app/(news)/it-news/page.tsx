"use client";

// Spec: 016-nav-modules — IT 资讯页 (D2 定案: 单路由 + 客户端选项卡)
// 状态: 内置集(静态) + 自定义集(localStorage, 桌面/Web 两端一致, 无需 IPC, design §2.2)
// 内容区: 桌面版 webview 内嵌 / Web 版 iframe + 外链兜底 (FR-5)

import { useEffect, useMemo, useState } from "react";
import ItMediaTabs from "@/components/news/it-media-tabs";
import WebviewFrame from "@/components/leaderboard/webview-frame";
import LeaderboardFrame from "@/components/leaderboard/leaderboard-frame";
import { BUILTIN_IT_MEDIA, mergeMedia, type MediaItem } from "@/domain/it-media";

const CUSTOM_KEY = "snuby:it-media:custom";

function loadCustom(): MediaItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v: unknown): v is MediaItem =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as MediaItem).slug === "string" &&
        typeof (v as MediaItem).label === "string" &&
        typeof (v as MediaItem).url === "string",
    );
  } catch {
    return [];
  }
}

export default function ItNewsPage() {
  const [custom, setCustom] = useState<MediaItem[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(BUILTIN_IT_MEDIA[0].slug);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCustom(loadCustom());
    setHydrated(true);
  }, []);

  const items = useMemo(() => mergeMedia(BUILTIN_IT_MEDIA, custom), [custom]);
  const active = items.find((m) => m.slug === activeSlug) ?? items[0];

  function select(slug: string) {
    setActiveSlug(slug);
  }

  function add(item: MediaItem) {
    const next = [...custom, item];
    setCustom(next);
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    } catch {
      // 存储失败不阻塞会话内使用
    }
    setActiveSlug(item.slug);
  }

  function remove(slug: string) {
    const next = custom.filter((m) => m.slug !== slug);
    setCustom(next);
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    } catch {
      // 同上
    }
    if (activeSlug === slug) {
      setActiveSlug(items[0].slug);
    }
  }

  if (!hydrated) {
    // SSR/首帧: 与桌面版首帧一致渲染内置集默认页, 避免 hydration 不匹配
    return (
      <WebviewFrame
        src={BUILTIN_IT_MEDIA[0].url}
        title="IT 资讯"
        fallback={
          <LeaderboardFrame
            src={BUILTIN_IT_MEDIA[0].url}
            title={BUILTIN_IT_MEDIA[0].label}
            externalUrl={BUILTIN_IT_MEDIA[0].url}
          />
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ItMediaTabs items={items} activeSlug={active.slug} onSelect={select} onAdd={add} onRemove={remove} />
      <div className="min-h-0 flex-1">
        <WebviewFrame
          src={active.url}
          title={`${active.label} — IT 资讯`}
          fallback={
            <LeaderboardFrame
              src={active.url}
              title={active.label}
              externalUrl={active.url}
            />
          }
        />
      </div>
    </div>
  );
}
