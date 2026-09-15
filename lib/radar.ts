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

export async function getRadarFrames(): Promise<RadarFrame[]> {
  const url = new URL(NOAA_RADAR_WMS);
  url.search = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetCapabilities" }).toString();
  const response = await fetch(url, { next: { revalidate: 60 } });
  if (!response.ok) throw new Error(`NOAA radar metadata returned ${response.status}`);
  const xml = await response.text();
  const dimension = xml.match(/<Dimension[^>]+name=["']time["'][^>]*>([^<]+)<\/Dimension>/i)?.[1];
  if (!dimension) throw new Error("NOAA radar metadata did not include frame timestamps");
  const allFrames = dimension.split(",").map((value) => value.trim()).filter(Boolean)
    .map((observedAt) => ({ observedAt, epochSeconds: Math.floor(Date.parse(observedAt) / 1000) }))
    .filter((frame) => Number.isFinite(frame.epochSeconds));
  return allFrames.slice(-30).map((frame) => ({ ...frame, id: String(frame.epochSeconds) }));
}

export function radarWmsUrl() { return NOAA_RADAR_WMS; }

const EARTH_RADIUS_M = 20037508.34;

function toMercator(lat: number, lon: number): { x: number; y: number } {
  const x = (lon * EARTH_RADIUS_M) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (EARTH_RADIUS_M / 180);
  return { x, y };
}

// Candidate property names GeoServer commonly uses for a raw coverage value in a
// GetFeatureInfo JSON response. This layer's exact key hasn't been verified against
// the live NOAA service from this environment — if reflectivity reads always come back
// null in production, log a sample response and add the real key here.
const DBZ_PROPERTY_CANDIDATES = ["GRAY_INDEX", "gray_index", "value", "VALUE", "band1", "PALETTE_INDEX"];

/**
 * Queries the NOAA WMS for the base-reflectivity value (dBZ) at a single point, using a
 * tiny GetFeatureInfo request centered on that point. Returns null if the service has no
 * data there (clear air) or the request/parsing fails.
 */
export async function getRadarPointReflectivity(lat: number, lon: number, isoTime: string): Promise<number | null> {
  const center = toMercator(lat, lon);
  const halfSizeMeters = 400; // small bbox around the point, in Web Mercator meters
  const bbox = [center.x - halfSizeMeters, center.y - halfSizeMeters, center.x + halfSizeMeters, center.y + halfSizeMeters].join(",");
  const size = 3; // 3x3 px grid, query the center pixel

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

  try {
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    const payload = await response.json();
    const feature = payload?.features?.[0];
    if (!feature?.properties) return null;
    for (const key of DBZ_PROPERTY_CANDIDATES) {
      const raw = feature.properties[key];
      const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
      if (value !== null && Number.isFinite(value)) return value;
    }
    return null;
  } catch {
    return null;
  }
}
