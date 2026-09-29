// 公历日 → 农历 / 传统节日 / 法定休班（lunar-javascript）

import { HolidayUtil, Solar } from "lunar-javascript";

export type DayMark = "rest" | "work" | null;

export type ChinaDayInfo = {
  y: number;
  m: number;
  d: number;
  weekday: number; // 0=周日
  weekdayLabel: string;
  lunarMonth: string;
  lunarDay: string;
  /** 初一显示「八月」、其余显示农历日 */
  lunarShort: string;
  /** 如「八月十九」 */
  lunarFull: string;
  festivals: string[];
  holidayName: string | null;
  mark: DayMark;
  jieQi: string | null;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function parseChinaDay(y: number, m: number, d: number): ChinaDayInfo {
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();
  const lunarDay = lunar.getDayInChinese() as string;
  const lunarMonth = lunar.getMonthInChinese() as string;

  const festivals = [
    ...((lunar.getFestivals() as string[]) ?? []),
    ...((lunar.getOtherFestivals() as string[]) ?? []),
    ...((solar.getFestivals() as string[]) ?? []),
    ...((solar.getOtherFestivals() as string[]) ?? []),
  ].filter((x): x is string => typeof x === "string" && x.length > 0);

  const holiday = HolidayUtil.getHoliday(y, m, d);
  let mark: DayMark = null;
  let holidayName: string | null = null;
  if (holiday) {
    holidayName = holiday.getName() as string;
    mark = holiday.isWork() ? "work" : "rest";
  }

  const jieQiRaw = lunar.getJieQi() as string;
  const jieQi = jieQiRaw && jieQiRaw.length > 0 ? jieQiRaw : null;

  return {
    y,
    m,
    d,
    weekday: solar.getWeek() as number,
    weekdayLabel: WEEKDAYS[solar.getWeek() as number] ?? "",
    lunarMonth,
    lunarDay,
    lunarShort: lunarDay === "初一" ? lunarMonth : lunarDay,
    lunarFull: `${lunarMonth}${lunarDay}`,
    festivals: [...new Set(festivals)],
    holidayName,
    mark,
    jieQi,
  };
}

export function todayChinaDay(now = new Date()): ChinaDayInfo {
  return parseChinaDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 周日起始的月历格子 */
export function monthGrid(year: number, month: number): (ChinaDayInfo | null)[] {
  const startPad = Solar.fromYmd(year, month, 1).getWeek() as number;
  const dim = daysInMonth(year, month);
  const cells: (ChinaDayInfo | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(parseChinaDay(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function isSameDay(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}
