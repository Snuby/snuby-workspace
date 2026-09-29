"use client";

import { useCallback, useEffect, useState } from "react";
import WeatherArt from "@/components/workbench/home/weather-art";
import WeatherForecastModal from "@/components/workbench/home/weather-forecast-modal";
import {
  WEATHER_CITIES,
  cityById,
  fetchWeather,
  forecastUrlOf,
  loadWeatherCityId,
  saveWeatherCityId,
  type WeatherSnapshot,
} from "@/lib/weather";

export default function WeatherCard() {
  const [cityId, setCityId] = useState(WEATHER_CITIES[0]!.id);
  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forecastOpen, setForecastOpen] = useState(false);

  useEffect(() => {
    setCityId(loadWeatherCityId());
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(cityById(id));
      setSnap(data);
    } catch {
      setSnap(null);
      setError("暂无天气");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(cityId);
  }, [cityId, load]);

  function onCityChange(id: string) {
    setCityId(id);
    saveWeatherCityId(id);
  }

  const city = cityById(cityId);
  const forecastUrl = forecastUrlOf(city);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setForecastOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setForecastOpen(true);
          }
        }}
        title="查看天气预报"
        className="cursor-pointer overflow-hidden rounded-[8px] px-1 py-1 transition-colors duration-150 hover:bg-hover"
      >
        <div className="flex items-center justify-end gap-2">
          <select
            value={cityId}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              onCityChange(e.target.value);
            }}
            className="rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent"
            aria-label="选择城市"
          >
            {WEATHER_CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
        <WeatherForecastModal
          cityName={city.name}
          url={forecastUrl}
          onClose={() => setForecastOpen(false)}
        />
      ) : null}
    </>
  );
}
