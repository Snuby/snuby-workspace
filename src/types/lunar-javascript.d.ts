declare module "lunar-javascript" {
  export class Solar {
    static fromYmd(y: number, m: number, d: number): Solar;
    getWeek(): number;
    getLunar(): Lunar;
    getFestivals(): string[];
    getOtherFestivals(): string[];
  }

  export class Lunar {
    getDayInChinese(): string;
    getMonthInChinese(): string;
    getFestivals(): string[];
    getOtherFestivals(): string[];
    getJieQi(): string;
    toString(): string;
  }

  export class Holiday {
    getName(): string;
    isWork(): boolean;
    getDay(): string;
  }

  export class HolidayUtil {
    static getHoliday(y: number, m: number, d: number): Holiday | null;
  }
}
