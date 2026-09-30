import chinaWeatherCities from "@/data/china-weather-cities.json";

export type WeatherCity = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** 中国天气网 / 和风 Location_ID；有则弹窗内嵌官网预报 */
  cnCode?: string;
  /** 省 */
  admin1?: string;
  /** 地级市 */
  admin2?: string;
  country?: string;
};

/** 常用城市（带中国天气网城市码，预报可走官网） */
export const PRESET_CITIES: WeatherCity[] = [
  { id: "beijing", name: "北京", lat: 39.9042, lon: 116.4074, cnCode: "101010100", admin1: "北京市" },
  { id: "shanghai", name: "上海", lat: 31.2304, lon: 121.4737, cnCode: "101020100", admin1: "上海市" },
  { id: "guangzhou", name: "广州", lat: 23.1291, lon: 113.2644, cnCode: "101280101", admin1: "广东省", admin2: "广州市" },
  { id: "shenzhen", name: "深圳", lat: 22.5431, lon: 114.0579, cnCode: "101280601", admin1: "广东省", admin2: "深圳市" },
  { id: "hangzhou", name: "杭州", lat: 30.2741, lon: 120.1551, cnCode: "101210101", admin1: "浙江省", admin2: "杭州市" },
  { id: "chengdu", name: "成都", lat: 30.5728, lon: 104.0668, cnCode: "101270101", admin1: "四川省", admin2: "成都市" },
];

/** @deprecated 使用 PRESET_CITIES */
export const WEATHER_CITIES = PRESET_CITIES;

export const DEFAULT_CITY: WeatherCity = PRESET_CITIES[0]!;
const STORAGE_KEY = "snuby.home.weatherCity";

/** 本地县市表行（由 scripts/build-weather-cities.mjs 生成） */
type ChinaCityRow = {
  id: string;
  n: string;
  e: string;
  p: string;
  c: string;
  lat: number;
  lon: number;
};

const CHINA_CITIES = chinaWeatherCities as ChinaCityRow[];

function rowToWeatherCity(row: ChinaCityRow): WeatherCity {
  return {
    id: row.id,
    name: row.n,
    lat: row.lat,
    lon: row.lon,
    cnCode: row.id,
    admin1: row.p || undefined,
    admin2: row.c || undefined,
    country: "中国",
  };
}

/** 中国天气网 · PC 版城市 7 天预报（免费、免登录、国内可访问） */
export function forecastUrlOf(city: WeatherCity): string | null {
  if (!city.cnCode) return null;
  return `https://www.weather.com.cn/weather/${city.cnCode}.shtml`;
}

function isWeatherCity(v: unknown): v is WeatherCity {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.lat === "number" &&
    typeof o.lon === "number" &&
    Number.isFinite(o.lat) &&
    Number.isFinite(o.lon)
  );
}

/** 补齐 cnCode：常用表 → 本地县市表近邻 */
export function withPresetCnCode(city: WeatherCity): WeatherCity {
  if (city.cnCode) return city;

  const byPresetId = PRESET_CITIES.find((p) => p.id === city.id);
  if (byPresetId) return { ...city, cnCode: byPresetId.cnCode, name: byPresetId.name };

  const byNearPreset = PRESET_CITIES.find(
    (p) => Math.abs(p.lat - city.lat) < 0.35 && Math.abs(p.lon - city.lon) < 0.35,
  );
  if (byNearPreset) {
    return { ...city, cnCode: byNearPreset.cnCode, id: byNearPreset.id };
  }

  const byLocal =
    CHINA_CITIES.find(
      (r) => r.n === city.name && Math.abs(r.lat - city.lat) < 0.5 && Math.abs(r.lon - city.lon) < 0.5,
    ) ??
    CHINA_CITIES.find((r) => Math.abs(r.lat - city.lat) < 0.12 && Math.abs(r.lon - city.lon) < 0.12);
  if (byLocal) return rowToWeatherCity(byLocal);

  return city;
}

export function loadWeatherCity(): WeatherCity {
  if (typeof window === "undefined") return DEFAULT_CITY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CITY;
    // 新格式：整城 JSON
    if (raw.startsWith("{")) {
      const parsed: unknown = JSON.parse(raw);
      if (isWeatherCity(parsed)) return withPresetCnCode(parsed);
    }
    // 旧格式：仅 id
    const preset = PRESET_CITIES.find((c) => c.id === raw);
    if (preset) return preset;
  } catch {
    /* ignore */
  }
  return DEFAULT_CITY;
}

/** @deprecated 使用 loadWeatherCity */
export function loadWeatherCityId(): string {
  return loadWeatherCity().id;
}

export function saveWeatherCity(city: WeatherCity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(withPresetCnCode(city)));
  } catch {
    /* ignore */
  }
}

/** @deprecated 使用 saveWeatherCity */
export function saveWeatherCityId(id: string): void {
  const preset = PRESET_CITIES.find((c) => c.id === id);
  if (preset) saveWeatherCity(preset);
}

export function cityById(id: string): WeatherCity {
  return PRESET_CITIES.find((c) => c.id === id) ?? DEFAULT_CITY;
}

export function citySubtitle(city: WeatherCity): string {
  const bits: string[] = [];
  if (city.admin1) bits.push(city.admin1);
  if (city.admin2 && city.admin2 !== city.admin1 && city.admin2 !== `${city.name}市`) {
    bits.push(city.admin2);
  }
  return bits.join(" · ");
}

/** WMO weather interpretation codes → 中文简况 */
export function weatherCodeLabel(code: number): string {
  if (code === 0) return "晴";
  if (code === 1) return "大部晴朗";
  if (code === 2) return "局部多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 67) return "雨";
  if (code >= 71 && code <= 77) return "雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code >= 85 && code <= 86) return "阵雪";
  if (code >= 95) return "雷雨";
  return "—";
}

export type WeatherSnapshot = {
  tempC: number;
  code: number;
  label: string;
  humidity: number | null;
};

export type ForecastDay = {
  date: string;
  code: number;
  label: string;
  maxC: number;
  minC: number;
};

export async function fetchWeather(city: WeatherCity): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${city.lat}&longitude=${city.lon}` +
    `&current=temperature_2m,weather_code,relative_humidity_2m` +
    `&timezone=Asia%2FShanghai`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const data = (await r.json()) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      relative_humidity_2m?: number;
    };
  };
  const cur = data.current;
  if (!cur || typeof cur.temperature_2m !== "number") {
    throw new Error("weather malformed");
  }
  const code = typeof cur.weather_code === "number" ? cur.weather_code : -1;
  return {
    tempC: Math.round(cur.temperature_2m),
    code,
    label: weatherCodeLabel(code),
    humidity:
      typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null,
  };
}

export async function fetchForecastDays(city: WeatherCity): Promise<ForecastDay[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${city.lat}&longitude=${city.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FShanghai&forecast_days=7`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`forecast ${r.status}`);
  const data = (await r.json()) as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };
  const d = data.daily;
  if (!d?.time?.length) throw new Error("forecast malformed");
  return d.time.map((date, i) => {
    const code = typeof d.weather_code?.[i] === "number" ? d.weather_code[i]! : -1;
    return {
      date,
      code,
      label: weatherCodeLabel(code),
      maxC: Math.round(d.temperature_2m_max?.[i] ?? 0),
      minC: Math.round(d.temperature_2m_min?.[i] ?? 0),
    };
  });
}

/** 去掉常见行政区后缀，便于「安溪县」命中「安溪」 */
function stripAdminSuffix(s: string): string {
  return s.replace(/(特别行政区|自治区|土家族苗族自治州|朝鲜族自治州|地区|盟|自治州|州|省|市|县|区|旗)$/g, "");
}

function scoreCityRow(row: ChinaCityRow, qRaw: string, q: string, qStrip: string): number {
  const name = row.n;
  const en = row.e.toLowerCase();
  const p = row.p;
  const c = row.c;
  const nameStrip = stripAdminSuffix(name);

  if (name === qRaw || name === qStrip) return 100;
  if (nameStrip === qStrip) return 95;
  if (en === q) return 90;
  if (name.startsWith(qRaw) || nameStrip.startsWith(qStrip)) return 80;
  if (en.startsWith(q)) return 75;
  if (name.includes(qRaw) || nameStrip.includes(qStrip)) return 60;
  if (en.includes(q)) return 55;
  if (c.includes(qRaw) || stripAdminSuffix(c).includes(qStrip)) return 40;
  if (p.includes(qRaw) || stripAdminSuffix(p).includes(qStrip)) return 30;
  return 0;
}

/**
 * 本地县市模糊搜索（约 3k 条，含经纬度与天气网城市码）。
 * 数据来源：和风 LocationList（与 weather.com.cn 城市码同系）。
 */
export async function searchWeatherCities(query: string): Promise<WeatherCity[]> {
  const qRaw = query.trim();
  if (qRaw.length < 1) return [];
  const q = qRaw.toLowerCase();
  const qStrip = stripAdminSuffix(qRaw);

  const ranked: { score: number; row: ChinaCityRow }[] = [];
  for (const row of CHINA_CITIES) {
    const score = scoreCityRow(row, qRaw, q, qStrip);
    if (score > 0) ranked.push({ score, row });
  }
  ranked.sort((a, b) => b.score - a.score || a.row.n.localeCompare(b.row.n, "zh"));
  return ranked.slice(0, 12).map((x) => rowToWeatherCity(x.row));
}
