export const dynamic = "force-dynamic";

// Use the analysis field to identify the newest HRRR run. The previous
// refp_0360 metadata waits for the +6 hour product and can lag several runs,
// which made the Future Radar "Current" frame start from stale guidance.
const META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refp_0000.json";

type IemMeta = {
  model_init_utc?: string;
};

export async function GET() {
  try {
    const response = await fetch(META_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`IEM HRRR metadata returned ${response.status}`);
    const payload = (await response.json()) as IemMeta;
    return Response.json(
      { modelInitUtc: payload.model_init_utc ?? null },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return Response.json(
      { modelInitUtc: null },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
