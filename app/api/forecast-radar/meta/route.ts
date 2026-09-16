export const dynamic = "force-dynamic";

// The IEM refp_0000 metadata can lag behind newly available HRRR cycles.
// Probe recent HRRR analysis tiles directly over Chicago and use the newest
// run that is actually available, falling back to metadata only if needed.
const META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refp_0000.json";
const TILE_BASE = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0";
const PROBE_Z = 8;
const PROBE_X = 65;
const PROBE_Y = 95;
const MAX_LOOKBACK_HOURS = 6;

type IemMeta = {
  model_init_utc?: string;
};

function runId(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCHours()).padStart(2, "0")}00`;
}

function runIso(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours())).toISOString();
}

async function runAvailable(date: Date) {
  const id = runId(date);
  const url = `${TILE_BASE}/hrrr::REFP-F0000-${id}/${PROBE_Z}/${PROBE_X}/${PROBE_Y}.png`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return false;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("image")) return false;
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > 100;
  } catch {
    return false;
  }
}

async function freshestAvailableRun() {
  const now = new Date();
  const hour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  for (let offset = 0; offset <= MAX_LOOKBACK_HOURS; offset += 1) {
    const candidate = new Date(hour.getTime() - offset * 3_600_000);
    if (await runAvailable(candidate)) return runIso(candidate);
  }
  return null;
}

export async function GET() {
  const direct = await freshestAvailableRun();
  if (direct) {
    return Response.json(
      { modelInitUtc: direct, source: "direct-probe" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  try {
    const response = await fetch(META_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`IEM HRRR metadata returned ${response.status}`);
    const payload = (await response.json()) as IemMeta;
    return Response.json(
      { modelInitUtc: payload.model_init_utc ?? null, source: "metadata-fallback" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return Response.json(
      { modelInitUtc: null, source: "unavailable" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
