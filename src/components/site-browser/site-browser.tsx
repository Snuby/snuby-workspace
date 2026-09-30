"use client";

// Spec: 017-site-tabs — 通用站点容器 (SiteBrowser)
// 任何以站点形式打开内容的模块统一使用: 站点选项卡(或地址栏) + 站内标签页 + 工具栏。
// 站内标签页: 每站点一组, 主页(官网)常驻不可关, 其余可关/可切换/可淘汰 (上限 maxTabs);
// 关闭的标签进历史 (上限 maxHistory, 可重开); 配置在设置页按模块独立维护 (SQLite)。
// 桌面版(Electron) 渲染 <webview>; 非 Electron 渲染外链兜底 (Web 版不再维护)。

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTopics } from "@/components/workbench/topics-context";
import { topicIcon } from "@/components/workbench/topic-icon";
import LocalAgentPanel from "@/components/site-browser/local-agent-panel";
import { tabIconFor } from "@/components/ui/site-favicon";
import { ContextMenuItem, ContextMenuLayer } from "@/components/ui/context-menu-layer";
import { useClickOutside } from "@/lib/use-click-outside";
import {
  readWebContentsId,
  registerMonitorSource,
  type MonitorTabInfo,
} from "@/lib/monitor-registry";

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

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

type SiteSettings = {
  maxTabs: number;
  maxHistory: number;
  activeSite?: string | null;
  homeUrl?: string | null;
};
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
const IconCopy = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

const IconCheck = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m5 13 4 4L19 7" />
  </svg>
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
const IconHome = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </Icon>
);
const IconGlobe = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
  </Icon>
);

const DEFAULT_BROWSER_HOME = "https://www.google.com/";

function normalizeHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return t;
  return `https://${t}`;
}

function urlKey(url: string): string {
  return url.split("#")[0].replace(/\/$/, "");
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "主页";
  } catch {
    return "主页";
  }
}

/** 占位「…」或空标题 → 用主机名展示, 避免标签栏出现孤立省略号 */
function tabDisplayTitle(tab: Pick<SiteTab, "url" | "title">): string {
  const t = tab.title?.trim() ?? "";
  if (t && t !== LOADING_DOT && t !== "...") return t;
  return hostnameLabel(tab.url);
}

function isPlaceholderTitle(title: string | undefined): boolean {
  const t = title?.trim() ?? "";
  return !t || t === LOADING_DOT || t === "...";
}

/** 更新某站点组内标签 (含主页 ::home: 若不在列表则 upsert, 便于落库会话 URL/标题) */
function patchSiteTab(
  prev: Record<string, SiteTab[]>,
  siteId: string,
  tabId: string,
  patch: Partial<Pick<SiteTab, "url" | "title" | "error">>,
): { nextMap: Record<string, SiteTab[]>; nextTabs: SiteTab[] } {
  const list = prev[siteId] ?? [];
  const idx = list.findIndex((t) => t.id === tabId);
  let nextTabs: SiteTab[];
  if (idx >= 0) {
    nextTabs = list.map((t, i) => (i === idx ? { ...t, ...patch } : t));
  } else if (tabId.endsWith(HOME_SUFFIX)) {
    nextTabs = [
      ...list.filter((t) => !t.id.endsWith(HOME_SUFFIX)),
      {
        id: tabId,
        url: typeof patch.url === "string" ? patch.url : "",
        title: typeof patch.title === "string" ? patch.title : LOADING_DOT,
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      },
    ];
  } else {
    nextTabs = list;
  }
  return { nextMap: { ...prev, [siteId]: nextTabs }, nextTabs };
}

function isSameHomeUrl(current: string, homeUrl: string): boolean {
  if (!current || current === "about:blank") return false;
  if (current === homeUrl) return true;
  try {
    const a = new URL(current);
    const b = new URL(homeUrl);
    if (a.origin !== b.origin) return false;
    const norm = (p: string) => p.replace(/\/+$/, "") || "/";
    return norm(a.pathname) === norm(b.pathname);
  } catch {
    return false;
  }
}

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
  const [loadingByTab, setLoadingByTab] = useState<Record<string, boolean>>({});
  const [readyByTab, setReadyByTab] = useState<Record<string, boolean>>({});
  const [errorMsgByTab, setErrorMsgByTab] = useState<Record<string, string>>({});
  const [currentUrl, setCurrentUrl] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // —— 站点管理 (topic 动态配置): 添加站点表单 / Web 访问"添加到主题" ——
  const { topics, addSite, updateSite, removeSite } = useTopics();
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  /** 编辑中的站点 id; null 表示对话框处于「添加」模式 */
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [addToTopicOpen, setAddToTopicOpen] = useState(false);
  const [siteNotice, setSiteNotice] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; siteId: string } | null>(null);
  /** 地址栏模式: 可编辑主页 URL / 显示名 (优先于 props.sites[0]) */
  const [browserHome, setBrowserHome] = useState(sites[0]?.url ?? DEFAULT_BROWSER_HOME);
  const [browserHomeTitle, setBrowserHomeTitle] = useState(sites[0]?.label || "主页");
  const [editHomeOpen, setEditHomeOpen] = useState(false);
  const [editHomeUrl, setEditHomeUrl] = useState("");
  const [homeTabMenu, setHomeTabMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
    url: string;
    isHome: boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** 监控回收: 主页等被「关闭」后卸掉 webview, 模块再次激活时重建 */
  const [parkedIds, setParkedIds] = useState<Record<string, true>>({});
  /** 每个标签一个常驻 webview 实例 (tabId → element): 切标签只切 display, 不重建, 状态保留、无白屏 */
  const webviewRefs = useRef<Record<string, HTMLElement | null>>({});
  /** tabId → siteId: 站点级可见性按归属站点判断 (webview 实例常驻后, 可见性必须知道它属于哪个站点组) */
  const tabSiteRef = useRef<Record<string, string>>({});
  const activeTabIdRef = useRef<string | null>(null);
  /** 同 URL 短时幂等: 站点对一次点击可能触发多次 window.open (双 popup) → 只开一个标签 */
  const pendingOpenRef = useRef<Record<string, number>>({});
  /** 标题/URL 变更防抖落盘 (对齐矩阵: 避免只靠卸载落库导致标题停在「…」) */
  const persistTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persistTabsRef = useRef<((siteId: string, tabs: SiteTab[]) => void) | null>(null);
  const schedulePersistRef = useRef<(siteId: string, tabsSnapshot?: SiteTab[]) => void>(() => {});
  /** 始终指向最新 openTab: popup 监听 effect 依赖少, 闭包若直接捕获 openTab 会拿到陈旧 tabsBySite 快照, 导致新建标签覆盖已有标签 */
  const openTabRef = useRef<((siteId: string, url: string) => void) | null>(null);
  const addToTopicRef = useRef<HTMLDivElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const parkedIdsRef = useRef(parkedIds);
  parkedIdsRef.current = parkedIds;
  /** 各标签最近打开/激活时间 */
  const lastActiveAtRef = useRef<Record<string, number>>({});
  const mountedTabsRef = useRef<Set<string>>(new Set());

  useClickOutside(addToTopicRef, addToTopicOpen, () => setAddToTopicOpen(false));
  useClickOutside(historyMenuRef, showHistory, () => setShowHistory(false));

  /** 重进模块: 只把当前激活标签重新挂上 (其它已回收/未点过的仍不加载) */
  useEffect(() => {
    if (!active || !loaded) return;
    const tabId = activeTabRef.current?.tabId;
    if (!tabId) return;
    setParkedIds((prev) => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setMountedTabs((prev) => {
      if (prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  }, [active, loaded]);

  useEffect(() => {
    if (!activeTab?.tabId) return;
    lastActiveAtRef.current[activeTab.tabId] = Date.now();
  }, [activeTab?.tabId]);

  useEffect(() => {
    if (!active || !activeTab?.tabId) return;
    lastActiveAtRef.current[activeTab.tabId] = Date.now();
  }, [active, activeTab?.tabId]);


  const activeSite = activeSiteProp ?? activeSiteInner;
  const moduleSites = useMemo(() => {
    if (!addressMode) return sites;
    const base = sites[0] ?? { id: "default", label: "主页", url: DEFAULT_BROWSER_HOME };
    return [{ ...base, url: browserHome, label: browserHomeTitle || "主页" }];
  }, [sites, addressMode, browserHome, browserHomeTitle]);

  const moduleSitesRef = useRef(moduleSites);
  moduleSitesRef.current = moduleSites;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const closeTabRef = useRef<(siteId: string, tabId: string) => void>(() => {});
  const tabsOfRef = useRef<(siteId: string) => SiteTab[]>(() => []);

  // —— 监控注册: 向系统·监控上报本模块常驻标签 ——
  useEffect(() => {
    const section = addressMode || moduleKey === "browser" ? "browser" : "topic";
    const sourceId = `site:${moduleKey}`;
    return registerMonitorSource(sourceId, {
      list: () => {
        const rows: MonitorTabInfo[] = [];
        for (const site of moduleSitesRef.current) {
          const tabs = tabsOfRef.current(site.id);
          for (const t of tabs) {
            if (parkedIdsRef.current[t.id]) continue;
            if (!mountedTabsRef.current.has(t.id)) continue;
            if (!(t.id in lastActiveAtRef.current)) {
              lastActiveAtRef.current[t.id] = Date.now();
            }
            rows.push({
              section,
              moduleKey,
              moduleLabel: title || (section === "browser" ? "Web 访问" : moduleKey),
              groupId: site.id,
              groupLabel: site.label || site.id,
              tabId: t.id,
              title: tabDisplayTitle(t),
              url: t.url,
              isHome: t.id.endsWith(HOME_SUFFIX),
              isActive: activeTabRef.current?.siteId === site.id && activeTabRef.current?.tabId === t.id,
              lastActiveAt: lastActiveAtRef.current[t.id] ?? Date.now(),
              webContentsId: readWebContentsId(webviewRefs.current[t.id]),
            });
          }
        }
        return rows;
      },
      close: (groupId, tabId) => {
        closeTabRef.current(groupId, tabId);
      },
    });
  }, [moduleKey, addressMode, title]);

  // 卸载 (切走模块/关窗) 前把最新内存态 (含页面加载后的真实标题) 落库,
  // 否则标签标题只在 openTab 时持久化 (当时为占位), 切回模块恢复的标签全是「…」
  const tabsBySiteRef = useRef(tabsBySite);
  tabsBySiteRef.current = tabsBySite;
  useEffect(() => {
    return () => {
      for (const t of Object.values(persistTimerRef.current)) clearTimeout(t);
      persistTimerRef.current = {};
      for (const s of moduleSites) {
        const tabs = tabsBySiteRef.current[s.id];
        if (tabs && tabs.length > 0) persistTabsRef.current?.(s.id, tabs);
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

  // —— 站点级懒挂载: 等会话加载完成后再挂, 避免「先落到首站再恢复上次站点」误开多个 webview ——
  const [visitedSites, setVisitedSites] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!loaded) return;
    setVisitedSites((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
  }, [groupId, loaded]);
  /** 标签级懒加载: 用户点过的标签才挂 webview; 切回已挂载的不重建 */
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set());
  mountedTabsRef.current = mountedTabs;
  useEffect(() => {
    if (!loaded) return;
    const tabs = tabsOfRef.current(groupId);
    if (tabs.length === 0) return;
    const tabId =
      activeTab && activeTab.siteId === groupId
        ? (tabs.find((t) => t.id === activeTab.tabId)?.id ?? tabs[0].id)
        : tabs[0].id;
    lastActiveAtRef.current[tabId] = Date.now();
    setMountedTabs((prev) => {
      if (prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
    setParkedIds((prev) => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, [activeTab, groupId, tabsBySite, moduleSites, loaded]);

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
          if (addressMode && typeof data.settings.homeUrl === "string" && data.settings.homeUrl) {
            setBrowserHome(data.settings.homeUrl);
            setBrowserHomeTitle(hostnameLabel(data.settings.homeUrl));
          }
        }
        if (data.tabs) {
          // 去重同 URL; 把落库的「…」占位改成主机名, 避免标签栏再冒孤立省略号
          const cleaned: Record<string, SiteTab[]> = {};
          const healed: string[] = [];
          for (const [sid, tabs] of Object.entries(data.tabs as Record<string, SiteTab[]>)) {
            const byUrl = new Map<string, SiteTab>();
            let changed = false;
            for (const t of tabs) {
              const k = t.url.split("#")[0];
              const fixed = isPlaceholderTitle(t.title)
                ? { ...t, title: hostnameLabel(t.url) }
                : t;
              if (fixed.title !== t.title) changed = true;
              const existing = byUrl.get(k);
              if (!existing) {
                byUrl.set(k, fixed);
              } else if (isPlaceholderTitle(existing.title) && !isPlaceholderTitle(fixed.title)) {
                byUrl.set(k, fixed);
                changed = true;
              }
            }
            cleaned[sid] = [...byUrl.values()];
            if (changed) healed.push(sid);
          }
          setTabsBySite(cleaned);
          for (const sid of healed) {
            const tabs = cleaned[sid];
            if (tabs?.length) {
              void fetch("/api/site-tabs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ module: moduleKey, action: "save", site: sid, tabs }),
              }).catch(() => {});
            }
          }
        }
        if (data.history) setHistoryBySite(data.history);
      } catch {
        // 读取失败保持默认 (空会话)
      } finally {
        setLoaded(true);
      }
    })();
  }, [moduleKey, activeSiteProp, addressMode]);

  const applyBrowserHome = useCallback(
    async (raw: string, titleHint?: string) => {
      const full = normalizeHttpUrl(raw);
      if (!full) {
        setSiteNotice("主页地址无效");
        return false;
      }
      const key = urlKey(full);
      const title =
        titleHint && titleHint !== LOADING_DOT && titleHint.trim()
          ? titleHint.trim()
          : hostnameLabel(full);
      setBrowserHome(full);
      setBrowserHomeTitle(title);
      const homeId = `default${HOME_SUFFIX}`;
      // 只保留非主页标签, 并去掉与新主页同 URL 的普通标签
      let nextRest: SiteTab[] = [];
      setTabsBySite((prev) => {
        const group = prev.default ?? [];
        nextRest = group.filter(
          (t) => !t.id.endsWith(HOME_SUFFIX) && urlKey(t.url) !== key,
        );
        return { ...prev, default: nextRest };
      });
      const el = webviewRefs.current[homeId] as
        | (HTMLElement & { loadURL?: (u: string) => void })
        | null
        | undefined;
      el?.loadURL?.(full);
      setActiveTab({ siteId: "default", tabId: homeId });
      setCurrentUrl(full);
      try {
        await fetch("/api/site-tabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            module: moduleKey,
            action: "settings",
            maxTabs: settings.maxTabs,
            maxHistory: settings.maxHistory,
            homeUrl: full,
          }),
        });
        await fetch("/api/site-tabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            module: moduleKey,
            action: "save",
            site: "default",
            tabs: nextRest,
          }),
        });
      } catch {
        /* 本地已更新 */
      }
      setSiteNotice("主页已更新");
      return true;
    },
    [moduleKey, settings.maxTabs, settings.maxHistory],
  );

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
      const all = tabsBySite[siteId] ?? [];
      const storedHome = all.find((t) => t.id.endsWith(HOME_SUFFIX));
      const rest = all.filter((t) => !t.id.endsWith(HOME_SUFFIX));
      // 主页: 优先用落库的会话 url/title (站内跳转后下次打开不丢), 否则回落站点定义
      const home = homeTab(site);
      if (storedHome?.url) {
        return [
          {
            ...home,
            url: storedHome.url,
            title: isPlaceholderTitle(storedHome.title) ? home.title : storedHome.title,
            ...(storedHome.error ? { error: true } : {}),
          },
          ...rest,
        ];
      }
      return [home, ...rest];
    },
    [moduleSites, tabsBySite],
  );
  tabsOfRef.current = tabsOf;

  const persistTabs = useCallback(
    (siteId: string, tabs: SiteTab[]) => {
      // 合并主页会话行, 避免 openTab/closeTab 只传非主页列表时把已落库的 ::home 冲掉
      const fromRef = tabsBySiteRef.current[siteId] ?? [];
      const home =
        tabs.find((t) => t.id.endsWith(HOME_SUFFIX)) ??
        fromRef.find((t) => t.id.endsWith(HOME_SUFFIX));
      const rest = tabs.filter((t) => !t.id.endsWith(HOME_SUFFIX));
      const payload = home?.url ? [home, ...rest] : rest;
      const body = { module: moduleKey, action: "save", site: siteId, tabs: payload };
      void fetch("/api/site-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [moduleKey],
  );
  persistTabsRef.current = persistTabs;

  /** 标题/URL 变更后防抖落盘, 避免只靠卸载落库 — 强杀或未切走时标题会停在「…」 */
  const schedulePersist = useCallback(
    (siteId: string, tabsSnapshot?: SiteTab[]) => {
      const prev = persistTimerRef.current[siteId];
      if (prev) clearTimeout(prev);
      persistTimerRef.current[siteId] = setTimeout(() => {
        const tabs = tabsSnapshot ?? tabsBySiteRef.current[siteId];
        if (tabs?.length) persistTabs(siteId, tabs);
      }, 400);
    },
    [persistTabs],
  );
  schedulePersistRef.current = schedulePersist;

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
      const tab: SiteTab = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        url,
        title: hostnameLabel(url),
      };
      next.push(tab);
      setTabsBySite((prev) => ({ ...prev, [siteId]: next }));
      if (evicted) {
        appendHistory(siteId, [{ url: evicted.url, title: evicted.title, closedAt: Date.now() }]);
        setLoadingByTab((prev) => {
          if (!(evicted!.id in prev)) return prev;
          const n = { ...prev };
          delete n[evicted!.id];
          return n;
        });
        setReadyByTab((prev) => {
          if (!(evicted!.id in prev)) return prev;
          const n = { ...prev };
          delete n[evicted!.id];
          return n;
        });
        setErrorMsgByTab((prev) => {
          if (!(evicted!.id in prev)) return prev;
          const n = { ...prev };
          delete n[evicted!.id];
          return n;
        });
      }
      persistTabs(siteId, next);
      setLoadingByTab((prev) => ({ ...prev, [tab.id]: true }));
      setActiveTab({ siteId, tabId: tab.id });
      setActiveSiteInner(siteId);
    },
    [moduleSites, tabsBySite, settings.maxTabs, appendHistory, persistTabs],
  );
  openTabRef.current = openTab;

  const closeTab = useCallback(
    (siteId: string, tabId: string) => {
      // 主页: 监控回收 — 卸 webview, 标签仍在, 下次点进再挂载
      if (tabId.endsWith(HOME_SUFFIX)) {
        setParkedIds((prev) => ({ ...prev, [tabId]: true }));
        setMountedTabs((prev) => {
          if (!prev.has(tabId)) return prev;
          const next = new Set(prev);
          next.delete(tabId);
          return next;
        });
        delete webviewRefs.current[tabId];
        delete tabSiteRef.current[tabId];
        return;
      }
      const group = tabsBySite[siteId] ?? [];
      const idx = group.findIndex((t) => t.id === tabId);
      if (idx < 0) return;
      const closed = group[idx];
      const next = group.filter((t) => t.id !== tabId);
      setTabsBySite((prev) => ({ ...prev, [siteId]: next }));
      appendHistory(siteId, [{ url: closed.url, title: closed.title, closedAt: Date.now() }]);
      persistTabs(siteId, next);
      setMountedTabs((prev) => {
        if (!prev.has(tabId)) return prev;
        const n = new Set(prev);
        n.delete(tabId);
        return n;
      });
      setLoadingByTab((prev) => {
        if (!(tabId in prev)) return prev;
        const n = { ...prev };
        delete n[tabId];
        return n;
      });
      setReadyByTab((prev) => {
        if (!(tabId in prev)) return prev;
        const n = { ...prev };
        delete n[tabId];
        return n;
      });
      setErrorMsgByTab((prev) => {
        if (!(tabId in prev)) return prev;
        const n = { ...prev };
        delete n[tabId];
        return n;
      });
      delete webviewRefs.current[tabId];
      delete tabSiteRef.current[tabId];
      if (activeTab?.siteId === siteId && activeTab.tabId === tabId) {
        // 关闭激活标签 → 激活相邻 (右侧优先, 无右侧则左侧); 无剩余 → 主页
        const target = next[Math.min(idx, next.length - 1)] ?? homeTab(moduleSites.find((s) => s.id === siteId)!);
        setActiveTab({ siteId, tabId: target.id });
      }
    },
    [tabsBySite, activeTab, appendHistory, persistTabs, moduleSites],
  );
  closeTabRef.current = closeTab;

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
      setTabsBySite((prev) => {
        const site = moduleSitesRef.current.find((s) => s.id === siteId);
        const fallbackTitle = tabId.endsWith(HOME_SUFFIX)
          ? site?.label ?? hostnameLabel(url)
          : hostnameLabel(url);
        const existing = (prev[siteId] ?? []).find((t) => t.id === tabId);
        const { nextMap, nextTabs } = patchSiteTab(prev, siteId, tabId, {
          url,
          // upsert 主页时带上现有/站点标题, 避免空 title
          ...(existing ? {} : { title: fallbackTitle }),
        });
        schedulePersistRef.current(siteId, nextTabs);
        return nextMap;
      });
    };
    // 整页导航 + SPA 站内路由: 都回写标签 url 并落库。
    // SiteWebview 用 initialSrc 固定挂载地址, 改 state.url 不会触发重载。
    const onNavigateFull = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) updateTabUrl(url);
    };
    const onNavigateInPage = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) updateTabUrl(url);
    };
    const onTitle = (e: Event) => {
      const t = (e as unknown as { title?: string }).title?.trim();
      if (!t || isPlaceholderTitle(t)) return;
      // 地址栏模式主页标题由 site.label 派生, 需同步 browserHomeTitle
      if (tabId.endsWith(HOME_SUFFIX)) {
        setBrowserHomeTitle(t);
      }
      setTabsBySite((prev) => {
        const site = moduleSitesRef.current.find((s) => s.id === siteId);
        const existing = (prev[siteId] ?? []).find((x) => x.id === tabId);
        const { nextMap, nextTabs } = patchSiteTab(prev, siteId, tabId, {
          title: t,
          ...(existing ? {} : { url: site?.url ?? "" }),
        });
        schedulePersistRef.current(siteId, nextTabs);
        return nextMap;
      });
    };
    const onStart = () => {
      setLoadingByTab((prev) => ({ ...prev, [tabId]: true }));
      setErrorMsgByTab((prev) => {
        if (!prev[tabId]) return prev;
        const n = { ...prev };
        delete n[tabId];
        return n;
      });
      setTabsBySite((prev) => {
        if (!(prev[siteId] ?? []).some((x) => x.id === tabId)) return prev;
        const { nextMap } = patchSiteTab(prev, siteId, tabId, { error: false });
        return nextMap;
      });
    };
    const onStop = () => {
      setLoadingByTab((prev) => ({ ...prev, [tabId]: false }));
      setReadyByTab((prev) => (prev[tabId] ? prev : { ...prev, [tabId]: true }));
    };
    const onFail = (e: Event) => {
      const detail = e as unknown as {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      };
      // 子 frame / 取消导航常误报, 与矩阵侧一致只认主文档真失败
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3 /* ERR_ABORTED */) return;
      setLoadingByTab((prev) => ({ ...prev, [tabId]: false }));
      const tip = detail.errorDescription || "页面加载失败";
      const msg = detail.validatedURL ? `${tip} · ${detail.validatedURL}` : tip;
      setErrorMsgByTab((prev) => ({ ...prev, [tabId]: msg }));
      setTabsBySite((prev) => {
        // 仅已有行时标错; 主页尚未 upsert 则跳过, 避免写入空 url
        if (!(prev[siteId] ?? []).some((x) => x.id === tabId) && !tabId.endsWith(HOME_SUFFIX)) {
          return prev;
        }
        const site = moduleSitesRef.current.find((s) => s.id === siteId);
        const existing = (prev[siteId] ?? []).find((x) => x.id === tabId);
        const { nextMap } = patchSiteTab(prev, siteId, tabId, {
          error: true,
          ...(existing ? {} : { url: site?.url ?? "", title: site?.label ?? "" }),
        });
        return nextMap;
      });
    };
    if (!el.getAttribute("data-snuby-bound")) {
      el.setAttribute("data-snuby-bound", "1");
      setLoadingByTab((prev) => (tabId in prev ? prev : { ...prev, [tabId]: true }));
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

  /** 回到当前站点主页默认地址 (对齐矩阵: 先切主标签再按需 loadURL) */
  const goHome = useCallback(() => {
    const site = moduleSites.find((s) => s.id === groupId) ?? moduleSites[0];
    if (!site) return;
    const homeId = `${site.id}${HOME_SUFFIX}`;
    const homeUrl = site.url;
    setActiveSiteInner(site.id);
    setActiveTab({ siteId: site.id, tabId: homeId });
    setShowHistory(false);
    onActiveSiteChange?.(site.id);
    window.setTimeout(() => {
      const el = webviewRefs.current[homeId] as
        | (HTMLElement & { loadURL?: (u: string) => void; getURL?: () => string })
        | null
        | undefined;
      if (!el?.loadURL) return;
      try {
        const cur = el.getURL?.() ?? "";
        if (isSameHomeUrl(cur, homeUrl)) {
          setCurrentUrl(homeUrl);
          return;
        }
        el.loadURL(homeUrl);
      } catch {
        el.loadURL(homeUrl);
      }
      setCurrentUrl(homeUrl);
    }, 60);
  }, [moduleSites, groupId, onActiveSiteChange]);

  const retryActiveTab = () => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;
    setErrorMsgByTab((prev) => {
      if (!prev[tabId]) return prev;
      const n = { ...prev };
      delete n[tabId];
      return n;
    });
    setLoadingByTab((prev) => ({ ...prev, [tabId]: true }));
    setTabsBySite((prev) => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        next[sid] = (next[sid] ?? []).map((x) =>
          x.id === tabId ? { ...x, error: false } : x,
        );
      }
      return next;
    });
    const el = webviewRefs.current[tabId] as
      | (HTMLElement & { reload?: () => void })
      | null
      | undefined;
    el?.reload?.();
  };

  // —— 站点管理动作 ——
  // ESC 关闭添加/编辑站点对话框
  useEffect(() => {
    if (!addSiteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddSiteOpen(false);
        setEditingSiteId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [addSiteOpen]);

  // 站点配置变更后同步主页标签 url/title (非地址栏模式)
  // 地址栏模式主页标题走 browserHomeTitle, 由 tabsOf→homeTab(site.label) 派生, 勿写入 tabsBySite
  useEffect(() => {
    if (addressMode) return;
    setTabsBySite((prev) => {
      let changed = false;
      const next: Record<string, SiteTab[]> = { ...prev };
      for (const s of moduleSites) {
        const tabs = next[s.id];
        if (!tabs?.length) continue;
        const homeId = `${s.id}${HOME_SUFFIX}`;
        const mapped = tabs.map((t) => {
          if (t.id !== homeId) return t;
          if (t.url === s.url && t.title === s.label) return t;
          changed = true;
          return { ...t, url: s.url, title: s.label };
        });
        next[s.id] = mapped;
      }
      return changed ? next : prev;
    });
  }, [moduleSites, addressMode]);

  const openAddSite = () => {
    setEditingSiteId(null);
    setSiteUrl("");
    setSiteLabel("");
    setAddSiteOpen(true);
  };
  const openEditSite = (siteId: string) => {
    const s = moduleSites.find((x) => x.id === siteId);
    if (!s) return;
    setEditingSiteId(siteId);
    setSiteUrl(s.url);
    setSiteLabel(s.label);
    setAddSiteOpen(true);
  };

  // 站点栏提示自动消失
  useEffect(() => {
    if (!siteNotice) return;
    const t = window.setTimeout(() => setSiteNotice(""), 2500);
    return () => window.clearTimeout(t);
  }, [siteNotice]);

  const handleAddSite = async () => {
    const url = siteUrl.trim();
    if (!url) return;
    const full = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
    if (editingSiteId) {
      const prev = moduleSites.find((s) => s.id === editingSiteId);
      const ok = await updateSite(moduleKey, editingSiteId, {
        url: full,
        label: siteLabel.trim(),
      });
      if (ok) {
        // 地址变更时让主页 webview 跟进导航
        if (prev && prev.url !== full) {
          const homeId = `${editingSiteId}${HOME_SUFFIX}`;
          const el = webviewRefs.current[homeId];
          if (el && typeof (el as unknown as { loadURL: (u: string) => void }).loadURL === "function") {
            (el as unknown as { loadURL: (u: string) => void }).loadURL(full);
          }
        }
        setSiteUrl("");
        setSiteLabel("");
        setEditingSiteId(null);
        setAddSiteOpen(false);
        setSiteNotice("站点已更新");
      } else {
        setSiteNotice("更新失败，请重试");
      }
      return;
    }
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
  const activeTabId = activeTabDef?.id ?? null;
  const activeLoading = !!(activeTabId && loadingByTab[activeTabId]);
  const activeReady = !!(activeTabId && readyByTab[activeTabId]);
  const activeErrorMsg = activeTabId ? errorMsgByTab[activeTabId] : undefined;
  const showFirstLoadOverlay = activeLoading && !activeReady && !activeErrorMsg;
  const showErrorOverlay = !!activeErrorMsg;

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
        <div className="flex h-[42px] shrink-0 items-stretch gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-surface px-4">
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.getSelection()?.removeAllRanges();
                  setCtxMenu({ x: e.clientX, y: e.clientY, siteId: s.id });
                }}
                title={`${s.label}\n${s.url}\n右键编辑`}
                className={[
                  "group relative flex shrink-0 select-none items-center gap-1.5 px-3 text-[13px] transition-colors duration-150",
                  active ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                <span className="inline-flex shrink-0 text-current">
                  {tabIconFor(`${s.url} ${s.label}`, "h-3.5 w-3.5")}
                </span>
                <span className="max-w-[140px] truncate">{s.label}</span>
                {active ? <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" /> : null}
                {moduleSites.length > 1 ? (
                  <span
                    role="button"
                    aria-label={`移除站点 ${s.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemoveSite(s.id);
                    }}
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-hover hover:text-red-500 group-hover:opacity-100"
                  >
                    <IconX className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
          {ctxMenu ? (
            <ContextMenuLayer x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
              <ContextMenuItem
                onClick={() => {
                  const site = moduleSites.find((x) => x.id === ctxMenu.siteId);
                  setCtxMenu(null);
                  if (site?.url) void copyTextToClipboard(site.url);
                }}
              >
                复制链接
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const id = ctxMenu.siteId;
                  setCtxMenu(null);
                  openEditSite(id);
                }}
              >
                编辑
              </ContextMenuItem>
              {moduleSites.length > 1 ? (
                <ContextMenuItem
                  danger
                  onClick={() => {
                    const id = ctxMenu.siteId;
                    setCtxMenu(null);
                    void handleRemoveSite(id);
                  }}
                >
                  删除
                </ContextMenuItem>
              ) : null}
            </ContextMenuLayer>
          ) : null}
          <div className="relative ml-1 flex shrink-0 items-center">
            <button
              type="button"
              title="添加站点"
              onClick={openAddSite}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <IconAdd className="h-4 w-4" />
            </button>
            {addSiteOpen ? (
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
                onClick={() => {
                  setAddSiteOpen(false);
                  setEditingSiteId(null);
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={editingSiteId ? "编辑站点" : "添加站点"}
                  onClick={(e) => e.stopPropagation()}
                  className="w-[440px] max-w-[90vw] rounded-xl border border-line bg-white p-5 shadow-2xl"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-[14.5px] font-bold text-ink">
                      {editingSiteId ? "编辑站点" : "添加站点"}
                    </span>
                    <button
                      type="button"
                      aria-label="关闭"
                      onClick={() => {
                        setAddSiteOpen(false);
                        setEditingSiteId(null);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
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
                        onClick={() => {
                          setAddSiteOpen(false);
                          setEditingSiteId(null);
                        }}
                        className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted hover:bg-hover"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAddSite()}
                        className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                      >
                        {editingSiteId ? "保存" : "添加"}
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

      {/* 站内标签页栏 + 工具栏: 与站点选项卡同构底线风格 (圆角壳内不再用 Chrome 浮起页签) */}
      <div className="flex h-[38px] shrink-0 items-stretch border-b border-line bg-surface">
        <div className="flex shrink-0 items-center border-r border-line px-1.5">
          <ToolButton label="回到主页" onClick={goHome} disabled={!moduleSites.length}>
            <IconHome />
          </ToolButton>
        </div>
        <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden px-1.5">
          {homeTabMenu ? (
            <ContextMenuLayer x={homeTabMenu.x} y={homeTabMenu.y} onClose={() => setHomeTabMenu(null)}>
              <ContextMenuItem
                onClick={() => {
                  const url = homeTabMenu.url;
                  setHomeTabMenu(null);
                  if (url) void copyTextToClipboard(url);
                }}
              >
                复制链接
              </ContextMenuItem>
              {addressMode && homeTabMenu.isHome ? (
                <>
                  <ContextMenuItem
                    onClick={() => {
                      setHomeTabMenu(null);
                      setEditHomeUrl(browserHome);
                      setEditHomeOpen(true);
                    }}
                  >
                    编辑主页
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      setHomeTabMenu(null);
                      const hint =
                        activeTabDef && !activeTabDef.id.endsWith(HOME_SUFFIX)
                          ? tabDisplayTitle(activeTabDef)
                          : undefined;
                      void applyBrowserHome(currentUrl || browserHome, hint);
                    }}
                  >
                    将当前页设为主页
                  </ContextMenuItem>
                </>
              ) : null}
            </ContextMenuLayer>
          ) : null}
          {groupTabs.map((t) => {
            const active = t.id === activeTabDef.id;
            const isHome = t.id.endsWith(HOME_SUFFIX);
            const tabLoading = !!loadingByTab[t.id];
            const tabErrMsg = errorMsgByTab[t.id];
            const liveUrl =
              active && currentUrl && currentUrl.startsWith("http") ? currentUrl : t.url;
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => activateTab(groupId, t.id)}
                onKeyDown={(e) => e.key === "Enter" && activateTab(groupId, t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.getSelection()?.removeAllRanges();
                  setHomeTabMenu({
                    x: e.clientX,
                    y: e.clientY,
                    tabId: t.id,
                    url: liveUrl,
                    isHome,
                  });
                }}
                title={
                  addressMode && isHome
                    ? `${tabErrMsg || liveUrl}\n右键可复制链接 / 编辑主页`
                    : tabErrMsg || liveUrl
                }
                className={[
                  "group relative flex min-w-0 shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-[12.5px] transition-colors duration-150",
                  active ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                {t.error || tabErrMsg ? <span className="text-red-500">⚠</span> : null}
                <span className="max-w-[140px] truncate">{tabDisplayTitle(t)}</span>
                {tabLoading && active ? (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                ) : null}
                {!isHome ? (
                  <button
                    type="button"
                    aria-label={`关闭 ${tabDisplayTitle(t)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(groupId, t.id);
                    }}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-hover hover:text-red-500 group-hover:opacity-100"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                ) : null}
                {active ? <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" /> : null}
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
            <div ref={addToTopicRef} className="relative">
              <ToolButton
                label="添加到主题"
                onClick={() => {
                  setShowHistory(false);
                  setAddToTopicOpen((v) => !v);
                }}
              >
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
                        className="flex w-full items-center gap-2 truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
                      >
                        <span className="shrink-0 text-ink-muted">{topicIcon(t.id)}</span>
                        <span className="min-w-0 truncate">{t.name}</span>
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
          <div ref={historyMenuRef} className="relative">
            <ToolButton
              label="历史"
              onClick={() => {
                setAddToTopicOpen(false);
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
                        className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
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

      {/* 内容区: 站点/标签均懒挂载 — 未切过的站点与标签不建 webview;
          已挂载的切回只切 opacity, 不销毁。★ 不用 visibility (会分离 Electron guest)。 */}
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
              {tabs.map((t) => {
                const shouldMount = mountedTabs.has(t.id) && !parkedIds[t.id];
                return (
                <div
                  key={t.id}
                  className="absolute inset-0 h-full w-full"
                  style={{
                    opacity: isActiveSite && t.id === activeTabDef.id ? 1 : 0,
                    pointerEvents: isActiveSite && t.id === activeTabDef.id ? "auto" : "none",
                    zIndex: isActiveSite && t.id === activeTabDef.id ? 10 : 0,
                  }}
                >
                  {!shouldMount ? null : t.url.startsWith("snuby://") ? (
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
                );
              })}
            </div>
          );
        })}
        {showFirstLoadOverlay ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            <span className="text-[13px] text-ink-muted">页面加载中…</span>
            <span className="max-w-[360px] truncate px-4 text-center text-[11.5px] text-ink-faint">
              网络较慢时请稍候
            </span>
          </div>
        ) : null}
        {activeLoading && activeReady && !activeErrorMsg ? (
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 h-0.5 overflow-hidden bg-black/[0.04]">
            <div className="h-full w-1/3 animate-pulse bg-accent" />
          </div>
        ) : null}
        {showErrorOverlay ? (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white px-6">
            <span className="text-[14px] font-medium text-ink">页面加载失败</span>
            <p className="max-w-[420px] break-all text-center text-[12px] leading-relaxed text-ink-muted">
              {activeErrorMsg}
            </p>
            <button
              type="button"
              onClick={retryActiveTab}
              className="mt-1 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              重新加载
            </button>
          </div>
        ) : null}
      </div>

      {editHomeOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          onClick={() => setEditHomeOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="编辑主页"
            onClick={(e) => e.stopPropagation()}
            className="w-[440px] max-w-[90vw] rounded-xl border border-line bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[14.5px] font-bold text-ink">编辑主页</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setEditHomeOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <input
              autoFocus
              value={editHomeUrl}
              onChange={(e) => setEditHomeUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void (async () => {
                    const ok = await applyBrowserHome(editHomeUrl);
                    if (ok) setEditHomeOpen(false);
                  })();
                }
                if (e.key === "Escape") setEditHomeOpen(false);
              }}
              placeholder="主页地址，如 https://www.google.com/"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditHomeOpen(false)}
                className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted hover:bg-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const ok = await applyBrowserHome(editHomeUrl);
                    if (ok) setEditHomeOpen(false);
                  })();
                }}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** 信息按钮: 点击切换下拉信息框, 链接可一键复制 */
function InfoButton({ tab }: { tab: SiteTab | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="标签页信息"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <IconInfo />
      </button>
      {open && tab ? (
        <div className="absolute right-0 top-[36px] z-50 w-[320px] rounded-lg border border-line bg-white p-3 shadow-xl">
          <div className="mb-1.5 truncate text-[12.5px] font-medium text-ink">{tab.title || "当前标签页"}</div>
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1 break-all text-[11.5px] leading-relaxed text-ink-muted">{tab.url}</div>
            <button
              type="button"
              title="复制链接"
              aria-label="复制链接"
              onClick={() => void copyUrl(tab.url)}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-hover hover:text-accent"
            >
              {copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
            </button>
          </div>
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
    const url = normalizeHttpUrl(value);
    if (!url) return;
    onNavigate(url);
  }

  return (
    <div className="flex h-[42px] shrink-0 items-center gap-2.5 bg-surface px-4">
      {title ? (
        <span className="shrink-0 whitespace-nowrap text-[14px] font-bold text-ink">{title}</span>
      ) : null}
      <div className="relative flex h-8 min-w-0 flex-1 items-center">
        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-ink-muted">
          <IconGlobe className="h-4 w-4" />
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="输入网址，回车访问"
          className="h-full w-full border-0 border-b border-line bg-transparent py-0 pl-6 pr-1 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-faint focus:border-accent"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        className="h-7 shrink-0 rounded-[6px] px-2.5 text-[12.5px] font-medium text-accent-deep transition-colors duration-150 hover:bg-accent-soft"
      >
        前往
      </button>
    </div>
  );
}
