import { getRadarFrames, RADAR_SOURCE } from "../../../../lib/radar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const frames = await getRadarFrames();
    return Response.json({ source: RADAR_SOURCE, frames }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch {
    return Response.json({ error: "Live NOAA radar metadata is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
