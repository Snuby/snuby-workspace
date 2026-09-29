"use client";

// 灵活工作台: Topics 全局状态 (配置即数据)
// 侧边栏(主题区) 与 TopicHost(主题页) 共用同一份 topics/sites 状态;
// 所有变更走 /api/topics + /api/sites, 成功后刷新本地状态。
// 语义: Topic = 主题(一级板块) / Site = 主题内站点(选项卡), 与 DB 表一一对应。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Topic = {
  id: string;
  name: string;
  sort: number;
  isPreset: boolean;
  settings: Record<string, unknown>;
  createdAt: number;
};

export type Site = {
  id: string;
  topicId: string;
  url: string;
  label: string;
  sort: number;
  createdAt: number;
};

type TopicsContextValue = {
  topics: Topic[] | null;
  sitesByTopic: Record<string, Site[]>;
  refreshTopics: () => Promise<void>;
  refreshSites: (topicId: string) => Promise<void>;
  createTopic: (name: string) => Promise<string | null>;
  renameTopic: (id: string, name: string) => Promise<boolean>;
  deleteTopic: (id: string) => Promise<boolean>;
  addSite: (topicId: string, url: string, label: string) => Promise<string | null>;
  updateSite: (
    topicId: string,
    siteId: string,
    patch: { url?: string; label?: string },
  ) => Promise<boolean>;
  removeSite: (topicId: string, siteId: string) => Promise<boolean>;
};

const TopicsContext = createContext<TopicsContextValue | null>(null);

export function TopicsProvider({ children }: { children: React.ReactNode }) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [sitesByTopic, setSitesByTopic] = useState<Record<string, Site[]>>({});

  const refreshTopics = useCallback(async () => {
    try {
      const res = await fetch("/api/topics");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.topics)) setTopics(data.topics);
    } catch {
      // 网络/服务不可达: 静默, 保持现有状态
    }
  }, []);

  const refreshSites = useCallback(async (topicId: string) => {
    try {
      const res = await fetch(`/api/sites?topic=${encodeURIComponent(topicId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.sites)) {
        setSitesByTopic((prev) => ({ ...prev, [topicId]: data.sites }));
      }
    } catch {
      // 同上
    }
  }, []);

  useEffect(() => {
    void refreshTopics();
  }, [refreshTopics]);

  const createTopic = useCallback(
    async (name: string) => {
      try {
        const res = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", name }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        await refreshTopics();
        return typeof data.id === "string" ? data.id : null;
      } catch {
        return null;
      }
    },
    [refreshTopics],
  );

  const renameTopic = useCallback(
    async (id: string, name: string) => {
      try {
        const res = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", id, name }),
        });
        if (!res.ok) return false;
        await refreshTopics();
        return true;
      } catch {
        return false;
      }
    },
    [refreshTopics],
  );

  const deleteTopic = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
        if (!res.ok) return false;
        await refreshTopics();
        setSitesByTopic((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    [refreshTopics],
  );

  const addSite = useCallback(
    async (topicId: string, url: string, label: string) => {
      try {
        const res = await fetch("/api/sites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", topicId, url, label }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        await refreshSites(topicId);
        return typeof data.id === "string" ? data.id : null;
      } catch {
        return null;
      }
    },
    [refreshSites],
  );

  const updateSite = useCallback(
    async (topicId: string, siteId: string, patch: { url?: string; label?: string }) => {
      try {
        const res = await fetch("/api/sites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", topicId, siteId, ...patch }),
        });
        if (!res.ok) return false;
        await refreshSites(topicId);
        return true;
      } catch {
        return false;
      }
    },
    [refreshSites],
  );

  const removeSite = useCallback(
    async (topicId: string, siteId: string) => {
      try {
        const res = await fetch("/api/sites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", topicId, siteId }),
        });
        if (!res.ok) return false;
        await refreshSites(topicId);
        return true;
      } catch {
        return false;
      }
    },
    [refreshSites],
  );

  const value = useMemo(
    () => ({
      topics,
      sitesByTopic,
      refreshTopics,
      refreshSites,
      createTopic,
      renameTopic,
      deleteTopic,
      addSite,
      updateSite,
      removeSite,
    }),
    [
      topics,
      sitesByTopic,
      refreshTopics,
      refreshSites,
      createTopic,
      renameTopic,
      deleteTopic,
      addSite,
      updateSite,
      removeSite,
    ],
  );

  // —— IT 资讯自定义媒体一次性迁移: 旧版存 localStorage (snuby:it-media:custom),
  //   topic 化后统一进 sites 表 (topic=it-news)。迁移成功即清 localStorage, 幂等。 ——
  useEffect(() => {
    if (!topics) return;
    const itNews = topics.find((t) => t.id === "it-news");
    if (!itNews) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem("snuby:it-media:custom");
    } catch {
      return;
    }
    if (!raw) return;
    let items: { url?: unknown; label?: unknown }[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return;
    }
    if (items.length === 0) return;
    void (async () => {
      for (const it of items) {
        if (typeof it.url !== "string" || !it.url) continue;
        await addSite("it-news", it.url, typeof it.label === "string" ? it.label : "");
      }
      try {
        localStorage.removeItem("snuby:it-media:custom");
      } catch {
        // 忽略
      }
    })();
  }, [topics, addSite]);

  return <TopicsContext.Provider value={value}>{children}</TopicsContext.Provider>;
}

export function useTopics(): TopicsContextValue {
  const v = useContext(TopicsContext);
  if (!v) throw new Error("useTopics 必须在 TopicsProvider 内使用");
  return v;
}
