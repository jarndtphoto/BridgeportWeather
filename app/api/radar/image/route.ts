import { RADAR_LAYER, radarWmsUrl } from "../../../../lib/radar";

export const dynamic = "force-dynamic";

function validSize(value: string | null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2048 ? String(number) : null;
}

function validBbox(value: string | null) {
  if (!value) return null;
  const values = value.split(",").map(Number);
  return values.length === 4 && values.every(Number.isFinite) ? values.join(",") : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const bbox = validBbox(params.get("bbox") ?? params.get("BBOX"));
  const width = validSize(params.get("width") ?? params.get("WIDTH"));
  const height = validSize(params.get("height") ?? params.get("HEIGHT"));
  const rawTime = params.get("time") ?? params.get("TIME");
  const time = rawTime && Number.isFinite(Date.parse(rawTime)) ? new Date(rawTime).toISOString() : null;
  if (!bbox || !width || !height || !time) return Response.json({ error: "Invalid radar image request." }, { status: 400 });

  const url = new URL(radarWmsUrl());
  url.search = new URLSearchParams({ service: "WMS", version: "1.1.1", request: "GetMap", layers: RADAR_LAYER, styles: "", format: "image/png", transparent: "true", srs: "EPSG:3857", bbox, width, height, time }).toString();
  try {
    const response = await fetch(url, { next: { revalidate: 30 } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("image/")) throw new Error("NOAA radar image unavailable");
    return new Response(response.body, { headers: { "Content-Type": contentType || "image/png", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch {
    return Response.json({ error: "Radar image temporarily unavailable." }, { status: 502 });
  }
}
