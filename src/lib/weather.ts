export type WeatherCity = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** 中国天气网城市码 → www.weather.com.cn PC 预报页 */
  cnCode: string;
};

export const WEATHER_CITIES: WeatherCity[] = [
  { id: "beijing", name: "北京", lat: 39.9042, lon: 116.4074, cnCode: "101010100" },
  { id: "shanghai", name: "上海", lat: 31.2304, lon: 121.4737, cnCode: "101020100" },
  { id: "guangzhou", name: "广州", lat: 23.1291, lon: 113.2644, cnCode: "101280101" },
  { id: "shenzhen", name: "深圳", lat: 22.5431, lon: 114.0579, cnCode: "101280601" },
  { id: "hangzhou", name: "杭州", lat: 30.2741, lon: 120.1551, cnCode: "101210101" },
  { id: "chengdu", name: "成都", lat: 30.5728, lon: 104.0668, cnCode: "101270101" },
];

export const DEFAULT_CITY_ID = "beijing";
const STORAGE_KEY = "snuby.home.weatherCity";

/** 中国天气网 · PC 版城市 7 天预报（免费、免登录、国内可访问） */
export function forecastUrlOf(city: WeatherCity): string {
  return `https://www.weather.com.cn/weather/${city.cnCode}.shtml`;
}

export function loadWeatherCityId(): string {
  if (typeof window === "undefined") return DEFAULT_CITY_ID;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && WEATHER_CITIES.some((c) => c.id === v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_CITY_ID;
}

export function saveWeatherCityId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function cityById(id: string): WeatherCity {
  return WEATHER_CITIES.find((c) => c.id === id) ?? WEATHER_CITIES[0]!;
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
