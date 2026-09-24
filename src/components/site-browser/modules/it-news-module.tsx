"use client";

// Spec: 017-site-tabs — IT 资讯模块 (常驻容器用)
// 结构: 媒体选项卡 (内置 7 家 + 自定义, 见 ItMediaTabs) + 站内标签页容器 (SiteBrowser)。
// 站点层由 ItMediaTabs 外部渲染 (hideSiteBar + 受控 activeSite);
// 每个媒体 = 一个站点组, 站内标签页/历史/配置由 SiteBrowser 统一管理 (SQLite 持久化)。

import { useEffect, useMemo, useState } from "react";
import ItMediaTabs from "@/components/news/it-media-tabs";
import SiteBrowser from "@/components/site-browser/site-browser";
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

export default function ItNewsModule({ active: moduleActive }: { active?: boolean }) {
  const [custom, setCustom] = useState<MediaItem[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(BUILTIN_IT_MEDIA[0].slug);

  useEffect(() => {
    setCustom(loadCustom());
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

  const siteDefs = items.map((m) => ({ id: m.slug, label: m.label, url: m.url }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ItMediaTabs title="IT 资讯" items={items} activeSlug={active.slug} onSelect={select} onAdd={add} onRemove={remove} />
      <div className="min-h-0 flex-1">
        <SiteBrowser
          moduleKey="it-news"
          sites={siteDefs}
          hideSiteBar
          activeSite={active.slug}
          onActiveSiteChange={select}
          active={moduleActive}
        />
      </div>
    </div>
  );
}
