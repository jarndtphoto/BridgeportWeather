import { RADAR_LAYER, radarWmsUrl } from "../../../../lib/radar";

export const dynamic = "force-dynamic";

const IEM_RADAR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi";
const IEM_RADAR_LAYER = "nexrad-n0q-wmst";

function validSize(value: string | null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2048 ? String(number) : null;
}

function validBbox(value: string | null) {
  if (!value) return null;
  const values = value.split(",").map(Number);
  return values.length === 4 && values.every(Number.isFinite) ? values.join(",") : null;
}

function iemTime(isoTime: string) {
  const date = new Date(isoTime);
  // IEM's nationwide NEXRAD mosaic is generated on 5-minute intervals.
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 5) * 5);
  return date.toISOString();
}

function freshestIemTime() {
  // Stay one 5-minute bucket behind wall-clock time so the mosaic is very
  // likely to be published while still being near-real-time.
  const target = Date.now() - 5 * 60_000;
  return new Date(Math.floor(target / (5 * 60_000)) * (5 * 60_000)).toISOString();
}

async function fetchImage(url: URL, revalidate: number) {
  const response = await fetch(url, { next: { revalidate } });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("image/")) return null;
  return { body: response.body, contentType };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const bbox = validBbox(params.get("bbox") ?? params.get("BBOX"));
  const width = validSize(params.get("width") ?? params.get("WIDTH"));
  const height = validSize(params.get("height") ?? params.get("HEIGHT"));
  const rawTime = params.get("time") ?? params.get("TIME");
  const time = rawTime && Number.isFinite(Date.parse(rawTime)) ? new Date(rawTime).toISOString() : null;
  const live = params.get("live") === "1";
  if (!bbox || !width || !height || !time) {
    return Response.json({ error: "Invalid radar image request." }, { status: 400 });
  }

  const noaaUrl = new URL(radarWmsUrl());
  noaaUrl.search = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: RADAR_LAYER,
    styles: "radar_reflectivity",
    format: "image/png",
    transparent: "true",
    srs: "EPSG:3857",
    bbox,
    width,
    height,
    time,
  }).toString();

  try {
    const noaa = live ? null : await fetchImage(noaaUrl, 60);
    if (noaa) {
      return new Response(noaa.body, {
        headers: {
          "Content-Type": noaa.contentType,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Radar-Source": "NOAA-MRMS",
        },
      });
    }

    // Current Radar always uses IEM N0Q. NOAA's WMS can return a valid but
    // transparent image for a fresh timestamp even while its metadata and point
    // analysis are healthy. Using IEM for the live frame keeps the visible radar
    // independent from NOAA's image-rendering quirks. Historical/scrubbed frames
    // still try NOAA first and fall back here only when needed.
    const iemUrl = new URL(IEM_RADAR_WMS);
    iemUrl.search = new URLSearchParams({
      service: "WMS",
      version: "1.1.1",
      request: "GetMap",
      layers: IEM_RADAR_LAYER,
      styles: "default",
      format: "image/png",
      transparent: "true",
      srs: "EPSG:3857",
      bbox,
      width,
      height,
      time: live ? freshestIemTime() : iemTime(time),
    }).toString();

    const iem = await fetchImage(iemUrl, 60);
    if (!iem) throw new Error("Both NOAA and IEM radar image services are unavailable");

    return new Response(iem.body, {
      headers: {
        "Content-Type": iem.contentType,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "X-Radar-Source": live ? "IEM-NEXRAD-N0Q-LIVE" : "IEM-NEXRAD-N0Q-FALLBACK",
      },
    });
  } catch {
    return Response.json({ error: "Radar image temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
