/** 监控告警阈值与侧栏广播（总内存占比 / 单标签超标） */

import { listMonitorTabs } from "@/lib/monitor-registry";
import { getMonitorSettings } from "@/lib/monitor-settings";

type Listener = () => void;

let alerting = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function setMonitorAlerting(next: boolean): void {
  if (next === alerting) return;
  alerting = next;
  emit();
}

export function getMonitorAlerting(): boolean {
  return alerting;
}

export function subscribeMonitorAlerting(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 采样一次并写回告警态；供布局常驻轮询与监控页共用 */
export async function refreshMonitorAlert(): Promise<boolean> {
  const api = typeof window !== "undefined" ? window.snubyDesktop : undefined;
  if (!api?.getPerfSnapshot) {
    setMonitorAlerting(false);
    return false;
  }

  const { tabAlertMb, totalAlertPct } = getMonitorSettings();
  const tabs = listMonitorTabs();
  const ids = tabs.map((t) => t.webContentsId).filter((id): id is number => id != null);

  try {
    const snap = await api.getPerfSnapshot(ids);
    const processTotalKb = snap.processes.reduce((s, p) => s + p.rssKb, 0);
    const processTotalMb = processTotalKb / 1024;
    const totalMemMb = snap.totalMemBytes / (1024 * 1024);
    const pct = totalMemMb > 0 ? (processTotalMb / totalMemMb) * 100 : 0;
    const totalHit = pct >= totalAlertPct;

    let tabHit = false;
    for (const t of tabs) {
      if (t.webContentsId == null) continue;
      const info = snap.tabs[String(t.webContentsId)];
      if (info?.rssKb != null && info.rssKb / 1024 >= tabAlertMb) {
        tabHit = true;
        break;
      }
    }

    const next = totalHit || tabHit;
    setMonitorAlerting(next);
    return next;
  } catch {
    setMonitorAlerting(false);
    return false;
  }
}

/** @deprecated 使用 getMonitorSettings() */
export const MONITOR_TAB_ALERT_MB = 500;
/** @deprecated 使用 getMonitorSettings() */
export const MONITOR_TOTAL_ALERT_PCT = 50;
