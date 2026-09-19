import { PNG } from "pngjs";
import { getRadarFrames, RADAR_LAYER, radarWmsUrl } from "../../../../lib/radar";

export const dynamic = "force-dynamic";

const TEST_BBOX = "-10130073.660777777,4865942.278825832,-9462156.716111112,5748356.800802762";

async function inspect(params: Record<string,string>) {
  const url = new URL(radarWmsUrl());
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  let visiblePixels: number | null = null;
  try {
    const png = PNG.sync.read(bytes);
    width = png.width;
    height = png.height;
    let visible = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 8) visible++;
    visiblePixels = visible;
  } catch {}
  return {
    ok: response.ok,
    status: response.status,
    contentType,
    byteLength: bytes.length,
    width,
    height,
    visiblePixels,
    url: url.toString(),
  };
}

export async function GET() {
  const frames = await getRadarFrames();
  const latest = frames[frames.length - 1] ?? null;
  const base = {
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: RADAR_LAYER,
    format: "image/png",
    transparent: "true",
    srs: "EPSG:3857",
    bbox: TEST_BBOX,
    width: "800",
    height: "800",
  };
  const variants = latest ? {
    exactWorkingPath: await inspect({ ...base, styles: "radar_reflectivity", time: latest.observedAt }),
    defaultStyle: await inspect({ ...base, styles: "", time: latest.observedAt }),
    noTimeDefaultStyle: await inspect({ ...base, styles: "" }),
  } : null;
  return Response.json({ latest, variants }, { headers: { "Cache-Control": "no-store" } });
}
