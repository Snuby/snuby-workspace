/**
 * 全局 WebView 舞台 (跨模块/站点/标签常驻)
 *
 * 所有标签的 webview 实例统一挂载在根布局的 #snuby-stage 容器 (z-0, pointer-events:none),
 * 该容器随根布局常驻、不随模块切换卸载 → webview 实例创建后永不移动、永不销毁
 * (除非标签被关闭或淘汰)。
 *
 * - 模块/站点/标签切换只改实例的 visibility / pointer-events → 零重载、零闪烁、状态全保留
 * - 事件监听只在创建时绑定一次, 通过 el.__snubyHandlers 转发给"当前挂载的 SiteBrowser",
 *   组件卸载后 handlers 置 null, 重挂载时重新赋值 (闭包永远指向当前组件)
 * - 关闭/淘汰标签时必须调用 remove() 销毁实例, 释放 guest 进程
 */
interface StageEntry {
  key: string;
  el: HTMLElement;
  siteId: string;
  tabId: string;
  gid?: number;
}

interface Stage {
  registry: Map<string, StageEntry>;
  byGid: Map<number, string>;
  container: HTMLElement | null;
}

const g = globalThis as unknown as { __snubyStage?: Stage };
g.__snubyStage ??= { registry: new Map(), byGid: new Map(), container: null };
const stage = g.__snubyStage;

function ensureContainer(): HTMLElement {
  if (stage.container && stage.container.isConnected) return stage.container;
  stage.container = document.getElementById("snuby-stage");
  if (!stage.container) {
    stage.container = document.createElement("div");
    stage.container.id = "snuby-stage";
    stage.container.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:0;";
    document.body.appendChild(stage.container);
  }
  return stage.container;
}

/** 事件监听只在实例创建时绑定一次, 内部转发到 el.__snubyHandlers (每次挂载更新) */
function bindEvents(el: HTMLElement, entry: StageEntry) {
  if (el.getAttribute("data-snuby-bound")) return;
  el.setAttribute("data-snuby-bound", "1");
  el.addEventListener("did-attach", () => {
    const gid = (el as unknown as { getWebContentsId?: () => number }).getWebContentsId?.();
    if (typeof gid === "number") {
      entry.gid = gid;
      stage.byGid.set(gid, entry.key);
    }
  });
  el.addEventListener("did-navigate", (e) => {
    (el as unknown as { __snubyHandlers?: Record<string, (ev: Event) => void> }).__snubyHandlers?.onNavigateFull?.(e);
  });
  el.addEventListener("did-navigate-in-page", (e) => {
    (el as unknown as { __snubyHandlers?: Record<string, (ev: Event) => void> }).__snubyHandlers?.onNavigateInPage?.(e);
  });
  el.addEventListener("page-title-updated", (e) => {
    (el as unknown as { __snubyHandlers?: Record<string, (ev: Event) => void> }).__snubyHandlers?.onTitle?.(e);
  });
  el.addEventListener("did-start-loading", (e) => {
    (el as unknown as { __snubyHandlers?: Record<string, (ev: Event) => void> }).__snubyHandlers?.onStart?.(e);
  });
  el.addEventListener("did-stop-loading", (e) => {
    (el as unknown as { __snubyHandlers?: Record<string, (ev: Event) => void> }).__snubyHandlers?.onStop?.(e);
  });
  el.addEventListener("did-fail-load", (e) => {
    (el as unknown as { __snubyHandlers?: Record<string, (ev: Event) => void> }).__snubyHandlers?.onFail?.(e);
  });
}

export const webviewStage = {
  /** 获取容器 (不存在则兜底创建到 body) */
  ensure: ensureContainer,
  get(key: string): StageEntry | null {
    return stage.registry.get(key) ?? null;
  },
  getEl(key: string): HTMLElement | null {
    return stage.registry.get(key)?.el ?? null;
  },
  /** 按 guestId 反查宿主 (popup 事件用), 失败返回 null */
  getHost(gid: number): { siteId: string; tabId: string } | null {
    const key = stage.byGid.get(gid);
    if (!key) return null;
    const e = stage.registry.get(key);
    return e ? { siteId: e.siteId, tabId: e.tabId } : null;
  },
  /** 创建并挂载到舞台 (已存在则复用, 不移动) */
  create(
    key: string,
    src: string,
    partition: string | undefined,
    siteId: string,
    tabId: string,
  ): StageEntry {
    const existing = stage.registry.get(key);
    if (existing) return existing;
    const el = document.createElement("webview");
    el.setAttribute("src", src);
    if (partition) el.setAttribute("partition", partition);
    el.setAttribute("allowpopups", "true");
    el.setAttribute("class", "h-full w-full border-0");
    el.style.cssText = "width:100%;height:100%;pointer-events:auto;";
    const entry: StageEntry = { key, el, siteId, tabId };
    stage.registry.set(key, entry);
    ensureContainer().appendChild(el);
    bindEvents(el, entry);
    return entry;
  },
  show(key: string) {
    const e = stage.registry.get(key);
    if (!e) return;
    e.el.style.visibility = "visible";
    e.el.style.pointerEvents = "auto";
  },
  hide(key: string) {
    const e = stage.registry.get(key);
    if (!e) return;
    e.el.style.visibility = "hidden";
    e.el.style.pointerEvents = "none";
  },
  /** 关闭/淘汰标签时销毁实例 */
  remove(key: string) {
    const e = stage.registry.get(key);
    if (!e) return;
    if (typeof e.gid === "number") stage.byGid.delete(e.gid);
    e.el.remove();
    stage.registry.delete(key);
  },
};
