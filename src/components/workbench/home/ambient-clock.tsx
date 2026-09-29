"use client";

import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function greetingOf(h: number): string {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  if (h < 22) return "晚上好";
  return "夜深了";
}

/** 氛围电子钟：大号等宽时间 + 问候 */
export default function AmbientClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!now) {
    return (
      <div className="min-h-[140px]">
        <div className="h-5 w-24 animate-pulse rounded bg-hover" />
        <div className="mt-4 h-16 w-72 animate-pulse rounded bg-hover" />
      </div>
    );
  }

  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();

  return (
    <div>
      <p className="text-[15px] font-medium tracking-wide text-ink-muted">
        {greetingOf(h)}
      </p>
      <div
        className="mt-3 flex items-baseline gap-1 font-medium tabular-nums tracking-tight text-ink"
        style={{ fontFeatureSettings: '"tnum"' }}
        aria-label={`${pad(h)}时${pad(m)}分${pad(s)}秒`}
      >
        <span className="text-[72px] leading-none tracking-[-0.04em]">{pad(h)}</span>
        <span className="home-clock-colon text-[64px] leading-none text-ink-muted">:</span>
        <span className="text-[72px] leading-none tracking-[-0.04em]">{pad(m)}</span>
        <span className="home-clock-colon ml-0.5 text-[40px] leading-none text-ink-muted">:</span>
        <span className="text-[40px] leading-none tracking-[-0.02em] text-ink-muted">
          {pad(s)}
        </span>
      </div>
    </div>
  );
}
