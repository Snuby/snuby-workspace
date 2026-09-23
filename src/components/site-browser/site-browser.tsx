"use client";

// Spec: 017-site-tabs — 通用站点容器 (SiteBrowser)
// 任何以站点形式打开内容的模块统一使用: 站点选项卡(或地址栏) + 站内标签页 + 工具栏。
// 站内标签页: 每站点一组, 主页(官网)常驻不可关, 其余可关/可切换/可淘汰 (上限 maxTabs);
// 关闭的标签进历史 (上限 maxHistory, 可重开); 配置在设置页按模块独立维护 (SQLite)。
// 桌面版(Electron) 渲染 <webview>; 非 Electron 渲染外链兜底 (Web 版不再维护)。

import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { webviewPool } from "./webview-pool";

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
  const [loaded, setLoaded] = useState(false);
  const guestIdMapRef = useRef<Record<number, TabView>>({});
  /** 每个标签一个常驻 webview 实例 (tabId → element): 切标签只切 display, 不重建, 状态保留、无白屏 */
  const webviewRefs = useRef<Record<string, HTMLElement | null>>({});
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
  // 激活标签变化 → touch 池内对应 webview 的活跃时间 (切到即活跃, 防止被清扫误销毁)
  useEffect(() => {
    const tabId = activeTab && activeTab.siteId === groupId ? activeTab.tabId : null;
    if (tabId) webviewPool.touch(`${moduleKey}:${groupId}:${tabId}`);
  }, [activeTab, groupId, moduleKey]);
  // 读取全局 WebView 保留策略 (设置页 module=webview 行), 应用到全局池
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/site-tabs?module=webview");
        if (!res.ok) return;
        const data = await res.json();
        const sv = data.settings as { webviewMinKeep?: number; webviewRetentionHours?: number };
        if (
          sv &&
          typeof sv.webviewMinKeep === "number" &&
          typeof sv.webviewRetentionHours === "number"
        ) {
          webviewPool.setPolicy(sv.webviewMinKeep, sv.webviewRetentionHours * 3600 * 1000);
        }
      } catch {
        // 读取失败保持默认策略 (5 个 + 3 小时)
      }
    })();
  }, []);

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
      const host = guestIdMapRef.current[detail.guestId ?? -1];
      const siteId = host?.siteId ?? groupId;
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
    } else {
      delete webviewRefs.current[tabId];
      return;
    }
    const onAttach = () => {
      const gid = (el as unknown as { getWebContentsId?: () => number }).getWebContentsId?.();
      if (typeof gid === "number") {
        guestIdMapRef.current[gid] = { siteId, tabId };
      }
    };
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
      el.addEventListener("did-attach", onAttach);
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
                  "shrink-0 px-3 text-[13px] transition-colors",
                  active ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                {s.label}
                {active ? <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" /> : null}
              </button>
            );
          })}
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

      {/* 内容区: 每个标签一个常驻 webview, 非激活隐藏 — 切标签不重建, 无白屏且浏览状态保留 */}
      <div className="min-h-0 flex-1">
        {groupTabs.map((t) => (
          <div
            key={t.id}
            className="h-full w-full"
            style={t.id === activeTabDef.id ? undefined : { display: "none" }}
          >
            <SiteWebview
              moduleKey={moduleKey}
              src={t.url}
              siteId={groupId}
              tabId={t.id}
              partition={activeSiteDef?.partition}
              onRef={registerGuest}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 标签 webview: 全局池化实例
 * - 首次挂载创建 webview 并存入 webviewPool (key=module:site:tab)
 * - 站点/模块切换卸载时, webview 移入池的隐藏容器保留, 浏览状态不丢
 * - 切回时直接取回原实例 append 到宿主 div, 无需重新加载
 * - src 只在新建时取一次: 标签 url 后续变化 (did-navigate 回写) 不触发重载, 避免 SPA 无限刷新
 * - 池内不活跃超过 30 分钟的实例由 webviewPool 后台清扫销毁
 */
function SiteWebview({
  moduleKey,
  src,
  siteId,
  tabId,
  partition,
  onRef,
}: {
  moduleKey: string;
  src: string;
  siteId: string;
  tabId: string;
  partition?: string;
  onRef: (el: HTMLElement | null, siteId: string, tabId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const key = useMemo(() => `${moduleKey}:${siteId}:${tabId}`, [moduleKey, siteId, tabId]);
  const [initialSrc] = useState(src);

  // 必须用 useLayoutEffect: 其 cleanup 在 React 移除 DOM 之前执行。
  // useEffect 的 cleanup 在 DOM 移除之后才跑, 届时 host div 已连同 webview 一起被销毁,
  // hide 只会把"死"实例放进池, 切回时恢复失败 (表现为缓存不生效)。
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let el = webviewPool.get(key);
    if (!el) {
      el = document.createElement("webview");
      el.setAttribute("src", initialSrc);
      if (partition) el.setAttribute("partition", partition);
      el.setAttribute("allowpopups", "true");
      el.setAttribute("class", "h-full w-full border-0");
      el.style.width = "100%";
      el.style.height = "100%";
      webviewPool.put(key, el);
      onRef(el, siteId, tabId);
    } else {
      webviewPool.touch(key);
    }
    host.appendChild(el);
    return () => {
      // 组件卸载: 把 webview 移入全局隐藏容器保留 (不随 React DOM 销毁)
      webviewPool.hide(key, el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return createElement("div", { ref: hostRef, className: "h-full w-full" });
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
