import "server-only";
import { PNG } from "pngjs";

const META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refp_0360.json";
const HRRR_REFP_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi";

export type HrrrPointSample = {
  forecastMinutes: number;
  precipitation: boolean | null;
};

type IemMeta = { model_init_utc?: string };

export async function getHrrrModelInitUtc(): Promise<string | null> {
  try {
    const response = await fetch(META_URL, { next: { revalidate: 60 } });
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

export async function getHrrrPointSample(lat: number, lon: number, forecastMinutes: number): Promise<HrrrPointSample> {
  const layer = `refp_${String(forecastMinutes).padStart(4, "0")}`;
  const delta = 0.06;
  const size = 31;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: layer,
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    SRS: "EPSG:4326",
    BBOX: `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`,
    WIDTH: String(size),
    HEIGHT: String(size),
  });

  try {
    const response = await fetch(`${HRRR_REFP_WMS}?${params.toString()}`, { next: { revalidate: 60 } });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("image/png")) {
      return { forecastMinutes, precipitation: null };
    }
    const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    const centerX = Math.floor(png.width / 2);
    const centerY = Math.floor(png.height / 2);
    let visiblePixels = 0;
    for (let y = Math.max(0, centerY - 1); y <= Math.min(png.height - 1, centerY + 1); y += 1) {
      for (let x = Math.max(0, centerX - 1); x <= Math.min(png.width - 1, centerX + 1); x += 1) {
        const offset = (png.width * y + x) * 4;
        if (png.data[offset + 3] > 24) visiblePixels += 1;
      }
    }
    return { forecastMinutes, precipitation: visiblePixels > 0 };
  } catch {
    return { forecastMinutes, precipitation: null };
  }
}
