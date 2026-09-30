"use client";

// 自媒体账号矩阵 · 平台工作台
// 布局: 顶栏(平台/账号切换/添加) · 下方全宽多标签 WebView (一账号一 persist partition)
// 主标签默认不可在工具栏关闭; 监控页可回收主页以释放内存, 再次进入平台时重建。

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  homeTabIdOf,
  isHomeTabId,
  type MatrixAccount,
  type MatrixPlatform,
  type MatrixTab,
} from "@/lib/matrix-types";
import {
  IconUser,
  tabIconFor,
} from "@/components/ui/site-favicon";
import { ContextMenuItem, ContextMenuLayer } from "@/components/ui/context-menu-layer";
import {
  readWebContentsId,
  registerMonitorSource,
  type MonitorTabInfo,
} from "@/lib/monitor-registry";

type Props = {
  platformId: string;
  active: boolean;
};

function isElectronEnv(): boolean {
  return typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
}

export default function MatrixPlatformView({ platformId, active }: Props) {
  const [platform, setPlatform] = useState<MatrixPlatform | null>(null);
  const [accounts, setAccounts] = useState<MatrixAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [tabsByAccount, setTabsByAccount] = useState<Record<string, MatrixTab[]>>({});
  const [activeTabByAccount, setActiveTabByAccount] = useState<Record<string, string>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; accountId: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  /** 标签加载态 (内存, 不落库) */
  const [loadingByTab, setLoadingByTab] = useState<Record<string, boolean>>({});
  /** 标签是否已成功完成过至少一次加载 — 首屏白屏才盖全屏提示 */
  const [readyByTab, setReadyByTab] = useState<Record<string, boolean>>({});
  const [errorByTab, setErrorByTab] = useState<Record<string, string>>({});
  /** 监控回收主页: 卸 webview, 平台再次激活时重建 */
  const [parkedIds, setParkedIds] = useState<Record<string, true>>({});

  const webviewRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabAccountRef = useRef<Record<string, string>>({});
  const activeTabIdRef = useRef<string | null>(null);
  const tabsByAccountRef = useRef(tabsByAccount);
  tabsByAccountRef.current = tabsByAccount;
  /** popup 监听 effect 依赖少: 用 ref 避免闭包拿到陈旧 openTab / 错误账号 */
  const openTabRef = useRef<((accountId: string, url: string) => void) | null>(null);
  const persistTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const parkedIdsRef = useRef(parkedIds);
  parkedIdsRef.current = parkedIds;
  const lastActiveAtRef = useRef<Record<string, number>>({});

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const groupTabs = activeAccountId ? (tabsByAccount[activeAccountId] ?? []) : [];
  const activeTabId =
    (activeAccountId && activeTabByAccount[activeAccountId]) || groupTabs[0]?.id || null;
  activeTabIdRef.current = activeTabId;
  const activeLoading = !!(activeTabId && loadingByTab[activeTabId]);
  const activeReady = !!(activeTabId && readyByTab[activeTabId]);
  const activeError = activeTabId ? errorByTab[activeTabId] : undefined;
  const showFirstLoadOverlay = activeLoading && !activeReady && !activeError;
  const showErrorOverlay = !!activeError;

  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const platformRef = useRef(platform);
  platformRef.current = platform;
  const activeTabByAccountRef = useRef(activeTabByAccount);
  activeTabByAccountRef.current = activeTabByAccount;
  const closeTabRef = useRef<(accountId: string, tabId: string) => void>(() => {});

  useEffect(() => {
    if (!active) return;
    setParkedIds((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [active]);

  useEffect(() => {
    if (!activeTabId) return;
    lastActiveAtRef.current[activeTabId] = Date.now();
  }, [activeTabId]);

  useEffect(() => {
    if (!active || !activeTabId) return;
    lastActiveAtRef.current[activeTabId] = Date.now();
  }, [active, activeTabId]);

  // —— 监控注册 ——
  useEffect(() => {
    return registerMonitorSource(`matrix:${platformId}`, {
      list: () => {
        const rows: MonitorTabInfo[] = [];
        const plat = platformRef.current;
        const moduleLabel = plat?.name ?? platformId;
        for (const acc of accountsRef.current) {
          const tabs = tabsByAccountRef.current[acc.id] ?? [];
          const activeId = activeTabByAccountRef.current[acc.id] ?? tabs[0]?.id;
          for (const t of tabs) {
            if (parkedIdsRef.current[t.id]) continue;
            if (!(t.id in lastActiveAtRef.current)) {
              lastActiveAtRef.current[t.id] = Date.now();
            }
            rows.push({
              section: "matrix",
              moduleKey: platformId,
              moduleLabel,
              groupId: acc.id,
              groupLabel: acc.displayName || acc.id,
              tabId: t.id,
              title: t.title || t.url,
              url: t.url,
              isHome: isHomeTabId(t.id),
              isActive: activeId === t.id,
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
  }, [platformId]);


  const refreshAccounts = useCallback(async () => {
    const r = await fetch(`/api/matrix/accounts?platform=${encodeURIComponent(platformId)}`, {
      cache: "no-store",
    });
    const j = (await r.json()) as {
      accounts?: MatrixAccount[];
      activeAccountId?: string | null;
    };
    const list = j.accounts ?? [];
    setAccounts(list);
    const aid = j.activeAccountId && list.some((a) => a.id === j.activeAccountId)
      ? j.activeAccountId
      : list[0]?.id ?? null;
    setActiveAccountId(aid);
    return { list, aid };
  }, [platformId]);

  const loadTabsFor = useCallback(
    async (accountId: string) => {
      const r = await fetch(
        `/api/matrix/tabs?platform=${encodeURIComponent(platformId)}&account=${encodeURIComponent(accountId)}`,
        { cache: "no-store" },
      );
      const j = (await r.json()) as { tabs?: MatrixTab[] };
      const tabs = j.tabs ?? [];
      setTabsByAccount((prev) => ({ ...prev, [accountId]: tabs }));
      setActiveTabByAccount((prev) => ({
        ...prev,
        [accountId]: prev[accountId] && tabs.some((t) => t.id === prev[accountId])
          ? prev[accountId]!
          : tabs[0]?.id ?? homeTabIdOf(accountId),
      }));
    },
    [platformId],
  );

  const persistTabs = useCallback(
    async (accountId: string, tabs: MatrixTab[]) => {
      await fetch("/api/matrix/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId, accountId, tabs }),
      });
    },
    [platformId],
  );

  /** 标题/URL 变更后防抖落盘, 避免只靠卸载落库 — 强杀时标题会停在「…」 */
  const schedulePersist = useCallback(
    (accountId: string, tabsSnapshot?: MatrixTab[]) => {
      const prev = persistTimerRef.current[accountId];
      if (prev) clearTimeout(prev);
      persistTimerRef.current[accountId] = setTimeout(() => {
        const tabs = tabsSnapshot ?? tabsByAccountRef.current[accountId];
        if (tabs?.length) void persistTabs(accountId, tabs);
      }, 400);
    },
    [persistTabs],
  );

  // 首屏: 平台元数据 + 账号
  useEffect(() => {
    void (async () => {
      try {
        const pr = await fetch("/api/matrix/platforms", { cache: "no-store" });
        const pj = (await pr.json()) as { platforms?: MatrixPlatform[] };
        setPlatform(pj.platforms?.find((p) => p.id === platformId) ?? null);
        const { list, aid } = await refreshAccounts();
        await Promise.all(list.map((a) => loadTabsFor(a.id)));
        if (aid) {
          // loadTabsFor already set
        }
      } catch {
        setNotice("加载失败");
      }
    })();
  }, [platformId, refreshAccounts, loadTabsFor]);

  // 卸载前落盘当前所有账号标签
  useEffect(() => {
    return () => {
      for (const t of Object.values(persistTimerRef.current)) clearTimeout(t);
      persistTimerRef.current = {};
      for (const [aid, tabs] of Object.entries(tabsByAccountRef.current)) {
        if (tabs.length) void persistTabs(aid, tabs);
      }
    };
  }, [persistTabs]);

  // webview 可见性 (同 SiteBrowser: opacity + pe, 按激活标签精确设置)
  useEffect(() => {
    if (!isElectronEnv()) return;
    for (const [tabId, el] of Object.entries(webviewRefs.current)) {
      if (!el) continue;
      const accId = tabAccountRef.current[tabId];
      if (!accId) continue;
      const show = active && accId === activeAccountId && tabId === activeTabId;
      el.style.opacity = show ? "1" : "0";
      el.style.pointerEvents = show ? "auto" : "none";
    }
  }, [active, activeAccountId, activeTabId, tabsByAccount, accounts]);

  // popup → 新标签 (与 SiteBrowser 同策略: 按 guestId 精确归属, 多平台常驻时互不抢)
  useEffect(() => {
    if (!isElectronEnv()) return;
    const onPopup = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string; guestId?: number }>).detail;
      if (!detail?.url || typeof detail.guestId !== "number") return;
      let hit: Element | null = null;
      for (const w of document.querySelectorAll<Element>("webview")) {
        const wv = w as unknown as { getWebContentsId?: () => number };
        if (typeof wv.getWebContentsId === "function" && wv.getWebContentsId() === detail.guestId) {
          hit = w;
          break;
        }
      }
      if (!hit) return;
      // 只处理本平台 webview; 微信/头条视图都在听同一 window 事件, 必须按 platform 过滤
      if (hit.getAttribute("data-platform-id") !== platformId) return;
      const accountId = hit.getAttribute("data-account-id");
      if (!accountId) return;
      openTabRef.current?.(accountId, detail.url);
    };
    window.addEventListener("snuby-webview-popup", onPopup);
    return () => window.removeEventListener("snuby-webview-popup", onPopup);
  }, [platformId]);

  const registerGuest = useCallback(
    (el: HTMLElement | null, accountId: string, tabId: string) => {
      webviewRefs.current[tabId] = el;
      tabAccountRef.current[tabId] = accountId;
      if (!el) return;
      const onTitle = (e: Event) => {
        const t = (e as unknown as { title?: string }).title;
        if (!t) return;
        setTabsByAccount((prev) => {
          const tabs = prev[accountId];
          if (!tabs) return prev;
          const next = tabs.map((x) => (x.id === tabId ? { ...x, title: t } : x));
          schedulePersist(accountId, next);
          return { ...prev, [accountId]: next };
        });
      };
      const onNav = () => {
        const url = (el as unknown as { getURL?: () => string }).getURL?.();
        if (!url || isHomeTabId(tabId)) return;
        setTabsByAccount((prev) => {
          const tabs = prev[accountId];
          if (!tabs) return prev;
          const next = tabs.map((x) => (x.id === tabId ? { ...x, url } : x));
          schedulePersist(accountId, next);
          return { ...prev, [accountId]: next };
        });
      };
      const onStart = () => {
        setLoadingByTab((prev) => ({ ...prev, [tabId]: true }));
        setErrorByTab((prev) => {
          if (!prev[tabId]) return prev;
          const next = { ...prev };
          delete next[tabId];
          return next;
        });
      };
      const onStop = () => {
        setLoadingByTab((prev) => ({ ...prev, [tabId]: false }));
        setReadyByTab((prev) => (prev[tabId] ? prev : { ...prev, [tabId]: true }));
      };
      const onFail = (e: Event) => {
        // 子 frame / 被取消的导航常误报 (如微信小程序客服 wujie iframe); 只提示主文档真失败
        const detail = e as unknown as {
          errorCode?: number;
          errorDescription?: string;
          validatedURL?: string;
          isMainFrame?: boolean;
        };
        if (detail.isMainFrame === false) return;
        if (detail.errorCode === -3 /* ERR_ABORTED */) return;
        setLoadingByTab((prev) => ({ ...prev, [tabId]: false }));
        const tip = detail.errorDescription || "页面加载失败";
        const msg = detail.validatedURL ? `${tip} · ${detail.validatedURL}` : tip;
        setErrorByTab((prev) => ({ ...prev, [tabId]: msg }));
      };
      if (!el.getAttribute("data-snuby-bound")) {
        el.setAttribute("data-snuby-bound", "1");
        // 挂载到首次 stop 前视为加载中, 避免 did-start 前长时间白屏无反馈
        setLoadingByTab((prev) => (tabId in prev ? prev : { ...prev, [tabId]: true }));
        el.addEventListener("page-title-updated", onTitle);
        el.addEventListener("did-navigate", onNav);
        el.addEventListener("did-navigate-in-page", onNav);
        el.addEventListener("did-start-loading", onStart);
        el.addEventListener("did-stop-loading", onStop);
        el.addEventListener("did-fail-load", onFail);
      }
    },
    [schedulePersist],
  );

  const selectAccount = async (accountId: string) => {
    setActiveAccountId(accountId);
    await fetch("/api/matrix/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate", platformId, accountId }),
    });
    if (!tabsByAccount[accountId]) await loadTabsFor(accountId);
  };

  const addAccount = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/matrix/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", platformId }),
      });
      const j = (await r.json()) as { account?: MatrixAccount; error?: string };
      if (!j.account) {
        setNotice(j.error ?? "添加失败");
        return;
      }
      await refreshAccounts();
      await loadTabsFor(j.account.id);
      await selectAccount(j.account.id);
      setNotice("已添加账号，请登录");
    } finally {
      setBusy(false);
    }
  };

  const commitRename = async () => {
    const accountId = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    setRenameValue("");
    if (!accountId || !name) return;
    const r = await fetch("/api/matrix/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", platformId, accountId, displayName: name }),
    });
    if (r.ok) await refreshAccounts();
  };

  // 顶栏状态提示自动消失, 避免长期残留
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const openRenameDialog = (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    setCtxMenu(null);
    setRenamingId(accountId);
    setRenameValue(acc?.displayName ?? "");
  };

  const removeAccount = async (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    if (
      !window.confirm(
        `删除账号「${acc?.displayName ?? accountId}」？\n该账号的登录态与本地存储将一并清除，且不可恢复。`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      // 先卸 webview 引用
      const tabs = tabsByAccount[accountId] ?? [];
      for (const t of tabs) {
        delete webviewRefs.current[t.id];
        delete tabAccountRef.current[t.id];
      }
      const r = await fetch("/api/matrix/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", platformId, accountId }),
      });
      const j = (await r.json()) as { ok?: boolean; partitionKey?: string; error?: string };
      if (!j.ok) {
        setNotice(j.error ?? "删除失败");
        return;
      }
      if (j.partitionKey && window.snubyDesktop?.clearPartition) {
        try {
          await window.snubyDesktop.clearPartition(j.partitionKey);
        } catch {
          setNotice("账号已删，但清理本地存储失败（可重启后再试）");
        }
      }
      setTabsByAccount((prev) => {
        const next = { ...prev };
        delete next[accountId];
        return next;
      });
      const { list, aid } = await refreshAccounts();
      if (aid) await loadTabsFor(aid);
      else setActiveAccountId(null);
      setNotice(list.length ? "账号已删除并清理登录态" : "账号已删除");
    } finally {
      setBusy(false);
    }
  };

  const openTab = (accountId: string, url: string) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tab: MatrixTab = { id, url, title: "…" };
    setTabsByAccount((prev) => {
      const next = [...(prev[accountId] ?? []), tab];
      void persistTabs(accountId, next);
      return { ...prev, [accountId]: next };
    });
    setActiveTabByAccount((prev) => ({ ...prev, [accountId]: id }));
    setLoadingByTab((prev) => ({ ...prev, [id]: true }));
    // 后台账号弹出的标签: 切到该账号, 避免「开了但看不见」
    setActiveAccountId((cur) => (cur === accountId ? cur : accountId));
  };
  openTabRef.current = openTab;

  const closeTab = (accountId: string, tabId: string) => {
    if (isHomeTabId(tabId)) {
      setParkedIds((prev) => ({ ...prev, [tabId]: true }));
      delete webviewRefs.current[tabId];
      delete tabAccountRef.current[tabId];
      return;
    }
    setTabsByAccount((prev) => {
      const tabs = prev[accountId] ?? [];
      const idx = tabs.findIndex((t) => t.id === tabId);
      const next = tabs.filter((t) => t.id !== tabId);
      void persistTabs(accountId, next);
      setActiveTabByAccount((ap) => {
        if (ap[accountId] !== tabId) return ap;
        const fallback = next[Math.min(idx, next.length - 1)] ?? next[0];
        return { ...ap, [accountId]: fallback?.id ?? homeTabIdOf(accountId) };
      });
      delete webviewRefs.current[tabId];
      delete tabAccountRef.current[tabId];
      return { ...prev, [accountId]: next };
    });
    setLoadingByTab((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setReadyByTab((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setErrorByTab((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  };
  closeTabRef.current = closeTab;

  const nav = (fn: "goBack" | "goForward" | "reload") => {
    const el = activeTabId ? webviewRefs.current[activeTabId] : null;
    if (el && typeof (el as unknown as Record<string, () => void>)[fn] === "function") {
      (el as unknown as Record<string, () => void>)[fn]();
    }
  };

  const retryActive = () => {
    if (!activeTabId) return;
    setErrorByTab((prev) => {
      if (!prev[activeTabId]) return prev;
      const next = { ...prev };
      delete next[activeTabId];
      return next;
    });
    setLoadingByTab((prev) => ({ ...prev, [activeTabId]: true }));
    const el = webviewRefs.current[activeTabId] as
      | (HTMLElement & { reload?: () => void; loadURL?: (url: string) => void })
      | null
      | undefined;
    if (el?.reload) {
      el.reload();
      return;
    }
    const tab = activeAccountId
      ? (tabsByAccount[activeAccountId] ?? []).find((t) => t.id === activeTabId)
      : null;
    if (tab?.url && el?.loadURL) el.loadURL(tab.url);
  };

  /** 回到主页: 先切到主标签并等可见, 再按需导航 (隐藏态 loadURL 易导致 Electron webview 白屏) */
  const goHome = () => {
    if (!activeAccount || !platform) return;
    const accountId = activeAccount.id;
    const homeId = homeTabIdOf(accountId);
    const homeUrl = platform.homeUrl;
    setActiveTabByAccount((prev) => ({ ...prev, [accountId]: homeId }));
    window.setTimeout(() => {
      const el = webviewRefs.current[homeId] as
        | (HTMLElement & { loadURL?: (url: string) => void; getURL?: () => string })
        | null
        | undefined;
      if (!el?.loadURL) return;
      try {
        const cur = el.getURL?.() ?? "";
        if (isSameHomeUrl(cur, homeUrl)) return;
        el.loadURL(homeUrl);
      } catch {
        el.loadURL(homeUrl);
      }
    }, 60);
  };

  if (!platform) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">加载中…</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 顶栏: 与主题站点选项卡同构 (底线激活 + lucide 图标 + 悬停删除 / 右键重命名) */}
      <div className="flex h-[42px] shrink-0 items-stretch gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-surface px-4">
        <span className="mr-2 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-bold text-ink">
          {tabIconFor(`${platform.id} ${platform.homeUrl} ${platform.name}`, "h-3.5 w-3.5")}
          {platform.name}
        </span>
        {accounts.length === 0 ? (
          <span className="flex items-center px-1 text-[12px] text-ink-faint">还没有账号，点右侧添加后登录</span>
        ) : (
          accounts.map((a) => {
            const selected = a.id === activeAccountId;
            return (
              <div
                key={a.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.getSelection()?.removeAllRanges();
                  setCtxMenu({ x: e.clientX, y: e.clientY, accountId: a.id });
                }}
                className={[
                  "group relative flex shrink-0 select-none items-center gap-1.5 px-3 text-[13px] transition-colors duration-150",
                  selected ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => void selectAccount(a.id)}
                  className="flex max-w-[140px] items-center gap-1.5 truncate"
                  title={`${a.displayName}\n右键重命名`}
                >
                  <IconUser className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{a.displayName}</span>
                </button>
                {selected ? (
                  <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" />
                ) : null}
                <button
                  type="button"
                  aria-label={`删除 ${a.displayName}`}
                  onClick={() => void removeAccount(a.id)}
                  className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-hover hover:text-red-500 group-hover:opacity-100"
                  title="删除"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
        <div className="relative ml-1 flex shrink-0 items-center">
          <button
            type="button"
            disabled={busy}
            title="添加账号"
            onClick={() => void addAccount()}
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <IconAdd className="h-4 w-4" />
          </button>
        </div>
        {notice ? (
          <span className="ml-auto flex max-w-[200px] shrink-0 items-center truncate text-[11.5px] text-ink-faint">
            {notice}
          </span>
        ) : null}
      </div>

      {/* 账号右键菜单 */}
      {ctxMenu ? (
        <ContextMenuLayer x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          <ContextMenuItem onClick={() => openRenameDialog(ctxMenu.accountId)}>重命名</ContextMenuItem>
          <ContextMenuItem
            danger
            onClick={() => {
              const id = ctxMenu.accountId;
              setCtxMenu(null);
              void removeAccount(id);
            }}
          >
            删除
          </ContextMenuItem>
        </ContextMenuLayer>
      ) : null}

      {/* 重命名弹框 */}
      {renamingId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          onClick={() => {
            setRenamingId(null);
            setRenameValue("");
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="重命名账号"
            onClick={(e) => e.stopPropagation()}
            className="w-[360px] max-w-[90vw] rounded-xl border border-line bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 text-[14.5px] font-bold text-ink">重命名账号</div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") {
                  setRenamingId(null);
                  setRenameValue("");
                }
              }}
              placeholder="显示名称"
              className="mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenamingId(null);
                  setRenameValue("");
                }}
                className="rounded-lg px-3 py-1.5 text-[13px] text-ink-muted hover:bg-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void commitRename()}
                className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 内容区全宽 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!activeAccount ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-ink-faint">
              请先在顶栏添加并选择账号
            </div>
          ) : (
            <>
              <div className="flex h-[38px] shrink-0 items-stretch border-b border-line bg-surface">
                <div className="flex shrink-0 items-center border-r border-line px-1.5">
                  <ToolBtn label="回到主页" onClick={goHome}>
                    <IconHome />
                  </ToolBtn>
                </div>
                <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden px-1.5">
                  {groupTabs.map((t) => {
                    const isActive = t.id === activeTabId;
                    const home = isHomeTabId(t.id);
                    const tabLoading = !!loadingByTab[t.id];
                    const tabError = !!errorByTab[t.id];
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setActiveTabByAccount((prev) => ({
                            ...prev,
                            [activeAccount.id]: t.id,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setActiveTabByAccount((prev) => ({
                              ...prev,
                              [activeAccount.id]: t.id,
                            }));
                          }
                        }}
                        title={tabError ? errorByTab[t.id] : t.url}
                        className={[
                          "group relative flex min-w-0 shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-[12.5px] transition-colors duration-150",
                          isActive ? "font-semibold text-accent-deep" : "text-ink-muted hover:text-ink",
                        ].join(" ")}
                      >
                        {tabError ? <span className="text-red-500">⚠</span> : null}
                        <span className="max-w-[140px] truncate">
                          {home ? platform.homeTitle : t.title || "…"}
                        </span>
                        {tabLoading && isActive ? (
                          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                        ) : null}
                        {!home ? (
                          <button
                            type="button"
                            aria-label="关闭标签"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(activeAccount.id, t.id);
                            }}
                            className="pointer-events-none flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-hover hover:text-red-500 group-hover:pointer-events-auto group-hover:opacity-100"
                          >
                            <IconX className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        {isActive ? (
                          <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5 pr-2">
                  <ToolBtn label="后退" onClick={() => nav("goBack")}>
                    <IconBack />
                  </ToolBtn>
                  <ToolBtn label="前进" onClick={() => nav("goForward")}>
                    <IconForward />
                  </ToolBtn>
                  <ToolBtn label="刷新" onClick={() => nav("reload")}>
                    <IconReload />
                  </ToolBtn>
                </div>
              </div>
              <div className="relative min-h-0 flex-1 bg-surface">
                {accounts.map((acc) => {
                  const tabs = tabsByAccount[acc.id] ?? [];
                  return tabs.map((t) =>
                    parkedIds[t.id] ? null : (
                    <div
                      key={`${acc.id}:${t.id}`}
                      className="absolute inset-0"
                      style={{
                        // 容器层也跟可见性走; 精确 pe 仍由 effect 打在 webview 上
                        opacity: acc.id === activeAccountId && t.id === activeTabId ? 1 : 0,
                        pointerEvents:
                          acc.id === activeAccountId && t.id === activeTabId ? "auto" : "none",
                        zIndex: acc.id === activeAccountId && t.id === activeTabId ? 2 : 0,
                      }}
                    >
                      <AccountWebview
                        src={t.url}
                        platformId={platformId}
                        accountId={acc.id}
                        tabId={t.id}
                        partition={acc.partitionKey}
                        onRef={registerGuest}
                      />
                    </div>
                    ),
                  );
                })}
                {showFirstLoadOverlay ? (
                  <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                    <span className="text-[13px] text-ink-muted">页面加载中…</span>
                    <span className="max-w-[360px] truncate px-4 text-center text-[11.5px] text-ink-faint">
                      网络较慢时请稍候
                    </span>
                  </div>
                ) : null}
                {activeLoading && activeReady && !activeError ? (
                  <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-0.5 overflow-hidden bg-black/[0.04]">
                    <div className="h-full w-1/3 animate-pulse bg-accent" />
                  </div>
                ) : null}
                {showErrorOverlay ? (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface px-6">
                    <span className="text-[14px] font-medium text-ink">页面加载失败</span>
                    <p className="max-w-[420px] break-all text-center text-[12px] leading-relaxed text-ink-muted">
                      {activeError}
                    </p>
                    <button
                      type="button"
                      onClick={retryActive}
                      className="mt-1 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                    >
                      重新加载
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
      </div>
    </div>
  );
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

function ToolBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-3.5 w-3.5"}
    >
      {children}
    </svg>
  );
}
const IconBack = () => (
  <Icon>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>
);
const IconForward = () => (
  <Icon>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);
const IconReload = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);
const IconHome = () => (
  <Icon>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
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

function AccountWebview({
  src,
  platformId,
  accountId,
  tabId,
  partition,
  onRef,
}: {
  src: string;
  platformId: string;
  accountId: string;
  tabId: string;
  partition: string;
  onRef: (el: HTMLElement | null, accountId: string, tabId: string) => void;
}) {
  const [initialSrc] = useState(src);
  const setEl = useCallback(
    (el: HTMLElement | null) => onRef(el, accountId, tabId),
    [onRef, accountId, tabId],
  );
  return createElement("div", { className: "h-full w-full" }, [
    createElement("webview", {
      ref: setEl,
      src: initialSrc,
      partition,
      allowpopups: "true",
      "data-platform-id": platformId,
      "data-account-id": accountId,
      "data-tab-id": tabId,
      className: "h-full w-full border-0",
      style: { width: "100%", height: "100%" },
    }),
  ]);
}
