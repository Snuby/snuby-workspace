"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isSameDay,
  monthGrid,
  todayChinaDay,
  type ChinaDayInfo,
} from "@/lib/china-day";

const WEEK_HEAD = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 今年还剩几天（含今天） */
function daysLeftInYear(now = new Date()): number {
  const y = now.getFullYear();
  const end = new Date(y, 11, 31);
  const today = new Date(y, now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86_400_000) + 1;
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  let ny = y;
  let nm = m + delta;
  while (nm < 1) {
    nm += 12;
    ny -= 1;
  }
  while (nm > 12) {
    nm -= 12;
    ny += 1;
  }
  return { y: ny, m: nm };
}

function detailLines(day: ChinaDayInfo): string[] {
  const lines: string[] = [`农历${day.lunarFull}`];
  if (day.jieQi) lines.push(day.jieQi);
  if (day.festivals.length) lines.push(day.festivals.join(" · "));
  if (day.holidayName) {
    if (day.mark === "work") lines.push(`${day.holidayName} · 调休上班`);
    else if (day.mark === "rest") lines.push(`${day.holidayName} · 放假`);
    else lines.push(day.holidayName);
  }
  return lines;
}

/** 格子底色：放假 / 调休上班 / 传统节日·节气 */
function cellTone(day: ChinaDayInfo): string {
  if (day.mark === "rest") return "bg-up-soft";
  if (day.mark === "work") return "bg-surface-2";
  if (day.festivals.length > 0 || day.jieQi) return "bg-accent-soft/70";
  return "";
}

function isPastDay(day: ChinaDayInfo, today: ChinaDayInfo): boolean {
  if (day.y !== today.y) return day.y < today.y;
  if (day.m !== today.m) return day.m < today.m;
  return day.d < today.d;
}

/** 蜡笔斜线：略弯、双笔触，像手划过 */
function CrayonStrike() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-visible"
      viewBox="0 0 48 48"
      aria-hidden
    >
      <path
        d="M7.5 39.5 C16 31 22 24 27 18 C32 12 37.5 9 41 7.5"
        fill="none"
        stroke="rgba(192,57,43,0.55)"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.8 40.8 C17 32.2 23 25 28 19 C33 13 38 10 41.5 8.2"
        fill="none"
        stroke="rgba(192,57,43,0.35)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MonthPane({
  year,
  month,
  today,
  selected,
  onSelect,
  onBlank,
  onHoverDay,
}: {
  year: number;
  month: number;
  today: ChinaDayInfo;
  selected: ChinaDayInfo;
  onSelect: (d: ChinaDayInfo) => void;
  onBlank: () => void;
  onHoverDay: (d: ChinaDayInfo) => void;
}) {
  const cells = useMemo(() => monthGrid(year, month), [year, month]);

  return (
    <div className="min-w-0 flex-1" onClick={onBlank}>
      <h3 className="mb-2 text-center text-[13.5px] font-semibold tabular-nums text-ink">
        {year}年{month}月
      </h3>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK_HEAD.map((w) => (
          <div key={w} className="py-1 text-[11px] font-medium text-ink-faint">
            {w}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) {
            return (
              <div
                key={`e-${year}-${month}-${i}`}
                className="h-[48px] cursor-default"
              />
            );
          }

          const isToday = isSameDay(cell, today);
          const isSel = isSameDay(cell, selected);
          const past = isPastDay(cell, today);
          const tone = cellTone(cell);
          const festHint =
            cell.festivals[0] ??
            cell.jieQi ??
            (cell.mark === "rest"
              ? cell.holidayName
              : cell.mark === "work"
                ? "班"
                : null);
          const sub =
            festHint && festHint.length <= 3 ? festHint : cell.lunarShort;

          return (
            <button
              key={`${cell.y}-${cell.m}-${cell.d}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(cell);
              }}
              onMouseEnter={() => onHoverDay(cell)}
              className={[
                "relative flex h-[48px] flex-col items-center justify-center rounded-[6px] transition-colors duration-150",
                "before:pointer-events-none before:absolute before:inset-0 before:rounded-[6px] before:transition-colors before:duration-150 hover:before:bg-hover",
                tone,
                isSel ? "ring-1 ring-inset ring-accent/45" : "",
                past ? "opacity-70" : "",
              ].join(" ")}
            >
              {past ? <CrayonStrike /> : null}
              {cell.mark === "rest" ? (
                <span className="absolute right-0.5 top-0.5 z-[1] text-[9px] font-medium leading-none text-up">
                  休
                </span>
              ) : null}
              {cell.mark === "work" ? (
                <span className="absolute right-0.5 top-0.5 z-[1] text-[9px] font-medium leading-none text-ink-faint">
                  班
                </span>
              ) : null}
              <span
                className={[
                  "relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-[13px] tabular-nums",
                  isToday
                    ? "bg-accent font-semibold text-white"
                    : isSel
                      ? "font-semibold text-accent-deep"
                      : past
                        ? "text-ink-muted"
                        : "text-ink",
                ].join(" ")}
              >
                {cell.d}
              </span>
              <span
                className={[
                  "relative z-[1] mt-0.5 max-w-full truncate px-0.5 text-[10px] leading-tight",
                  cell.mark === "rest" || cell.festivals.length
                    ? "text-up"
                    : "text-ink-faint",
                ].join(" ")}
              >
                {sub}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LunarCalendar({
  onReadyGoToday,
}: {
  /** 把「回到今日」交给外层，用于点主页空白 */
  onReadyGoToday?: (goToday: () => void) => void;
}) {
  const today = useMemo(() => todayChinaDay(), []);
  const [cursor, setCursor] = useState({ y: today.y, m: today.m });
  const [selected, setSelected] = useState<ChinaDayInfo>(today);
  const [hovered, setHovered] = useState<ChinaDayInfo | null>(null);
  const next = addMonths(cursor.y, cursor.m, 1);

  function shiftMonth(delta: number) {
    setCursor((c) => addMonths(c.y, c.m, delta));
    setHovered(null);
  }

  function goToday() {
    const t = todayChinaDay();
    setCursor({ y: t.y, m: t.m });
    setSelected(t);
    setHovered(null);
  }

  useEffect(() => {
    onReadyGoToday?.(() => {
      const t = todayChinaDay();
      setCursor({ y: t.y, m: t.m });
      setSelected(t);
      setHovered(null);
    });
  }, [onReadyGoToday]);

  const shown = hovered ?? selected;
  const previewing = hovered !== null && !isSameDay(hovered, selected);
  const detail = detailLines(shown);
  const yearDaysLeft = daysLeftInYear();

  return (
    <div onClick={goToday}>
      <div
        className="relative mb-3 flex items-center justify-between gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            aria-label="上个月"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            aria-label="下个月"
          >
            ›
          </button>
        </div>
        <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[12.5px] text-ink-muted">
          今年还剩{" "}
          <span
            className="mx-0.5 inline-block text-[20px] font-bold leading-none text-up"
            style={{
              fontFamily:
                'ui-monospace, "SF Mono", "Menlo", "Cascadia Mono", "Consolas", monospace',
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {yearDaysLeft}
          </span>{" "}
          天（含今天）
        </p>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-[11px] text-ink-faint sm:flex">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-up-soft ring-1 ring-up/25" />
              放假
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-surface-2 ring-1 ring-line" />
              调休上班
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-accent-soft ring-1 ring-accent/20" />
              节日/节气
            </span>
          </div>
          <button
            type="button"
            onClick={goToday}
            className="rounded-[6px] px-2 py-1 text-[12px] text-accent-deep transition-colors duration-150 hover:bg-accent-soft"
          >
            今天
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <div
          className="flex min-w-0 flex-1 flex-col gap-6 sm:flex-row sm:gap-6"
          onMouseLeave={() => setHovered(null)}
        >
          <MonthPane
            year={cursor.y}
            month={cursor.m}
            today={today}
            selected={selected}
            onSelect={(d) => {
              setSelected(d);
              setHovered(null);
            }}
            onBlank={goToday}
            onHoverDay={setHovered}
          />
          <div className="hidden w-px shrink-0 bg-line sm:block" />
          <MonthPane
            year={next.y}
            month={next.m}
            today={today}
            selected={selected}
            onSelect={(d) => {
              setSelected(d);
              setHovered(null);
            }}
            onBlank={goToday}
            onHoverDay={setHovered}
          />
        </div>

        <aside className="w-full shrink-0 border-t border-line pt-4 lg:w-[160px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-1">
          <p className="text-[12px] text-ink-faint">
            {previewing ? "预览" : "选中日期"}
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight">
            {shown.m}月{shown.d}日
          </p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            星期{shown.weekdayLabel}
          </p>
          <ul className="mt-3 space-y-1.5">
            {detail.map((line) => (
              <li key={line} className="text-[12.5px] leading-snug text-ink-muted">
                {line}
              </li>
            ))}
          </ul>
          {!shown.festivals.length && !shown.holidayName && !shown.jieQi ? (
            <p className="mt-3 text-[12px] text-ink-faint">寻常日子</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** 时钟旁的今日一行摘要 */
export function TodayRibbon() {
  const [info, setInfo] = useState<ChinaDayInfo | null>(null);
  useEffect(() => {
    setInfo(todayChinaDay());
  }, []);
  if (!info) return <div className="h-4 w-48 animate-pulse rounded bg-hover" />;
  const bits = [
    `${info.y}年${info.m}月${info.d}日`,
    `星期${info.weekdayLabel}`,
    `农历${info.lunarFull}`,
  ];
  if (info.jieQi) bits.push(info.jieQi);
  if (info.festivals[0]) bits.push(info.festivals[0]);
  if (info.holidayName && info.mark === "rest") bits.push(`${info.holidayName}放假`);
  if (info.holidayName && info.mark === "work") bits.push("调休上班");
  return (
    <p className="text-[13px] text-ink-muted">{bits.join(" · ")}</p>
  );
}
