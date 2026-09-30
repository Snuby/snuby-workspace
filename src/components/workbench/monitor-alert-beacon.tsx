"use client";

import { useEffect } from "react";
import { refreshMonitorAlert } from "@/lib/monitor-alert";
import { subscribeMonitorSources } from "@/lib/monitor-registry";

const POLL_MS = 4000;

/** 布局常驻: 轮询内存告警，驱动侧栏「监控」书签态 */
export default function MonitorAlertBeacon() {
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refreshMonitorAlert();
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    const unsub = subscribeMonitorSources(tick);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      unsub();
    };
  }, []);

  return null;
}
