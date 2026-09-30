"use client";

import { useEffect, useState } from "react";
import PreviewModal from "@/components/ui/preview-modal";
import { UrlLinkPreview } from "@/components/preview/link-preview-modal";
import {
  fetchForecastDays,
  forecastUrlOf,
  type ForecastDay,
  type WeatherCity,
} from "@/lib/weather";

function weekdayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  const map = ["日", "一", "二", "三", "四", "五", "六"];
  return `周${map[d.getDay()] ?? ""}`;
}

function formatMd(isoDate: string): string {
  const [, m, day] = isoDate.split("-");
  return `${Number(m)}/${Number(day)}`;
}

/** 无天气网城市码时的降级（极少） */
function OpenMeteoForecast({ city }: { city: WeatherCity }) {
  const [days, setDays] = useState<ForecastDay[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    void fetchForecastDays(city)
      .then((list) => {
        if (!cancelled) setDays(list);
      })
      .catch(() => {
        if (!cancelled) {
          setDays(null);
          setErr("预报加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [city]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        加载预报…
      </div>
    );
  }
  if (err || !days) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        {err || "暂无预报"}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-page px-5 py-4">
      <ul className="mx-auto max-w-lg space-y-1.5">
        {days.map((d, i) => (
          <li
            key={d.date}
            className="flex items-center justify-between gap-3 rounded-[8px] border border-line bg-surface px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {i === 0 ? "今天" : weekdayLabel(d.date)}
                <span className="ml-2 font-normal tabular-nums text-ink-faint">
                  {formatMd(d.date)}
                </span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">{d.label}</p>
            </div>
            <p className="shrink-0 text-[14px] font-semibold tabular-nums text-ink">
              <span>{d.maxC}°</span>
              <span className="mx-1 font-normal text-ink-faint">/</span>
              <span className="font-medium text-ink-muted">{d.minC}°</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-[11px] text-ink-faint">数据来自 Open-Meteo</p>
    </div>
  );
}

/**
 * 天气预报：有城市码时走与 Agent 完全同一套 UrlLinkPreview / LinkPreviewModal；
 * 否则降级为同 PreviewModal 壳内的七日列表。
 */
export default function WeatherForecastModal({
  city,
  onClose,
}: {
  city: WeatherCity;
  onClose: () => void;
}) {
  const url = forecastUrlOf(city);

  if (url) {
    return (
      <UrlLinkPreview
        url={url}
        title={`${city.name} · 预报`}
        onClose={onClose}
        webviewPartition="persist:snuby-weather"
      />
    );
  }

  return (
    <PreviewModal title={`${city.name} · 预报`} subtitle="七日预报" onClose={onClose} size="lg">
      <OpenMeteoForecast city={city} />
    </PreviewModal>
  );
}
