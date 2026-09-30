"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import WeatherArt from "@/components/workbench/home/weather-art";
import WeatherForecastModal from "@/components/workbench/home/weather-forecast-modal";
import {
  DEFAULT_CITY,
  PRESET_CITIES,
  citySubtitle,
  fetchWeather,
  loadWeatherCity,
  saveWeatherCity,
  searchWeatherCities,
  type WeatherCity,
  type WeatherSnapshot,
} from "@/lib/weather";

export default function WeatherCard() {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [city, setCity] = useState<WeatherCity>(DEFAULT_CITY);
  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forecastOpen, setForecastOpen] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WeatherCity[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  useEffect(() => {
    setCity(loadWeatherCity());
  }, []);

  const load = useCallback(async (c: WeatherCity) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(c);
      setSnap(data);
    } catch {
      setSnap(null);
      setError("暂无天气");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(city);
  }, [city, load]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      setSearching(false);
      setSearchErr("");
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchErr("");
    const timer = window.setTimeout(() => {
      void searchWeatherCities(q)
        .then((list) => {
          if (!cancelled) setHits(list);
        })
        .catch(() => {
          if (!cancelled) {
            setHits([]);
            setSearchErr("搜索失败");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, pickerOpen]);

  function pickCity(next: WeatherCity) {
    setCity(next);
    saveWeatherCity(next);
    setPickerOpen(false);
    setQuery("");
    setHits([]);
  }

  const showPresets = query.trim().length < 1;
  const list = showPresets ? PRESET_CITIES : hits;

  return (
    <>
      <div
        ref={rootRef}
        role="button"
        tabIndex={0}
        onClick={() => setForecastOpen(true)}
        onKeyDown={(e) => {
          // 不绑空格：中文输入法选词常用空格，会误开预报
          if (e.key !== "Enter") return;
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setForecastOpen(true);
        }}
        title="查看天气预报"
        className="relative cursor-pointer overflow-visible rounded-[8px] px-1 py-1 transition-colors duration-150 hover:bg-hover"
      >
        <div
          className="flex items-center justify-end gap-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-controls={listId}
              onClick={() => {
                setPickerOpen((o) => !o);
                setQuery("");
                setHits([]);
              }}
              className="flex max-w-[140px] items-center gap-1 rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink outline-none transition-colors hover:border-accent focus:border-accent"
              title={citySubtitle(city) || city.name}
            >
              <span className="truncate">{city.name}</span>
              <span className="shrink-0 text-[10px] text-ink-faint">▾</span>
            </button>

            {pickerOpen ? (
              <div
                id={listId}
                role="listbox"
                className="absolute right-0 top-[calc(100%+4px)] z-30 w-[220px] overflow-hidden rounded-[8px] border border-line bg-white shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="border-b border-line p-1.5">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setPickerOpen(false);
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const first = (query.trim().length < 1 ? PRESET_CITIES : hits)[0];
                        if (first) pickCity(first);
                      }
                    }}
                    placeholder="搜索城市…"
                    className="w-full rounded-[6px] border border-line bg-page px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                    aria-label="搜索城市"
                  />
                </div>
                <ul className="max-h-[240px] overflow-auto py-1">
                  {showPresets ? (
                    <li className="px-2.5 py-1 text-[10.5px] font-medium text-ink-faint">常用</li>
                  ) : null}
                  {searching ? (
                    <li className="px-2.5 py-2 text-[12px] text-ink-faint">搜索中…</li>
                  ) : null}
                  {searchErr ? (
                    <li className="px-2.5 py-2 text-[12px] text-up">{searchErr}</li>
                  ) : null}
                  {!searching && !showPresets && list.length === 0 && !searchErr ? (
                    <li className="px-2.5 py-2 text-[12px] text-ink-faint">无匹配城市</li>
                  ) : null}
                  {list.map((c) => {
                    const sub = citySubtitle(c);
                    const active = c.id === city.id || (c.name === city.name && c.lat === city.lat);
                    return (
                      <li key={`${c.id}-${c.lat}-${c.lon}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => pickCity(c)}
                          className={[
                            "flex w-full flex-col items-start px-2.5 py-1.5 text-left transition-colors hover:bg-hover",
                            active ? "bg-accent-soft/60" : "",
                          ].join(" ")}
                        >
                          <span className="text-[12.5px] font-medium text-ink">{c.name}</span>
                          {sub ? (
                            <span className="mt-0.5 text-[11px] text-ink-faint">{sub}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {loading && !snap ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="h-10 w-24 animate-pulse rounded bg-hover" />
            <div className="h-16 w-16 animate-pulse rounded-full bg-hover" />
          </div>
        ) : error && !snap ? (
          <p className="mt-3 text-[13px] text-ink-faint">{error}</p>
        ) : snap ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="min-w-0 pt-1">
              <div className="flex items-end gap-2">
                <span className="text-[36px] font-semibold leading-none tabular-nums tracking-tight">
                  {snap.tempC}
                  <span className="text-[18px] font-medium text-ink-muted">°</span>
                </span>
                <div className="mb-0.5">
                  <p className="text-[14px] font-medium text-ink">{snap.label}</p>
                  {snap.humidity != null ? (
                    <p className="text-[11.5px] text-ink-faint">湿度 {snap.humidity}%</p>
                  ) : null}
                </div>
              </div>
            </div>
            <WeatherArt code={snap.code} className="h-[88px] w-[88px] shrink-0" />
          </div>
        ) : null}
      </div>

      {forecastOpen ? (
        <WeatherForecastModal city={city} onClose={() => setForecastOpen(false)} />
      ) : null}
    </>
  );
}
