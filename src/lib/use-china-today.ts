"use client";

import { useEffect, useState } from "react";
import { isSameDay, todayChinaDay, type ChinaDayInfo } from "@/lib/china-day";

/** 距下一本地自然日 0 点的毫秒；至少 1s，避免边界抖动 */
function msUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

/**
 * 当前「中国日」：午夜准点翻日；休眠/切回前台时再对一次日期。
 * 成本：一个 setTimeout + visibility/focus 事件，无轮询。
 */
export function useChinaToday(): ChinaDayInfo {
  const [today, setToday] = useState(() => todayChinaDay());

  useEffect(() => {
    let timer: number | undefined;

    const sync = () => {
      const next = todayChinaDay();
      setToday((prev) => (isSameDay(prev, next) ? prev : next));
    };

    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        sync();
        schedule();
      }, msUntilNextLocalMidnight());
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      sync();
      schedule();
    };

    const onFocus = () => {
      sync();
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return today;
}
