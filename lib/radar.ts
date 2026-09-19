import { PNG } from "pngjs";

const NOAA_RADAR_WMS = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";
const IEM_N0Q_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi";
const IEM_N0Q_LAYER = "nexrad-n0q-wmst";

export const RADAR_LAYER = "conus_bref_qcd";
export const RADAR_SOURCE = {
  provider: "NOAA / National Weather Service",
  product: "MRMS quality-controlled base reflectivity mosaic",
  observationType: "Observed radar reflectivity (not forecast precipitation)",
  expectedUpdateIntervalMinutes: 2,
  service: NOAA_RADAR_WMS,
} as const;

export type RadarFrame = { id: string; observedAt: string; epochSeconds: number };

function parseRadarTimes(value: string) {
  return [...value.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g)]
    .map((item) => item[0])
    .filter((time, index, list) => list.indexOf(time) === index)
    .map((observedAt) => ({ observedAt, epochSeconds: Math.floor(Date.parse(observedAt) / 1000) }))
    .filter((frame) => Number.isFinite(frame.epochSeconds))
    .sort((a, b) => a.epochSeconds - b.epochSeconds);
}

function parseRadarFrames(xml: string): RadarFrame[] {
  // NOAA's capabilities document exposes multiple WMS layers with their own
  // time dimensions. Live Radar must use timestamps from conus_bref_qcd only;
  // a timestamp from another layer can produce a valid-but-empty PNG.
  const layerName = new RegExp(`<Name>\\s*${RADAR_LAYER}\\s*</Name>`, "i");
  const nameMatch = layerName.exec(xml);
  if (!nameMatch) throw new Error("NOAA radar layer was not found in capabilities");

  const afterName = xml.slice(nameMatch.index + nameMatch[0].length);
  const nextLayer = afterName.search(/<Layer\b/i);
  const layerChunk = nextLayer >= 0 ? afterName.slice(0, nextLayer) : afterName;
  const timeMatch = layerChunk.match(/<(?:Dimension|Extent)\b[^>]*name=["']time["'][^>]*>([\s\S]*?)<\/(?:Dimension|Extent)>/i);
  if (!timeMatch) throw new Error("NOAA radar layer did not include frame timestamps");

  const frames = parseRadarTimes(timeMatch[1]);
  if (!frames.length) throw new Error("NOAA radar layer returned no usable frame timestamps");

  return frames.slice(-30).map((frame) => ({ ...frame, id: String(frame.epochSeconds) }));
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

  // Keep the radar-analysis freshness improvement from the later fix, but only
  // accept uncached timestamps that belong to the actual MRMS reflectivity layer.
  if (latestAgeMinutes > 10) {
    try {
      const fresh = await fetchRadarCapabilities(true);
      const freshLatest = fresh[fresh.length - 1] ?? null;
      if (freshLatest && (!latest || freshLatest.epochSeconds > latest.epochSeconds)) frames = fresh;
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

function iemRadarTime(isoTime: string) {
  const parsed = Date.parse(isoTime);
  const target = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(Math.floor(target / (5 * 60_000)) * (5 * 60_000)).toISOString();
}

function approximateDbzFromPixel(r: number, g: number, b: number, a: number): number {
  if (a < 24 || (r < 20 && g < 20 && b < 20)) return 0;

  // IEM renders the familiar NEXRAD reflectivity ramp. Threat logic only needs
  // broad intensity bands, not lab-grade dBZ, so classify by the displayed
  // radar color when NOAA GetFeatureInfo is unavailable.
  if (r > 180 && b > 120 && g < 120) return 60; // magenta/purple
  if (r > 180 && g < 120 && b < 120) return 50; // red
  if (r > 180 && g >= 120 && g < 220 && b < 100) return 45; // orange
  if (r > 180 && g >= 180 && b < 120) return 40; // yellow
  if (g > r * 1.2 && g > b * 1.15 && g > 90) return 25; // green
  if (b > r * 1.15 && b >= g * 0.8) return 15; // blue
  if (g > 100 && b > 100) return 10; // cyan/light blue
  return 5;
}

async function getIemRadarPointReflectivity(lat: number, lon: number, isoTime: string): Promise<number | null> {
  const center = toMercator(lat, lon);
  const halfSizeMeters = 1200;
  const size = 7;
  const url = new URL(IEM_N0Q_WMS);
  url.search = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: IEM_N0Q_LAYER,
    styles: "default",
    format: "image/png",
    transparent: "true",
    srs: "EPSG:3857",
    bbox: [
      center.x - halfSizeMeters,
      center.y - halfSizeMeters,
      center.x + halfSizeMeters,
      center.y + halfSizeMeters,
    ].join(","),
    width: String(size),
    height: String(size),
    time: iemRadarTime(isoTime),
  }).toString();

  try {
    const response = await fetch(url, { next: { revalidate: 60 } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("image/")) return null;

    const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    const cx = Math.floor(png.width / 2);
    const cy = Math.floor(png.height / 2);
    let strongest = 0;

    for (let y = Math.max(0, cy - 1); y <= Math.min(png.height - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(png.width - 1, cx + 1); x++) {
        const index = (y * png.width + x) * 4;
        strongest = Math.max(
          strongest,
          approximateDbzFromPixel(png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]),
        );
      }
    }
    return strongest;
  } catch (error) {
    console.error("IEM radar point fallback failed", error);
    return null;
  }
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
      return getIemRadarPointReflectivity(lat, lon, isoTime);
    }
  } catch (error) {
    console.error("Radar point reflectivity: request failed", error);
    return getIemRadarPointReflectivity(lat, lon, isoTime);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    console.error("Radar point reflectivity: non-JSON response", rawText.slice(0, 500));
    return getIemRadarPointReflectivity(lat, lon, isoTime);
  }

  const feature = (payload as { features?: Array<{ properties?: Record<string, unknown> }> })?.features?.[0];
  if (!feature?.properties) {
    console.error("Radar point reflectivity: no feature in response", JSON.stringify(payload).slice(0, 500));
    return getIemRadarPointReflectivity(lat, lon, isoTime);
  }

  const value = extractDbzValue(feature.properties);
  if (value === null) {
    console.error("Radar point reflectivity: no numeric property found", JSON.stringify(feature.properties));
    return getIemRadarPointReflectivity(lat, lon, isoTime);
  }
  return value;
}
