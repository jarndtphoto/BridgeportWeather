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
