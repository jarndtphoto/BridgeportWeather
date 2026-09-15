import "server-only";

const META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json";
const HRRR_REFD_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi";

export type HrrrPointSample = {
  forecastMinutes: number;
  precipitation: boolean | null;
  reflectivity: number | null;
};

type IemMeta = { model_init_utc?: string };

export async function getHrrrModelInitUtc(): Promise<string | null> {
  try {
    const response = await fetch(META_URL, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    const payload = (await response.json()) as IemMeta;
    return payload.model_init_utc ?? null;
  } catch {
    return null;
  }
}

export function hrrrForecastMinutesForTime(startTime: string, modelInitUtc: string | null): number | null {
  if (!modelInitUtc) return null;
  const target = Date.parse(startTime);
  const init = Date.parse(modelInitUtc);
  if (!Number.isFinite(target) || !Number.isFinite(init)) return null;
  const rawMinutes = (target - init) / 60_000;
  if (rawMinutes < 0 || rawMinutes > 1080) return null;
  return Math.round(rawMinutes / 15) * 15;
}

function numericValue(text: string) {
  const patterns = [
    /(?:value|pixel|band1|gray_index)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i,
    /(-?\d+(?:\.\d+)?)\s*dBZ/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export async function getHrrrPointSample(lat: number, lon: number, forecastMinutes: number): Promise<HrrrPointSample> {
  const layer = `refd_${String(forecastMinutes).padStart(4, "0")}`;
  const delta = 0.04;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: layer,
    QUERY_LAYERS: layer,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`,
    WIDTH: "101",
    HEIGHT: "101",
    X: "50",
    Y: "50",
    INFO_FORMAT: "text/plain",
    FEATURE_COUNT: "1",
  });

  try {
    const response = await fetch(`${HRRR_REFD_WMS}?${params.toString()}`, { next: { revalidate: 300 } });
    if (!response.ok) return { forecastMinutes, precipitation: null, reflectivity: null };
    const text = await response.text();
    const lower = text.toLowerCase();
    if (lower.includes("no results") || lower.includes("search returned no results") || lower.includes("no feature")) {
      return { forecastMinutes, precipitation: false, reflectivity: null };
    }
    const reflectivity = numericValue(text);
    if (reflectivity !== null) {
      return { forecastMinutes, precipitation: reflectivity >= 5, reflectivity };
    }
    const hasFeature = lower.includes("feature") || lower.includes("layer '") || lower.includes("layer \"");
    return { forecastMinutes, precipitation: hasFeature ? true : null, reflectivity: null };
  } catch {
    return { forecastMinutes, precipitation: null, reflectivity: null };
  }
}
