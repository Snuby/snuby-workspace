"use client";

// Spec: 017-site-tabs — 通用站点容器 (SiteBrowser)
// 任何以站点形式打开内容的模块统一使用: 站点选项卡(或地址栏) + 站内标签页 + 工具栏。
// 站内标签页: 每站点一组, 主页(官网)常驻不可关, 其余可关/可切换/可淘汰 (上限 maxTabs);
// 关闭的标签进历史 (上限 maxHistory, 可重开); 配置在设置页按模块独立维护 (SQLite)。
// 桌面版(Electron) 渲染 <webview>; 非 Electron 渲染外链兜底 (Web 版不再维护)。

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTopics } from "@/components/workbench/topics-context";
import LocalAgentPanel from "@/components/site-browser/local-agent-panel";

export type SiteDef = {
  /** 站点唯一 id (同一模块内) */
  id: string;
  label: string;
  url: string;
  /** 自媒体等需要持久登录态的分区 (如 persist:snuby-creators) */
  partition?: string;
};

export type SiteTab = {
  id: string;
  url: string;
  title: string;
  /** 加载失败标记 (did-fail-load) */
  error?: boolean;
};

export type SiteHistoryEntry = {
  url: string;
  title: string;
  closedAt: number;
};

type SiteSettings = { maxTabs: number; maxHistory: number; activeSite?: string | null };
type TabView = { siteId: string; tabId: string };

const HOME_SUFFIX = "::home";
const LOADING_DOT = "…";

/** 线性 SVG 图标 (lucide 风格, 与侧边栏菜单图标一致: 24 viewBox / stroke 2 / round) */
function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: className ?? "h-[15px] w-[15px]",
      "aria-hidden": "true",
    },
    children,
  );
}
const IconBack = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>
);
const IconForward = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);
const IconReload = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);
const IconInfo = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Icon>
);
const IconHistory = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </Icon>
);
const IconX = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
const IconAdd = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);

function isElectronEnv() {
  return typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
}

function homeTab(site: SiteDef): SiteTab {
  return { id: `${site.id}${HOME_SUFFIX}`, url: site.url, title: site.label };
}

export default function SiteBrowser({
  moduleKey,
  sites,
  addressMode = false,
  hideSiteBar = false,
  activeSite: activeSiteProp,
  onActiveSiteChange,
  title,
  active = true,
}: {
  moduleKey: string;
  sites: SiteDef[];
  /** 地址栏模式 (Web 访问): 无站点选项卡, 全局单组 'default', 主页=首个站点 */
  addressMode?: boolean;
  /** 站点层由外部渲染 (如 IT 资讯的媒体选项卡); 此时 activeSite 必须受控传入 */
  hideSiteBar?: boolean;
  /** 受控: 当前站点 id (hideSiteBar 时必须) */
  activeSite?: string;
  onActiveSiteChange?: (id: string) => void;
  /** 模块标题: 渲染在站点栏/地址栏最左侧 (加粗); 替代顶部 Topbar, 省出一行高度 */
  title?: string;
  /** 模块是否激活 (常驻容器跨模块切换时传入): false 时强制隐藏本模块全部 webview,
   *  因 webview guest 图层不随父容器 visibility 继承 (内部标签 div 显式 visible 会覆盖
   *  容器 hidden), 必须直接作用于 webview 元素自身; true 时清空 inline 交还标签级控制 */
  active?: boolean;
}) {
  const [desktopState, setDesktopState] = useState<"unknown" | "yes" | "no">("unknown");
  const [settings, setSettings] = useState<SiteSettings>({ maxTabs: 10, maxHistory: 100 });
  const [tabsBySite, setTabsBySite] = useState<Record<string, SiteTab[]>>({});
  const [historyBySite, setHistoryBySite] = useState<Record<string, SiteHistoryEntry[]>>({});
  const [activeSiteInner, setActiveSiteInner] = useState<string>(sites[0]?.id ?? "default");
  const [activeTab, setActiveTab] = useState<TabView | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // —— 站点管理 (topic 动态配置): 添加站点表单 / Web 访问"添加到主题" ——
  const { topics, addSite, removeSite } = useTopics();
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [addToTopicOpen, setAddToTopicOpen] = useState(false);
  const [siteNotice, setSiteNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  /** 每个标签一个常驻 webview 实例 (tabId → element): 切标签只切 display, 不重建, 状态保留、无白屏 */
  const webviewRefs = useRef<Record<string, HTMLElement | null>>({});
  /** tabId → siteId: 站点级可见性按归属站点判断 (webview 实例常驻后, 可见性必须知道它属于哪个站点组) */
  const tabSiteRef = useRef<Record<string, string>>({});
  const activeTabIdRef = useRef<string | null>(null);
  /** 同 URL 短时幂等: 站点对一次点击可能触发多次 window.open (双 popup) → 只开一个标签 */
  const pendingOpenRef = useRef<Record<string, number>>({});
  /** 始终指向最新 openTab: popup 监听 effect 依赖少, 闭包若直接捕获 openTab 会拿到陈旧 tabsBySite 快照, 导致新建标签覆盖已有标签 */
  const openTabRef = useRef<((siteId: string, url: string) => void) | null>(null);

  const activeSite = activeSiteProp ?? activeSiteInner;
  const moduleSites = useMemo(() => sites, [sites]);
  // 卸载 (切走模块/关窗) 前把最新内存态 (含页面加载后的真实标题) 落库,
  // 否则标签标题只在 openTab 时持久化 (当时为 "…"), 切回模块恢复的标签全是 "…"
  const tabsBySiteRef = useRef(tabsBySite);
  tabsBySiteRef.current = tabsBySite;
  useEffect(() => {
    return () => {
      for (const s of moduleSites) {
        const tabs = tabsBySiteRef.current[s.id];
        if (tabs && tabs.length > 0) persistTabs(s.id, tabs);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const groupId = addressMode ? "default" : activeSite;
  // 站点集动态变化兜底 (topic 化后 sites 从 DB 异步加载/可增删): 非受控模式下
  // activeSiteInner 若不在当前站点集 → 回退首个站点; addressMode 恒 "default" 不受影响
  useEffect(() => {
    if (addressMode || activeSiteProp) return;
    if (moduleSites.length === 0) return;
    if (moduleSites.some((s) => s.id === activeSiteInner)) return;
    setActiveSiteInner(moduleSites[0].id);
  }, [moduleSites, activeSiteInner, activeSiteProp, addressMode]);

  // —— 站点级懒挂载 + 常驻: 访问过的站点组全量渲染 (切回不重建、不重载); 首个站点随组件初始化 ——
  const [visitedSites, setVisitedSites] = useState<Set<string>>(() => new Set([groupId]));
  useEffect(() => {
    setVisitedSites((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
  }, [groupId]);
  // —— 主题内站点全量常驻: sites 来自 DB 动态配置, 新增站点自动挂载 (首次出现即渲染);
  //   删除站点后 id 不再出现在 moduleSites, 容器渲染自然跳过 (下方 !siteDef 防御) ——
  useEffect(() => {
    setVisitedSites((prev) => {
      const missing = moduleSites.filter((s) => !prev.has(s.id));
      if (missing.length === 0) return prev;
      const next = new Set(prev);
      for (const s of missing) next.add(s.id);
      return next;
    });
  }, [moduleSites]);

  // —— 站点级 + 模块级可见性: 直接作用于 webview 元素自身 (容器/中间 div 的 visibility
  //   会被内部标签 div 显式 visible 覆盖, 必须操作 webview 本体)。激活模块的激活站点组
  //   交还标签级 div 控制, 非激活站点/非激活模块强制隐藏 → 切选项卡/切标签/切模块都
  //   不销毁实例: 无重载无白屏, 页面运行态全保留。
  //   ★ 可见性一律用 opacity + pointer-events, 绝不用 visibility:
  //   Electron 对 visibility:hidden 的 webview 会分离 guest, 恢复 visible 后画面渲染回来
  //   但真实鼠标输入通道不再路由 (点击无反应, 实测复现); opacity 不触发分离, guest 一直
  //   渲染, 输入通道永不中断, 切换零闪烁。隐藏层 pointer-events:none 不拦截下层点击。 ——
  useEffect(() => {
    if (!isElectronEnv() || desktopState !== "yes") return;
    const activeTabId = activeTabIdRef.current;
    for (const [tabId, el] of Object.entries(webviewRefs.current)) {
      if (!el) continue;
      const siteId = tabSiteRef.current[tabId];
      if (!siteId) continue;
      // ★ 必须按"激活标签"精确设置: 容器 div 的 pe:none 会被 webview 元素显式
      //   pe:auto 覆盖 (子元素显式值优先于父继承) — 若激活站点组内全部标签都设 auto,
      //   非激活标签 webview 会以 pe:auto + opacity:0 叠在激活标签之上拦截鼠标
      //   (可见性正常但点不到激活标签, target=_blank popup 也不触发)
      const show = active && siteId === groupId && tabId === activeTabId;
      el.style.opacity = show ? "1" : "0";
      el.style.pointerEvents = show ? "auto" : "none";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, groupId, tabsBySite, desktopState, activeTab]);

  // —— 数据加载 (SQLite, 每模块) ——
  useEffect(() => {
    setDesktopState(isElectronEnv() ? "yes" : "no");
    if (!isElectronEnv()) return;
    (async () => {
      try {
        const res = await fetch(`/api/site-tabs?module=${encodeURIComponent(moduleKey)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
          // 恢复上次激活站点 (非受控模式)
          if (!activeSiteProp && typeof data.settings.activeSite === "string") {
            setActiveSiteInner(data.settings.activeSite);
          }
        }
        if (data.tabs) {
          // 只去重同 URL 重复(保留标题完整者); 孤立的 "…" 标签保留 — URL 有效, 激活渲染后标题会自然更新
          const cleaned: Record<string, SiteTab[]> = {};
          for (const [sid, tabs] of Object.entries(data.tabs as Record<string, SiteTab[]>)) {
            const byUrl = new Map<string, SiteTab>();
            for (const t of tabs) {
              const k = t.url.split("#")[0];
              const existing = byUrl.get(k);
              if (!existing) {
                byUrl.set(k, t);
              } else if (existing.title === LOADING_DOT && t.title !== LOADING_DOT) {
                byUrl.set(k, t);
              }
            }
            cleaned[sid] = [...byUrl.values()];
          }
          setTabsBySite(cleaned);
        }
        if (data.history) setHistoryBySite(data.history);
      } catch {
        // 读取失败保持默认 (空会话)
      } finally {
        setLoaded(true);
      }
    })();
  }, [moduleKey]);

  // —— popup: 主进程通知 (webview 内 target=_blank → 站内标签页) ——
  useEffect(() => {
    if (!isElectronEnv()) return;
    const onPopup = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string; guestId?: number }>).detail;
      if (!detail?.url) return;
      // 模块常驻后多个 SiteBrowser 同时监听 window 事件: 用实时枚举匹配归属,
      // 不再依赖 did-attach 注册表 —— guest 重建后 webContentsId 变化, 事件驱动
      // 注册会漏 (微信后台实测 gid 4→5 后 map 未跟上 → popup 反查失败 → 标签不开)。
      // 发起 window.open 的 guest 必然已 attach, 枚举 getWebContentsId 必命中。
      if (typeof detail.guestId !== "number") return;
      let hit: Element | null = null;
      const wvs = document.querySelectorAll<Element>("webview");
      for (const w of wvs) {
        const wv = w as unknown as { getWebContentsId?: () => number };
        if (typeof wv.getWebContentsId === "function" && wv.getWebContentsId() === detail.guestId) {
          hit = w;
          break;
        }
      }
      if (!hit) return;
      const siteId = hit.getAttribute("data-site-id");
      if (!siteId) return;
      openTabRef.current?.(siteId, detail.url);
    };
    window.addEventListener("snuby-webview-popup", onPopup);
    return () => window.removeEventListener("snuby-webview-popup", onPopup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, loaded]);

  // —— 激活站点持久化 (非受控模式; 切站点/加载恢复后落库, 下次进入模块恢复) ——
  useEffect(() => {
    if (activeSiteProp || !loaded) return;
    void fetch("/api/site-tabs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: moduleKey,
        action: "settings",
        maxTabs: settings.maxTabs,
        maxHistory: settings.maxHistory,
        activeSite: activeSiteInner,
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSiteInner, loaded]);

  // —— 标签页操作 ——
  const tabsOf = useCallback(
    (siteId: string): SiteTab[] => {
      const site = moduleSites.find((s) => s.id === siteId);
      if (!site) return [];
      return [homeTab(site), ...(tabsBySite[siteId] ?? [])];
    },
    [moduleSites, tabsBySite],
  );

  const persistTabs = useCallback(
    (siteId: string, tabs: SiteTab[]) => {
      const body = { module: moduleKey, action: "save", site: siteId, tabs };
      void fetch("/api/site-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [moduleKey],
  );

  const appendHistory = useCallback(
    (siteId: string, entries: SiteHistoryEntry[]) => {
      if (entries.length === 0) return;
      setHistoryBySite((prev) => {
        const next = { ...prev, [siteId]: [...(prev[siteId] ?? []), ...entries] };
        return next;
      });
      void fetch("/api/site-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: moduleKey, action: "history", site: siteId, entries }),
      }).catch(() => {});
    },
    [moduleKey],
  );

  const openTab = useCallback(
    (siteId: string, url: string) => {
      const site = moduleSites.find((s) => s.id === siteId);
      if (!site) return;
      const urlNorm = url.split("#")[0];
      // 同 URL 短时幂等: 一次点击可能被站点触发多次 window.open (双 popup) → 重复事件忽略
      const now = Date.now();
      const pending = pendingOpenRef.current[urlNorm];
      if (pending && now - pending < 1000) return;
      pendingOpenRef.current[urlNorm] = now;
      // 主页 URL → 激活主页标签 (不新建副本)
      if (urlNorm === site.url.split("#")[0]) {
        setActiveTab({ siteId, tabId: `${siteId}${HOME_SUFFIX}` });
        setActiveSiteInner(siteId);
        return;
      }
      const group = tabsBySite[siteId] ?? [];
      // URL 去重: 同 URL 标签已存在 → 激活之
      const existing = group.find((t) => t.url.split("#")[0] === urlNorm);
      if (existing) {
        setActiveTab({ siteId, tabId: existing.id });
        setActiveSiteInner(siteId);
        return;
      }
      const next = [...group];
      // 超限: 淘汰最旧非主页标签 (避开当前激活标签), 进历史
      let evicted: SiteTab | null = null;
      if (next.length >= settings.maxTabs - 1) {
        const evictIdx = next.findIndex((t) => !(activeTab?.siteId === siteId && activeTab.tabId === t.id));
        evicted = next.splice(evictIdx >= 0 ? evictIdx : 0, 1)[0] ?? null;
      }
      const tab: SiteTab = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, title: LOADING_DOT };
      next.push(tab);
      setTabsBySite((prev) => ({ ...prev, [siteId]: next }));
      if (evicted) {
        appendHistory(siteId, [{ url: evicted.url, title: evicted.title, closedAt: Date.now() }]);
      }
      persistTabs(siteId, next);
      setActiveTab({ siteId, tabId: tab.id });
      setActiveSiteInner(siteId);
    },
    [moduleSites, tabsBySite, settings.maxTabs, appendHistory, persistTabs],
  );
  openTabRef.current = openTab;

  const closeTab = useCallback(
    (siteId: string, tabId: string) => {
      const group = tabsBySite[siteId] ?? [];
      const idx = group.findIndex((t) => t.id === tabId);
      if (idx < 0) return;
      const closed = group[idx];
      const next = group.filter((t) => t.id !== tabId);
      setTabsBySite((prev) => ({ ...prev, [siteId]: next }));
      appendHistory(siteId, [{ url: closed.url, title: closed.title, closedAt: Date.now() }]);
      persistTabs(siteId, next);
      if (activeTab?.siteId === siteId && activeTab.tabId === tabId) {
        // 关闭激活标签 → 激活相邻 (右侧优先, 无右侧则左侧); 无剩余 → 主页
        const target = next[Math.min(idx, next.length - 1)] ?? homeTab(moduleSites.find((s) => s.id === siteId)!);
        setActiveTab({ siteId, tabId: target.id });
      }
    },
    [tabsBySite, activeTab, appendHistory, persistTabs, moduleSites],
  );

  const activateTab = useCallback(
    (siteId: string, tabId: string) => {
      setActiveSiteInner(siteId);
      setActiveTab({ siteId, tabId });
      setShowHistory(false);
    },
    [],
  );

  const selectSite = useCallback(
    (siteId: string) => {
      setActiveSiteInner(siteId);
      // 切换到该站点主页 (保持站点级会话; 非主页标签在组内保留)
      setActiveTab({ siteId, tabId: `${siteId}${HOME_SUFFIX}` });
      setShowHistory(false);
      onActiveSiteChange?.(siteId);
    },
    [onActiveSiteChange],
  );

  const openHistoryEntry = useCallback(
    (siteId: string, entry: SiteHistoryEntry) => {
      setShowHistory(false);
      openTab(siteId, entry.url);
    },
    [openTab],
  );

  // —— webview 事件上报 ——
  const registerGuest = useCallback((el: HTMLElement | null, siteId: string, tabId: string) => {
    if (el) {
      webviewRefs.current[tabId] = el;
      tabSiteRef.current[tabId] = siteId;
    } else {
      delete webviewRefs.current[tabId];
      delete tabSiteRef.current[tabId];
      return;
    }
    const updateTabUrl = (url: string) => {
      setCurrentUrl(url);
      setTabsBySite((prev) => ({
        ...prev,
        [siteId]: (prev[siteId] ?? []).map((t) => (t.id === tabId ? { ...t, url } : t)),
      }));
    };
    // 整页导航: 回写标签 url (持久化/信息展示)
    const onNavigateFull = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) updateTabUrl(url);
    };
    // SPA 路由 (did-navigate-in-page): 只更新地址栏, 不回写标签 url —
    // 否则标签 url 变化会经受控 src 触发 webview 重载, 造成无限刷新循环
    const onNavigateInPage = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) setCurrentUrl(url);
    };
    const onTitle = (e: Event) => {
      const t = (e as unknown as { title?: string }).title;
      if (t) {
        setTabsBySite((prev) => ({
          ...prev,
          [siteId]: (prev[siteId] ?? []).map((x) => (x.id === tabId ? { ...x, title: t } : x)),
        }));
      }
    };
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onFail = () => {
      setLoading(false);
      setTabsBySite((prev) => ({
        ...prev,
        [siteId]: (prev[siteId] ?? []).map((x) => (x.id === tabId ? { ...x, error: true } : x)),
      }));
    };
    if (!el.getAttribute("data-snuby-bound")) {
      el.setAttribute("data-snuby-bound", "1");
      el.addEventListener("did-navigate", onNavigateFull);
      el.addEventListener("did-navigate-in-page", onNavigateInPage);
      el.addEventListener("page-title-updated", onTitle);
      el.addEventListener("did-start-loading", onStart);
      el.addEventListener("did-stop-loading", onStop);
      el.addEventListener("did-fail-load", onFail);
    }
  }, []);

  // —— 工具栏动作 (作用于激活标签) ——
  const nav = (fn: "goBack" | "goForward" | "reload") => {
    const tabId = activeTabIdRef.current;
    const el = tabId ? webviewRefs.current[tabId] : null;
    if (el && typeof (el as unknown as Record<string, () => void>)[fn] === "function") {
      (el as unknown as Record<string, () => void>)[fn]();
    }
  };

  // —— 站点管理动作 ——
  // ESC 关闭添加站点对话框 (焦点不在输入框时也生效)
  useEffect(() => {
    if (!addSiteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddSiteOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [addSiteOpen]);

  const handleAddSite = async () => {
    const url = siteUrl.trim();
    if (!url) return;
    const full = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
    const id = await addSite(moduleKey, full, siteLabel.trim());
    if (id) {
      setSiteUrl("");
      setSiteLabel("");
      setAddSiteOpen(false);
      selectSite(id);
      setSiteNotice("站点已添加");
    } else {
      setSiteNotice("添加失败，请重试");
    }
  };
  const handleRemoveSite = async (siteId: string) => {
    if (moduleSites.length <= 1) {
      setSiteNotice("至少保留一个站点");
      return;
    }
    const target = moduleSites.find((s) => s.id === siteId);
    if (!window.confirm(`移除站点「${target?.label ?? siteId}」？该站点的标签与历史将一并清除。`)) return;
    await removeSite(moduleKey, siteId);
    if (activeSite === siteId) {
      const next = moduleSites.find((s) => s.id !== siteId);
      if (next) selectSite(next.id);
    }
  };
  const handleAddToTopic = async (topicId: string) => {
    const url = currentUrl || moduleSites[0]?.url || "";
    if (!url || !/^https?:\/\//.test(url)) {
      setSiteNotice("当前页面地址无效");
      return;
    }
    const ok = await addSite(topicId, url, "");
    setAddToTopicOpen(false);
    setSiteNotice(ok ? "已添加到主题" : "添加失败");
  };

  // —— 非 Electron 兜底 (Web 版不再维护, 仅保证不白屏) ——
  if (desktopState === "unknown" || !loaded) {
    return <div className="flex h-full w-full items-center justify-center bg-surface text-[13px] text-ink-faint">加载中…</div>;
  }
  if (desktopState === "no") {
    return (
      <div className="flex h-full w-full flex-col overflow-auto bg-surface">
        {moduleSites.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="mx-auto my-2 flex w-[560px] items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-[13.5px] hover:border-accent"
          >
            <span className="text-ink">{s.label}</span>
            <span className="text-accent-deep">在新窗口打开 ↗</span>
          </a>
        ))}
      </div>
    );
  }

  const activeSiteDef = moduleSites.find((s) => s.id === activeSite) ?? moduleSites[0];
  const groupTabs = tabsOf(groupId);
  const activeTabDef =
    activeTab && activeTab.siteId === groupId
      ? groupTabs.find((t) => t.id === activeTab.tabId) ?? groupTabs[0]
      : groupTabs[0];
  const activeHistory = historyBySite[groupId] ?? [];
  activeTabIdRef.current = activeTabDef?.id ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 站点层: 选项卡 或 地址栏 (hideSiteBar 时由外部渲染) */}
      {hideSiteBar ? null : addressMode ? (
        <AddressBar
          title={title}
          currentUrl={currentUrl}
          onNavigate={(url) => {
            const tabId = activeTabIdRef.current;
            const el = tabId ? webviewRefs.current[tabId] : null;
            if (el && typeof (el as unknown as { loadURL: (u: string) => void }).loadURL === "function") {
              (el as unknown as { loadURL: (u: string) => void }).loadURL(url);
              setCurrentUrl(url);
            }
          }}
        />
      ) : (
        <div className="flex h-[42px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line bg-surface px-4">
          {title ? (
            <span className="mr-2 flex shrink-0 items-center whitespace-nowrap text-[14px] font-bold text-ink">
              {title}
            </span>
          ) : null}
          {moduleSites.map((s) => {
            const active = s.id === activeSite;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSite(s.id)}
                className={[
                  "group relative shrink-0 px-3 text-[13px] transition-colors",
                  active ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                {s.label}
                {active ? <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" /> : null}
                {moduleSites.length > 1 ? (
                  <span
                    role="button"
                    aria-label={`移除站点 ${s.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemoveSite(s.id);
                    }}
                    // X 常驻占位 (inline-flex + opacity 控制显隐): hover 出现但不撑开宽度, 选项卡不跳变
                    className="ml-1.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-black/10 hover:text-red-500 group-hover:opacity-100"
                  >
                    <IconX className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
          <div className="relative ml-1 flex shrink-0 items-center">
            <button
              type="button"
              title="添加站点"
              onClick={() => setAddSiteOpen((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
            >
              <IconAdd className="h-4 w-4" />
            </button>
            {addSiteOpen ? (
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
                onClick={() => setAddSiteOpen(false)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="添加站点"
                  onClick={(e) => e.stopPropagation()}
                  className="w-[440px] max-w-[90vw] rounded-xl border border-line bg-white p-5 shadow-2xl"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-[14.5px] font-bold text-ink">添加站点</span>
                    <button
                      type="button"
                      aria-label="关闭"
                      onClick={() => setAddSiteOpen(false)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    <input
                      autoFocus
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handleAddSite()}
                      placeholder="站点地址，如 https://example.com"
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
                    />
                    <input
                      value={siteLabel}
                      onChange={(e) => setSiteLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handleAddSite()}
                      placeholder="名称（可选，不填则用域名）"
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
                    />
                    <div className="mt-1 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAddSiteOpen(false)}
                        className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted hover:bg-black/5"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAddSite()}
                        className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                      >
                        添加
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {siteNotice ? (
            <span className="mr-1 flex shrink-0 items-center text-[11.5px] text-ink-faint">{siteNotice}</span>
          ) : null}
        </div>
      )}

      {/* 站内标签页栏 + 工具栏 (Chrome 页签风格) */}
      <div className="flex h-[38px] shrink-0 items-stretch border-b border-line bg-black/[0.03]">
        <div className="flex min-w-0 flex-1 items-end gap-[3px] overflow-x-auto px-1.5">
          {groupTabs.map((t) => {
            const active = t.id === activeTabDef.id;
            const isHome = t.id.endsWith(HOME_SUFFIX);
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => activateTab(groupId, t.id)}
                onKeyDown={(e) => e.key === "Enter" && activateTab(groupId, t.id)}
                title={t.url}
                className={[
                  "group relative z-0 flex h-[30px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[7px] border border-line px-3 text-[12.5px] transition-colors",
                  active
                    ? "z-10 -mb-px h-[31px] border-b-0 bg-white font-semibold text-ink shadow-[0_-1px_4px_rgba(0,0,0,0.05)]"
                    : "bg-black/[0.05] text-ink-muted hover:bg-white/70 hover:text-ink",
                ].join(" ")}
              >
                {t.error ? <span className="text-red-500">⚠</span> : null}
                <span className="max-w-[140px] truncate">{t.title}</span>
                {loading && active ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" /> : null}
                {!isHome ? (
                  <button
                    type="button"
                    aria-label={`关闭 ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(groupId, t.id);
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-black/10 hover:text-red-500"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* 工具栏 */}
        <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5 pr-2">
          <ToolButton label="后退" onClick={() => nav("goBack")} disabled={!activeTabDef}>
            <IconBack />
          </ToolButton>
          <ToolButton label="前进" onClick={() => nav("goForward")} disabled={!activeTabDef}>
            <IconForward />
          </ToolButton>
          <ToolButton label="刷新" onClick={() => nav("reload")} disabled={!activeTabDef}>
            <IconReload />
          </ToolButton>
          {addressMode ? (
            <div className="relative">
              <ToolButton label="添加到主题" onClick={() => setAddToTopicOpen((v) => !v)}>
                <IconAdd />
              </ToolButton>
              {addToTopicOpen ? (
                <div className="absolute right-0 top-[36px] z-50 max-h-[260px] w-[220px] overflow-auto rounded-lg border border-line bg-white p-1.5 shadow-xl">
                  <div className="px-2 py-1 text-[11.5px] font-semibold text-ink-muted">添加到主题</div>
                  {topics && topics.length > 0 ? (
                    topics.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => void handleAddToTopic(t.id)}
                        className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-black/5"
                      >
                        {t.name}
                      </button>
                    ))
                  ) : (
                    <div className="px-2.5 py-2 text-[12px] text-ink-faint">暂无主题，请先在左侧创建</div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <InfoButton tab={activeTabDef} />
          <div className="relative">
            <ToolButton
              label="历史"
              onClick={() => {
                setShowHistory((v) => !v);
              }}
            >
              <IconHistory />
            </ToolButton>
            {showHistory ? (
              <div className="absolute right-0 top-[36px] z-50 max-h-[320px] w-[340px] overflow-auto rounded-lg border border-line bg-white p-2 shadow-xl">
                <div className="mb-1 px-2 pt-1 text-[12px] font-semibold text-ink-muted">
                  已关闭标签页（{activeHistory.length}/{settings.maxHistory}）
                </div>
                {activeHistory.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[12.5px] text-ink-faint">暂无历史</div>
                ) : (
                  activeHistory
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <button
                        key={`${h.closedAt}-${i}`}
                        type="button"
                        onClick={() => openHistoryEntry(groupId, h)}
                        className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-black/5"
                        title={`${h.title || h.url}\n${h.url}`}
                      >
                        {h.title || h.url}
                      </button>
                    ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* 内容区: 站点级 + 标签级全量常驻渲染, 所有 webview 实例不销毁 —
          可见性由上方 effect 直接作用于 webview 元素: 激活模块的激活站点组交还标签级
          div 控制 (激活标签显示其余隐藏), 非激活站点/模块强制隐藏。
          切选项卡/切标签/切模块都只是切可见性 → 无重载无白屏, 页面运行态全保留。
          ★ 所有层统一 opacity + pointer-events (绝不用 visibility): visibility 会触发
          Electron 分离 guest, 恢复后真实鼠标输入失效 (实测复现); opacity 保持 guest
          常驻渲染, 输入通道永不中断。隐藏层 pointer-events:none 不拦截下层点击。 */}
      <div className="relative min-h-0 flex-1">
        {[...visitedSites].map((siteId) => {
          const siteDef = moduleSites.find((s) => s.id === siteId);
          if (!siteDef) return null;
          const tabs = tabsOf(siteId);
          const isActiveSite = siteId === groupId;
          return (
            <div
              key={siteId}
              className="absolute inset-0 h-full w-full"
              style={{
                opacity: isActiveSite ? 1 : 0,
                pointerEvents: isActiveSite ? "auto" : "none",
                // 激活站点容器置顶: Electron webview 命中测试不完全遵循 pe, 隐藏层沉底防拦截
                zIndex: isActiveSite ? 5 : 0,
              }}
            >
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className="absolute inset-0 h-full w-full"
                  style={{
                    opacity: isActiveSite && t.id === activeTabDef.id ? 1 : 0,
                    pointerEvents: isActiveSite && t.id === activeTabDef.id ? "auto" : "none",
                    zIndex: isActiveSite && t.id === activeTabDef.id ? 10 : 0,
                  }}
                >
                  {t.url.startsWith("snuby://") ? (
                    // 内置站点 (实验室等): 渲染本地组件而非 webview
                    <LocalAgentPanel />
                  ) : (
                    <SiteWebview
                      src={t.url}
                      siteId={siteId}
                      tabId={t.id}
                      partition={siteDef.partition}
                      onRef={registerGuest}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 标签 webview: React 直接管理的独立实例 (无缓存池)
 * - 挂载创建、卸载销毁, 生命周期随标签 DOM
 * - 标签切换不改动实例 (父容器 opacity + pointer-events 切换) → 状态保留、无重载
 * - src 只在挂载时取一次: 标签 url 后续变化 (did-navigate 回写) 不触发重载, 避免 SPA 无限刷新
 */
function SiteWebview({
  src,
  siteId,
  tabId,
  partition,
  onRef,
}: {
  src: string;
  siteId: string;
  tabId: string;
  partition?: string;
  onRef: (el: HTMLElement | null, siteId: string, tabId: string) => void;
}) {
  const [initialSrc] = useState(src);
  const setEl = useCallback(
    (el: HTMLElement | null) => {
      onRef(el, siteId, tabId);
    },
    [onRef, siteId, tabId],
  );

  return createElement("div", { className: "h-full w-full" }, [
    createElement("webview", {
      ref: setEl,
      src: initialSrc,
      partition,
      allowpopups: "true",
      "data-site-id": siteId,
      "data-tab-id": tabId,
      className: "h-full w-full border-0",
      style: { width: "100%", height: "100%" },
    }),
  ]);
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** 信息按钮: hover 展示当前标签基本信息 */
function InfoButton({ tab }: { tab: SiteTab | null }) {
  return (
    <div className="group relative">
      <div className="flex h-7 w-7 cursor-default items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/5 hover:text-ink">
        <IconInfo />
      </div>
      {tab ? (
        <div className="invisible absolute right-0 top-[36px] z-50 w-[300px] rounded-lg border border-line bg-white p-3 shadow-xl group-hover:visible">
          <div className="mb-1 truncate text-[12.5px] font-medium text-ink">{tab.title}</div>
          <div className="break-all text-[11.5px] leading-relaxed text-ink-muted">{tab.url}</div>
        </div>
      ) : null}
    </div>
  );
}

function AddressBar({
  title,
  currentUrl,
  onNavigate,
}: {
  title?: string;
  currentUrl: string;
  onNavigate: (url: string) => void;
}) {
  const [value, setValue] = useState(currentUrl);

  useEffect(() => {
    setValue(currentUrl);
  }, [currentUrl]);

  function submit() {
    const raw = value.trim();
    if (!raw) return;
    let url = raw;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
      url = `https://${url}`;
    }
    onNavigate(url);
  }

  return (
    <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      {title ? (
        <span className="shrink-0 whitespace-nowrap text-[14px] font-bold text-ink">{title}</span>
      ) : null}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="输入网址，回车访问"
        className="h-8 flex-1 rounded-md border border-line bg-white px-3 text-[12.5px] outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={submit}
        className="h-8 shrink-0 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90"
      >
        前往
      </button>
    </div>
  );
}
