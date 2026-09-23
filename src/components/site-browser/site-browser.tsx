"use client";

// Spec: 017-site-tabs — 通用站点容器 (SiteBrowser)
// 任何以站点形式打开内容的模块统一使用: 站点选项卡(或地址栏) + 站内标签页 + 工具栏。
// 站内标签页: 每站点一组, 主页(官网)常驻不可关, 其余可关/可切换/可淘汰 (上限 maxTabs);
// 关闭的标签进历史 (上限 maxHistory, 可重开); 配置在设置页按模块独立维护 (SQLite)。
// 桌面版(Electron) 渲染 <webview>; 非 Electron 渲染外链兜底 (Web 版不再维护)。

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type SiteSettings = { maxTabs: number; maxHistory: number };
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
const IconPlus = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
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
  const webviewRef = useRef<HTMLElement | null>(null);

  const activeSite = activeSiteProp ?? activeSiteInner;
  const moduleSites = useMemo(() => sites, [sites]);
  const groupId = addressMode ? "default" : activeSite;

  // —— 数据加载 (SQLite, 每模块) ——
  useEffect(() => {
    setDesktopState(isElectronEnv() ? "yes" : "no");
    if (!isElectronEnv()) return;
    (async () => {
      try {
        const res = await fetch(`/api/site-tabs?module=${encodeURIComponent(moduleKey)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        if (data.tabs) setTabsBySite(data.tabs);
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
      openTab(siteId, detail.url);
    };
    window.addEventListener("snuby-webview-popup", onPopup);
    return () => window.removeEventListener("snuby-webview-popup", onPopup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, loaded]);

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
      const group = tabsBySite[siteId] ?? [];
      const urlNorm = url.split("#")[0];
      // URL 去重: 同 URL 标签已存在 → 激活之
      const existing = group.find((t) => t.url.split("#")[0] === urlNorm);
      if (existing) {
        setActiveTab({ siteId, tabId: existing.id });
        setActiveSiteInner(siteId);
        return;
      }
      const next = [...group];
      // 超限: 淘汰最旧非主页标签, 进历史
      let evicted: SiteTab | null = null;
      if (next.length >= settings.maxTabs - 1) {
        evicted = next.shift() ?? null;
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
    webviewRef.current = el;
    if (!el) return;
    const onAttach = () => {
      const gid = (el as unknown as { getWebContentsId?: () => number }).getWebContentsId?.();
      if (typeof gid === "number") {
        guestIdMapRef.current[gid] = { siteId, tabId };
      }
    };
    const onNavigate = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) {
        setCurrentUrl(url);
        setTabsBySite((prev) => ({
          ...prev,
          [siteId]: (prev[siteId] ?? []).map((t) => (t.id === tabId ? { ...t, url } : t)),
        }));
      }
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
      el.addEventListener("did-navigate", onNavigate);
      el.addEventListener("did-navigate-in-page", onNavigate);
      el.addEventListener("page-title-updated", onTitle);
      el.addEventListener("did-start-loading", onStart);
      el.addEventListener("did-stop-loading", onStop);
      el.addEventListener("did-fail-load", onFail);
    }
  }, []);

  // —— 工具栏动作 (作用于激活标签) ——
  const nav = (fn: "goBack" | "goForward" | "reload") => {
    const el = webviewRef.current;
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 站点层: 选项卡 或 地址栏 (hideSiteBar 时由外部渲染) */}
      {hideSiteBar ? null : addressMode ? (
        <AddressBar
          title={title}
          currentUrl={currentUrl}
          onNavigate={(url) => {
            const el = webviewRef.current;
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
          <button
            type="button"
            title="新建标签"
            onClick={() => openTab(groupId, activeSiteDef.url)}
            className="mb-[6px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-black/10 hover:text-ink"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </button>
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

      {/* 内容区: 激活标签的 webview */}
      <div className="min-h-0 flex-1">
        {activeTabDef ? (
          <div className="flex h-full w-full flex-col">
            <div className="min-h-0 flex-1">
              <SiteWebview
                key={`${groupId}-${activeTabDef.id}`}
                src={activeTabDef.url}
                siteId={groupId}
                tabId={activeTabDef.id}
                partition={activeSiteDef?.partition}
                onRef={registerGuest}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 激活标签的 webview 挂载 (每标签一个实例; 切换时重建, 内部浏览状态不保留) */
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
  const setEl = useCallback(
    (el: HTMLElement | null) => {
      onRef(el, siteId, tabId);
    },
    [onRef, siteId, tabId],
  );

  return createElement("div", { className: "h-full w-full" }, [
    createElement("webview", {
      ref: setEl,
      src,
      partition,
      allowpopups: "true",
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
