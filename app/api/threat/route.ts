import { getAmbientSnapshot } from "../../../lib/ambient";
import { getRadarFrames, getRadarPointReflectivity } from "../../../lib/radar";
import { assessThreat } from "../../../lib/threat";
import { recordPressure } from "../../../lib/trend";

export const dynamic = "force-dynamic";

const BRIDGEPORT_LAT = 41.8382;
const BRIDGEPORT_LON = -87.6331;

function numberField(observation: Record<string, unknown>, key: string): number | null {
  const value = observation[key];
  return typeof value === "number" ? value : null;
}

export async function GET() {
  const [ambientResult, framesResult] = await Promise.allSettled([getAmbientSnapshot(), getRadarFrames()]);

  const snapshot = ambientResult.status === "fulfilled" ? ambientResult.value : null;
  const frames = framesResult.status === "fulfilled" ? framesResult.value : [];
  const latestFrame = frames[frames.length - 1] ?? null;

  const windGustMph = snapshot ? numberField(snapshot.rawObservation, "windgustmph") : null;
  const hourlyRainIn = snapshot ? numberField(snapshot.rawObservation, "hourlyrainin") : null;
  const pressureInHg = snapshot ? numberField(snapshot.rawObservation, "baromrelin") ?? numberField(snapshot.rawObservation, "baromabsin") : null;

  const pressureTrendInHgPerHr = recordPressure(pressureInHg);

  const radarDbz = latestFrame ? await getRadarPointReflectivity(BRIDGEPORT_LAT, BRIDGEPORT_LON, latestFrame.observedAt) : null;

  const assessment = assessThreat({ windGustMph, hourlyRainIn, radarDbz, pressureTrendInHgPerHr });

  return Response.json(
    {
      assessment,
      inputs: { windGustMph, hourlyRainIn, radarDbz, pressureTrendInHgPerHr, stationOnline: snapshot !== null, radarFrameTime: latestFrame?.observedAt ?? null },
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
