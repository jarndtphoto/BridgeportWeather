import "server-only";

const NWS_BASE = "https://api.weather.gov";
const USER_AGENT = "BridgeportStormWatch (https://bridgeport-weather.vercel.app)";

export type HourlyForecastPeriod = {
  number: number;
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  precipitationChance: number | null;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
};

export type DailyForecastPeriod = {
  number: number;
  name: string;
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  precipitationChance: number | null;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
};

export type LocalForecast = {
  updatedAt: string | null;
  hourly: HourlyForecastPeriod[];
  daily: DailyForecastPeriod[];
  source: "NWS";
};

type NwsPeriod = {
  number?: number;
  name?: string;
  startTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
  detailedForecast?: string;
};

type ForecastPayload = {
  properties?: {
    updated?: string;
    periods?: NwsPeriod[];
  };
};

type PointsPayload = {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
  };
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error(`NWS forecast request failed: ${response.status}`);
  return (await response.json()) as T;
}

function hourlyPeriod(period: NwsPeriod): HourlyForecastPeriod | null {
  if (!period.startTime || typeof period.temperature !== "number") return null;
  return {
    number: period.number ?? 0,
    startTime: period.startTime,
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit ?? "F",
    precipitationChance: period.probabilityOfPrecipitation?.value ?? null,
    windSpeed: period.windSpeed ?? "",
    windDirection: period.windDirection ?? "",
    shortForecast: period.shortForecast ?? "",
  };
}

function dailyPeriod(period: NwsPeriod): DailyForecastPeriod | null {
  if (!period.startTime || typeof period.temperature !== "number") return null;
  return {
    number: period.number ?? 0,
    name: period.name ?? "Forecast",
    startTime: period.startTime,
    isDaytime: period.isDaytime ?? true,
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit ?? "F",
    precipitationChance: period.probabilityOfPrecipitation?.value ?? null,
    windSpeed: period.windSpeed ?? "",
    windDirection: period.windDirection ?? "",
    shortForecast: period.shortForecast ?? "",
    detailedForecast: period.detailedForecast ?? "",
  };
}

export async function getLocalForecast(lat: number, lon: number): Promise<LocalForecast> {
  const points = await fetchJson<PointsPayload>(`${NWS_BASE}/points/${lat},${lon}`);
  const forecastUrl = points.properties?.forecast;
  const hourlyUrl = points.properties?.forecastHourly;
  if (!forecastUrl || !hourlyUrl) throw new Error("NWS point metadata did not include forecast URLs");

  const [hourlyPayload, dailyPayload] = await Promise.all([
    fetchJson<ForecastPayload>(hourlyUrl),
    fetchJson<ForecastPayload>(forecastUrl),
  ]);

  return {
    updatedAt: hourlyPayload.properties?.updated ?? dailyPayload.properties?.updated ?? null,
    hourly: (hourlyPayload.properties?.periods ?? []).map(hourlyPeriod).filter((period): period is HourlyForecastPeriod => period !== null),
    daily: (dailyPayload.properties?.periods ?? []).map(dailyPeriod).filter((period): period is DailyForecastPeriod => period !== null),
    source: "NWS",
  };
}
