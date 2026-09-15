import { decodeFieldValues, nearestGridpoint, parseFields, parseGrid, splitMessages } from "@azohra/meteo.grib";
import { PNG } from "pngjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOMADS_FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl";
const MAX_SIZE = 480;
const MERCATOR_RADIUS = 20037508.34;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mercatorToLon(x: number) {
  return (x / MERCATOR_RADIUS) * 180;
}

function mercatorToLat(y: number) {
  const degrees = (y / MERCATOR_RADIUS) * 180;
  return (180 / Math.PI) * (2 * Math.atan(Math.exp((degrees * Math.PI) / 180)) - Math.PI / 2);
}

function parseBbox(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts as [number, number, number, number];
}

function hrrrRequest(modelInitUtc: string, forecastMinutes: number, bounds: { west: number; east: number; south: number; north: number }) {
  const init = new Date(modelInitUtc);
  if (Number.isNaN(init.getTime())) throw new Error("Invalid HRRR initialization time");
  const forecastHour = clamp(Math.round(forecastMinutes / 60), 0, 18);
  const y = init.getUTCFullYear();
  const m = String(init.getUTCMonth() + 1).padStart(2, "0");
  const d = String(init.getUTCDate()).padStart(2, "0");
  const hour = String(init.getUTCHours()).padStart(2, "0");
  const file = `hrrr.t${hour}z.wrfsfcf${String(forecastHour).padStart(2, "0")}.grib2`;
  const dir = `/hrrr.${y}${m}${d}/conus`;
  const url = new URL(NOMADS_FILTER);
  url.search = new URLSearchParams({
    file,
    lev_entire_atmosphere: "on",
    var_TCDC: "on",
    subregion: "",
    leftlon: String(bounds.west),
    rightlon: String(bounds.east),
    toplat: String(bounds.north),
    bottomlat: String(bounds.south),
    dir,
  }).toString();
  return { url, forecastHour };
}

function cloudPixel(cloudPercent: number | undefined) {
  const cloud = Number.isFinite(cloudPercent) ? clamp(cloudPercent as number, 0, 100) : 0;
  const brightness = Math.round(150 + cloud * 0.95);
  const alpha = Math.round(clamp((cloud - 5) / 95, 0, 1) * 205);
  return { brightness, alpha };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = parseBbox(searchParams.get("bbox"));
  const modelInitUtc = searchParams.get("modelInitUtc");
  const forecastMinutes = Number(searchParams.get("forecastMinutes"));
  if (!bbox || !modelInitUtc || !Number.isFinite(forecastMinutes)) {
    return new Response("Missing forecast cloud parameters", { status: 400 });
  }

  const requestedWidth = Number(searchParams.get("width")) || 420;
  const requestedHeight = Number(searchParams.get("height")) || 420;
  const scale = Math.min(1, MAX_SIZE / Math.max(requestedWidth, requestedHeight));
  const width = Math.max(120, Math.round(requestedWidth * scale));
  const height = Math.max(120, Math.round(requestedHeight * scale));

  const [minX, minY, maxX, maxY] = bbox;
  const west = mercatorToLon(minX);
  const east = mercatorToLon(maxX);
  const south = mercatorToLat(minY);
  const north = mercatorToLat(maxY);
  const padLon = Math.max(0.25, (east - west) * 0.08);
  const padLat = Math.max(0.2, (north - south) * 0.08);

  try {
    const { url, forecastHour } = hrrrRequest(modelInitUtc, forecastMinutes, {
      west: clamp(west - padLon, -134, -60),
      east: clamp(east + padLon, -134, -60),
      south: clamp(south - padLat, 20, 55),
      north: clamp(north + padLat, 20, 55),
    });
    const response = await fetch(url, { cache: "no-store", headers: { "User-Agent": "BridgeportStormWatch/1.0" } });
    if (!response.ok) throw new Error(`NOMADS returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const messages = splitMessages(bytes);
    if (!messages.length) throw new Error("NOMADS returned no GRIB messages");
    const fields = parseFields(messages[0]);
    const field = fields[0];
    if (!field) throw new Error("HRRR cloud field missing");
    const grid = parseGrid(field.section3);
    const { values } = decodeFieldValues(field);
    const png = new PNG({ width, height });

    for (let py = 0; py < height; py++) {
      const y = maxY - ((py + 0.5) / height) * (maxY - minY);
      const lat = mercatorToLat(y);
      for (let px = 0; px < width; px++) {
        const x = minX + ((px + 0.5) / width) * (maxX - minX);
        const lon = mercatorToLon(x);
        const point = nearestGridpoint(grid, lat, lon);
        const value = values[point.index];
        const { brightness, alpha } = cloudPixel(value);
        const offset = (py * width + px) * 4;
        png.data[offset] = brightness;
        png.data[offset + 1] = brightness;
        png.data[offset + 2] = brightness;
        png.data[offset + 3] = alpha;
      }
    }

    const buffer = PNG.sync.write(png);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-HRRR-Cloud-Hour": String(forecastHour),
      },
    });
  } catch (error) {
    console.error("Forecast cloud cover image failed", error);
    return new Response("Forecast cloud cover unavailable", { status: 502 });
  }
}
