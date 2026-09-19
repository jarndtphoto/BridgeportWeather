import { RADAR_LAYER, radarWmsUrl } from "../../../../lib/radar";

export const dynamic = "force-dynamic";

const IEM_RADAR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi";
const IEM_RADAR_LAYER = "nexrad-n0r-wmst";

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
    const noaa = await fetchImage(noaaUrl, 60);
    if (noaa) {
      return new Response(noaa.body, {
        headers: {
          "Content-Type": noaa.contentType,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Radar-Source": "NOAA-MRMS",
        },
      });
    }

    // NOAA's GeoServer occasionally returns 5xx while its timestamp feed is
    // still healthy. Fall back to IEM's live nationwide NEXRAD mosaic so the
    // Live tab remains useful without changing the rest of the app.
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
      time: iemTime(time),
    }).toString();

    const iem = await fetchImage(iemUrl, 60);
    if (!iem) throw new Error("Both NOAA and IEM radar image services are unavailable");

    return new Response(iem.body, {
      headers: {
        "Content-Type": iem.contentType,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "X-Radar-Source": "IEM-NEXRAD-FALLBACK",
      },
    });
  } catch {
    return Response.json({ error: "Radar image temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
