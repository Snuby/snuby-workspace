/** 运行时标签注册表: SiteBrowser / 矩阵向监控页上报可关闭的常驻标签 */

export type MonitorSection = "browser" | "matrix" | "topic";

export type MonitorTabInfo = {
  section: MonitorSection;
  /** 模块键: browser / topicId / platformId */
  moduleKey: string;
  /** 模块展示名: 「Web 访问」/ 主题名 / 「微信公众号」等 */
  moduleLabel: string;
  /** 站点或账号 id */
  groupId: string;
  /** 站点名或账号名 */
  groupLabel: string;
  tabId: string;
  title: string;
  url: string;
  isHome: boolean;
  /** 当前是否为该组激活标签 */
  isActive: boolean;
  /** 最近打开/激活时间 (epoch ms) */
  lastActiveAt: number;
  /** Electron webview guest webContents id；取不到则为 null */
  webContentsId: number | null;
};

export type MonitorSource = {
  list: () => MonitorTabInfo[];
  close: (groupId: string, tabId: string) => void;
};

const sources = new Map<string, MonitorSource>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function registerMonitorSource(id: string, source: MonitorSource): () => void {
  sources.set(id, source);
  notify();
  return () => {
    if (sources.get(id) === source) {
      sources.delete(id);
      notify();
    }
  };
}

export function subscribeMonitorSources(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listMonitorTabs(): MonitorTabInfo[] {
  const out: MonitorTabInfo[] = [];
  for (const src of sources.values()) {
    try {
      out.push(...src.list());
    } catch {
      // 单个 source 失败不影响整体
    }
  }
  return out;
}

export function closeMonitorTab(section: MonitorSection, moduleKey: string, groupId: string, tabId: string): boolean {
  for (const [id, src] of sources) {
    const match =
      (section === "browser" && id === "site:browser") ||
      (section === "topic" && id === `site:${moduleKey}`) ||
      (section === "matrix" && id === `matrix:${moduleKey}`);
    if (!match) continue;
    try {
      src.close(groupId, tabId);
      notify();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function readWebContentsId(el: HTMLElement | null | undefined): number | null {
  if (!el) return null;
  try {
    const id = (el as HTMLElement & { getWebContentsId?: () => number }).getWebContentsId?.();
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

export const MONITOR_SECTION_LABEL: Record<MonitorSection, string> = {
  browser: "Web 访问",
  matrix: "自媒体账号矩阵",
  topic: "主题",
};
