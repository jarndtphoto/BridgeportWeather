import { AmbientWeatherError, getAmbientSnapshot } from "../../../lib/ambient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getAmbientSnapshot();
    return Response.json(snapshot, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    const knownError = error instanceof AmbientWeatherError;
    const status = knownError && error.code === "configuration" ? 503 : knownError && error.code === "no_station" ? 404 : 502;
    return Response.json(
      { error: "Live station data is unavailable.", code: knownError ? error.code : "unexpected" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
