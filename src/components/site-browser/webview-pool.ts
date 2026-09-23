/**
 * 全局 WebView 缓存池 (跨模块/站点/标签)
 *
 * 每个标签对应一个 webview 实例, 以 `${moduleKey}:${siteId}:${tabId}` 为 key 常驻本池:
 * - 站点/模块切换时, React 组件卸载只把 webview 移入隐藏容器, 不销毁 → 浏览状态/滚动位置保留
 * - 切回时直接从池中取回原实例, 无需重新加载 → 秒开、无白屏
 * - 超过 RETENTION_MS 未被激活的实例由后台清扫器自动销毁 (释放 guest 进程资源)
 *
 * 注意: 本池是模块级单例, 挂在 window 全局避免 React 热更新/重挂载导致池丢失。
 */
const DEFAULT_MIN_KEEP = 5; // 至少保留最近使用的 N 个 (不论时间)
const DEFAULT_RETENTION_MS = 3 * 3600 * 1000; // 超出 N 个的按不活跃时长回收 (默认 3 小时)
const SWEEP_INTERVAL_MS = 60 * 1000;

/** 当前回收策略 (设置页可改, 见 setWebviewPolicy) */
let policy = { minKeep: DEFAULT_MIN_KEEP, retentionMs: DEFAULT_RETENTION_MS };

interface PoolEntry {
  el: HTMLElement;
  lastActive: number;
}

function createPool(): {
  setPolicy: (minKeep: number, retentionMs: number) => void;
  get: (key: string) => HTMLElement | null;
  put: (key: string, el: HTMLElement) => void;
  touch: (key: string) => void;
  hide: (key: string, el: HTMLElement) => void;
  remove: (key: string) => void;
} {
  const pool = new Map<string, PoolEntry>();
  let hiddenContainer: HTMLDivElement | null = null;
  let sweeper: ReturnType<typeof setInterval> | null = null;

  function ensureHidden(): HTMLDivElement {
    if (!hiddenContainer) {
      hiddenContainer = document.createElement("div");
      hiddenContainer.setAttribute("data-snuby-webview-pool", "1");
      hiddenContainer.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;display:none;";
      document.body.appendChild(hiddenContainer);
    }
    return hiddenContainer;
  }

  function ensureSweeper() {
    if (sweeper) return;
    sweeper = setInterval(() => {
      const now = Date.now();
      // 双维回收: 池按最近使用排序, 前 minKeep 个 (最近使用的保底) 永不回收;
      // 超出 minKeep 的条目, 不活跃超过 retentionMs 才销毁
      const entries = [...pool.entries()].sort((a, b) => a[1].lastActive - b[1].lastActive);
      for (let i = 0; i < entries.length; i++) {
        if (i < policy.minKeep) continue;
        const [key, entry] = entries[i];
        if (now - entry.lastActive > policy.retentionMs) remove(key);
      }
    }, SWEEP_INTERVAL_MS);
  }

  function remove(key: string) {
    const entry = pool.get(key);
    if (entry) entry.el.remove();
    pool.delete(key);
  }

  return {
    /** 应用设置页的保留策略 (minKeep: 保底数量, retentionMs: 超出部分不活跃时长) */
    setPolicy(minKeep: number, retentionMs: number) {
      policy = { minKeep, retentionMs };
    },
    get(key) {
      return pool.get(key)?.el ?? null;
    },
    put(key, el) {
      pool.set(key, { el, lastActive: Date.now() });
      ensureSweeper();
    },
    touch(key) {
      const entry = pool.get(key);
      if (entry) entry.lastActive = Date.now();
    },
    hide(key, el) {
      ensureHidden().appendChild(el);
      // 刚切走也算活跃: 保留窗口从用户离开的时刻起算
      const entry = pool.get(key);
      if (entry) entry.lastActive = Date.now();
    },
    remove,
  };
}

/** 全局单例: 挂 window 防止模块热更新时实例丢失 */
const g = globalThis as unknown as { __snubyWebviewPool?: ReturnType<typeof createPool> };
g.__snubyWebviewPool ??= createPool();
export const webviewPool = g.__snubyWebviewPool;
