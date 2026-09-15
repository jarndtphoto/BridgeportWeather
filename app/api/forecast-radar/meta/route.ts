export const dynamic = "force-dynamic";

const META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json";

type IemMeta = {
  model_init_utc?: string;
};

export async function GET() {
  try {
    const response = await fetch(META_URL, { next: { revalidate: 300 } });
    if (!response.ok) throw new Error(`IEM HRRR metadata returned ${response.status}`);
    const payload = (await response.json()) as IemMeta;
    return Response.json(
      { modelInitUtc: payload.model_init_utc ?? null },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" } },
    );
  } catch {
    return Response.json(
      { modelInitUtc: null },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  }
}
