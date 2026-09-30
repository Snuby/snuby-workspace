/** 监控告警阈值与侧栏广播（仅 App 合计占本机内存比例超阈值） */

import { listMonitorTabs } from "@/lib/monitor-registry";
import { getMonitorSettings } from "@/lib/monitor-settings";

/** 临时演示开关: 为 true 时侧栏「监控」常显告警胶囊，并注入超阈值假数据 */
export const MONITOR_UI_MOCK = false;

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

/** 采样一次并写回告警态；供布局常驻轮询与监控页共用。侧栏仅在总体占比超阈值时告警。 */
export async function refreshMonitorAlert(): Promise<boolean> {
  if (MONITOR_UI_MOCK) {
    setMonitorAlerting(true);
    return true;
  }

  const api = typeof window !== "undefined" ? window.snubyDesktop : undefined;
  if (!api?.getPerfSnapshot) {
    setMonitorAlerting(false);
    return false;
  }

  const { totalAlertPct } = getMonitorSettings();
  const tabs = listMonitorTabs();
  const ids = tabs.map((t) => t.webContentsId).filter((id): id is number => id != null);

  try {
    const snap = await api.getPerfSnapshot(ids);
    const processTotalKb = snap.processes.reduce((s, p) => s + p.rssKb, 0);
    const processTotalMb = processTotalKb / 1024;
    const totalMemMb = snap.totalMemBytes / (1024 * 1024);
    const pct = totalMemMb > 0 ? (processTotalMb / totalMemMb) * 100 : 0;
    const next = pct >= totalAlertPct;
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
