"use client";

import { useCallback, useRef } from "react";
import AmbientClock from "@/components/workbench/home/ambient-clock";
import LunarCalendar, { TodayRibbon } from "@/components/workbench/home/lunar-calendar";
import WeatherCard from "@/components/workbench/home/weather-card";

/** 工作台主页氛围区：问候 + 电子钟 + 农历节假日日历 + 天气 */
export default function HomeAtmosphere() {
  const goTodayRef = useRef<(() => void) | null>(null);
  const bindGoToday = useCallback((fn: () => void) => {
    goTodayRef.current = fn;
  }, []);

  return (
    <div
      className="min-h-full cursor-default"
      onClick={() => goTodayRef.current?.()}
    >
      <div className="mx-auto max-w-5xl px-8 py-9">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          <div className="min-w-0 flex-1">
            <AmbientClock />
            <div className="mt-3">
              <TodayRibbon />
            </div>
          </div>
          <div
            className="w-full shrink-0 lg:w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            <WeatherCard />
          </div>
        </div>

        <section className="mt-9 rounded-[8px] border border-line bg-surface p-5">
          <LunarCalendar onReadyGoToday={bindGoToday} />
        </section>
      </div>
    </div>
  );
}
