const NOAA_RADAR_WMS = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";

export const RADAR_LAYER = "conus_bref_qcd";
export const RADAR_SOURCE = {
  provider: "NOAA / National Weather Service",
  product: "MRMS quality-controlled base reflectivity mosaic",
  observationType: "Observed radar reflectivity (not forecast precipitation)",
  expectedUpdateIntervalMinutes: 2,
  service: NOAA_RADAR_WMS,
} as const;

export type RadarFrame = { id: string; observedAt: string; epochSeconds: number };

function parseRadarFrames(xml: string): RadarFrame[] {
  const dimension = xml.match(/<Dimension[^>]+name=["']time["'][^>]*>([^<]+)<\/Dimension>/i)?.[1];
  if (!dimension) throw new Error("NOAA radar metadata did not include frame timestamps");
  const allFrames = dimension.split(",").map((value) => value.trim()).filter(Boolean)
    .map((observedAt) => ({ observedAt, epochSeconds: Math.floor(Date.parse(observedAt) / 1000) }))
    .filter((frame) => Number.isFinite(frame.epochSeconds));
  return allFrames.slice(-30).map((frame) => ({ ...frame, id: String(frame.epochSeconds) }));
}

async function fetchRadarCapabilities(noStore = false): Promise<RadarFrame[]> {
  const url = new URL(NOAA_RADAR_WMS);
  url.search = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetCapabilities" }).toString();
  const response = await fetch(url, noStore ? { cache: "no-store" } : { next: { revalidate: 60 } });
  if (!response.ok) throw new Error(`NOAA radar metadata returned ${response.status}`);
  return parseRadarFrames(await response.text());
}

export async function getRadarFrames(): Promise<RadarFrame[]> {
  let frames = await fetchRadarCapabilities(false);
  const latest = frames[frames.length - 1] ?? null;
  const latestAgeMinutes = latest ? (Date.now() - Date.parse(latest.observedAt)) / 60_000 : Infinity;

  // Next's data cache can occasionally hold an old NOAA capabilities document
  // after the live WMS has already advanced. Retry uncached before declaring
  // radar analysis stale so threat assessment follows the actual live feed.
  if (latestAgeMinutes > 10) {
    try {
      const fresh = await fetchRadarCapabilities(true);
      const freshLatest = fresh[fresh.length - 1] ?? null;
      if (freshLatest && (!latest || freshLatest.epochSeconds > latest.epochSeconds)) {
        frames = fresh;
      }
    } catch {
      // Keep the cached frame list; callers can still decide whether it is stale.
    }
  }
  return frames;
}

export function radarWmsUrl() { return NOAA_RADAR_WMS; }

const EARTH_RADIUS_M = 20037508.34;

function toMercator(lat: number, lon: number): { x: number; y: number } {
  const x = (lon * EARTH_RADIUS_M) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (EARTH_RADIUS_M / 180);
  return { x, y };
}

const DBZ_PROPERTY_CANDIDATES = ["GRAY_INDEX", "gray_index", "value", "VALUE", "band1", "PALETTE_INDEX"];

function extractDbzValue(properties: Record<string, unknown>): number | null {
  for (const key of DBZ_PROPERTY_CANDIDATES) {
    const raw = properties[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
    if (value !== null && Number.isFinite(value)) return value;
  }
  for (const raw of Object.values(properties)) {
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
    if (value !== null && Number.isFinite(value)) return value;
  }
  return null;
}

export async function getRadarPointReflectivity(lat: number, lon: number, isoTime: string): Promise<number | null> {
  const center = toMercator(lat, lon);
  const halfSizeMeters = 400;
  const bbox = [center.x - halfSizeMeters, center.y - halfSizeMeters, center.x + halfSizeMeters, center.y + halfSizeMeters].join(",");
  const size = 3;

  const url = new URL(NOAA_RADAR_WMS);
  url.search = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetFeatureInfo",
    layers: RADAR_LAYER,
    query_layers: RADAR_LAYER,
    styles: "",
    srs: "EPSG:3857",
    bbox,
    width: String(size),
    height: String(size),
    x: String(Math.floor(size / 2)),
    y: String(Math.floor(size / 2)),
    info_format: "application/json",
    feature_count: "1",
    time: isoTime,
  }).toString();

  let rawText: string;
  try {
    const response = await fetch(url, { next: { revalidate: 60 } });
    rawText = await response.text();
    if (!response.ok) {
      console.error(`Radar point reflectivity: HTTP ${response.status}`, rawText.slice(0, 500));
      return null;
    }
  } catch (error) {
    console.error("Radar point reflectivity: request failed", error);
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    console.error("Radar point reflectivity: non-JSON response", rawText.slice(0, 500));
    return null;
  }

  const feature = (payload as { features?: Array<{ properties?: Record<string, unknown> }> })?.features?.[0];
  if (!feature?.properties) {
    console.error("Radar point reflectivity: no feature in response", JSON.stringify(payload).slice(0, 500));
    return null;
  }

  const value = extractDbzValue(feature.properties);
  if (value === null) {
    console.error("Radar point reflectivity: no numeric property found", JSON.stringify(feature.properties));
  }
  return value;
}
