import "server-only";
import { PNG } from "pngjs";

const META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refp_0360.json";
const HRRR_REFP_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi";
const HRRR_REFD_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi";

export type HrrrEchoIntensity = "none" | "light" | "moderate" | "strong";

export type HrrrPointSample = {
  forecastMinutes: number;
  precipitation: boolean | null;
  intensity: HrrrEchoIntensity | null;
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

function intensityScore(r: number, g: number, b: number, a: number) {
  if (a <= 24) return 0;
  // IEM REFD uses the N0Q reflectivity palette. Keep the classification
  // deliberately broad: green/cool echoes are light, yellow/orange are
  // moderate, and red/magenta echoes are strong convection candidates.
  if ((r >= 180 && g < 120) || (r >= 135 && b >= 115 && g < 115)) return 3;
  if (r >= 175 && g >= 105 && b < 125) return 2;
  return 1;
}

async function fetchRadarPng(url: string) {
  const response = await fetch(url, { next: { revalidate: 60 } });
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("image/png")) return null;
  return PNG.sync.read(Buffer.from(await response.arrayBuffer()));
}

export async function getHrrrPointSample(lat: number, lon: number, forecastMinutes: number): Promise<HrrrPointSample> {
  const refpLayer = `refp_${String(forecastMinutes).padStart(4, "0")}`;
  const refdLayer = `refd_${String(forecastMinutes).padStart(4, "0")}`;
  const delta = 0.06;
  const size = 61;
  const baseParams = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    SRS: "EPSG:4326",
    BBOX: `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`,
    WIDTH: String(size),
    HEIGHT: String(size),
  };

  const refpParams = new URLSearchParams({ ...baseParams, LAYERS: refpLayer });
  const refdParams = new URLSearchParams({ ...baseParams, LAYERS: refdLayer });

  try {
    const [precipPng, reflectivityPng] = await Promise.all([
      fetchRadarPng(`${HRRR_REFP_WMS}?${refpParams.toString()}`),
      fetchRadarPng(`${HRRR_REFD_WMS}?${refdParams.toString()}`),
    ]);
    if (!precipPng || !reflectivityPng) return { forecastMinutes, precipitation: null, intensity: null };

    const centerX = Math.floor(size / 2);
    const centerY = Math.floor(size / 2);
    // Roughly a 2–3 mile neighborhood around Bridgeport instead of one pixel.
    const radiusPx = 17;
    let precipPixels = 0;
    let strongest = 0;

    for (let y = centerY - radiusPx; y <= centerY + radiusPx; y += 1) {
      for (let x = centerX - radiusPx; x <= centerX + radiusPx; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > radiusPx * radiusPx) continue;

        const offset = (size * y + x) * 4;
        if (precipPng.data[offset + 3] > 24) precipPixels += 1;
        strongest = Math.max(
          strongest,
          intensityScore(
            reflectivityPng.data[offset],
            reflectivityPng.data[offset + 1],
            reflectivityPng.data[offset + 2],
            reflectivityPng.data[offset + 3],
          ),
        );
      }
    }

    const precipitation = precipPixels > 0;
    const intensity: HrrrEchoIntensity = !precipitation || strongest === 0
      ? "none"
      : strongest >= 3
        ? "strong"
        : strongest === 2
          ? "moderate"
          : "light";

    return { forecastMinutes, precipitation, intensity };
  } catch {
    return { forecastMinutes, precipitation: null, intensity: null };
  }
}
