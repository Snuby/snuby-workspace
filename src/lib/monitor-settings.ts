/** 监控阈值设置（localStorage），侧栏告警与监控页共用 */

export type MonitorSettings = {
  /** 单标签内存告警 (MB) */
  tabAlertMb: number;
  /** App 占总物理内存告警 (%) */
  totalAlertPct: number;
  /** 闲置多久可批量关闭 (分钟) */
  idleMinutes: number;
};

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  tabAlertMb: 500,
  totalAlertPct: 50,
  idleMinutes: 30,
};

const STORAGE_KEY = "snuby:monitor-settings";

type Listener = () => void;
const listeners = new Set<Listener>();
let cached: MonitorSettings | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function clampSettings(raw: Partial<MonitorSettings> | null | undefined): MonitorSettings {
  const tabAlertMb = Math.min(4096, Math.max(50, Math.round(Number(raw?.tabAlertMb) || DEFAULT_MONITOR_SETTINGS.tabAlertMb)));
  const totalAlertPct = Math.min(95, Math.max(5, Math.round(Number(raw?.totalAlertPct) || DEFAULT_MONITOR_SETTINGS.totalAlertPct)));
  const idleMinutes = Math.min(24 * 60, Math.max(1, Math.round(Number(raw?.idleMinutes) || DEFAULT_MONITOR_SETTINGS.idleMinutes)));
  return { tabAlertMb, totalAlertPct, idleMinutes };
}

function readStorage(): MonitorSettings {
  if (typeof window === "undefined") return { ...DEFAULT_MONITOR_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MONITOR_SETTINGS };
    return clampSettings(JSON.parse(raw) as Partial<MonitorSettings>);
  } catch {
    return { ...DEFAULT_MONITOR_SETTINGS };
  }
}

export function getMonitorSettings(): MonitorSettings {
  if (!cached) cached = readStorage();
  return cached;
}

export function setMonitorSettings(patch: Partial<MonitorSettings>): MonitorSettings {
  const next = clampSettings({ ...getMonitorSettings(), ...patch });
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota
  }
  emit();
  return next;
}

export function subscribeMonitorSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 相对时间文案 */
export function formatLastActiveAt(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "未知";
  const diff = Math.max(0, now - ts);
  if (diff < 45_000) return "刚刚";
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86400_000) return `${Math.max(1, Math.floor(diff / 3600_000))} 小时前`;
  if (diff < 86400_000 * 7) return `${Math.max(1, Math.floor(diff / 86400_000))} 天前`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isIdlePastThreshold(lastActiveAt: number, idleMinutes: number, now = Date.now()): boolean {
  if (!Number.isFinite(lastActiveAt) || lastActiveAt <= 0) return false;
  return now - lastActiveAt >= idleMinutes * 60_000;
}
