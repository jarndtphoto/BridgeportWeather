import { RADAR_LAYER, radarWmsUrl } from "../../../../lib/radar";
import { PNG } from "pngjs";

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
  if (!bbox || !width || !height || (rawTime && !time)) return Response.json({ error: "Invalid radar image request." }, { status: 400 });

  const wmsParams: Record<string, string> = { service: "WMS", version: "1.1.1", request: "GetMap", layers: RADAR_LAYER, styles: "", format: "image/png", transparent: "true", srs: "EPSG:3857", bbox, width, height };
  if (time) wmsParams.time = time;
  const url = new URL(radarWmsUrl());
  url.search = new URLSearchParams(wmsParams).toString();
  try {
    const response = await fetch(url, { cache: time ? undefined : "no-store", next: time ? { revalidate: 30 } : undefined });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("image/")) throw new Error("NOAA radar image unavailable");

    const bytes = Buffer.from(await response.arrayBuffer());
    let visiblePixels: number | null = null;
    let totalPixels: number | null = null;
    try {
      const png = PNG.sync.read(bytes);
      totalPixels = png.width * png.height;
      let visible = 0;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 8) visible++;
      visiblePixels = visible;
    } catch {}

    console.info("RADAR_IMAGE_DIAGNOSTIC", {
      requestedTime: time,
      bbox,
      width,
      height,
      upstreamUrl: url.toString(),
      contentType,
      visiblePixels,
      totalPixels,
    });

    return new Response(bytes, {
      headers: {
        "Content-Type": contentType || "image/png",
        "Cache-Control": time ? "public, s-maxage=30, stale-while-revalidate=60" : "no-store",
        "X-Radar-Time": time ?? "latest",
        ...(visiblePixels !== null ? { "X-Radar-Visible-Pixels": String(visiblePixels) } : {}),
        ...(totalPixels !== null ? { "X-Radar-Total-Pixels": String(totalPixels) } : {}),
      },
    });
  } catch {
    return Response.json({ error: "Radar image temporarily unavailable." }, { status: 502 });
  }
}
