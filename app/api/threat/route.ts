import { getAmbientSnapshot } from "../../../lib/ambient";
import { getRadarFrames, getRadarPointReflectivity } from "../../../lib/radar";
import { getNwsAlerts } from "../../../lib/nws";
import { getProbSevereNear } from "../../../lib/probsevere";
import { assessThreat } from "../../../lib/threat";
import { assessStormEvolution } from "../../../lib/evolution";
import { recordPressure } from "../../../lib/trend";
export const dynamic = "force-dynamic";
const BRIDGEPORT_LAT = 41.8382, BRIDGEPORT_LON = -87.6331, STATE_CODE = "IL";
function numberField(observation: Record<string, unknown>, key: string): number | null { const value = observation[key]; return typeof value === "number" ? value : null; }
export async function GET() {
  const [ambientResult, framesResult, alertsResult, probSevereResult] = await Promise.allSettled([
    getAmbientSnapshot(), getRadarFrames(), getNwsAlerts(BRIDGEPORT_LAT, BRIDGEPORT_LON, STATE_CODE), getProbSevereNear(BRIDGEPORT_LAT, BRIDGEPORT_LON),
  ]);
  const snapshot = ambientResult.status === "fulfilled" ? ambientResult.value : null;
  const frames = framesResult.status === "fulfilled" ? framesResult.value : [];
  const alerts = alertsResult.status === "fulfilled" ? alertsResult.value : { here: [], nearby: [] };
  const probSevere = probSevereResult.status === "fulfilled" ? probSevereResult.value : { storm: null, sourceFile: null };
  const latestFrame = frames[frames.length - 1] ?? null;
  const windGustMph = snapshot ? numberField(snapshot.rawObservation, "windgustmph") : null;
  const hourlyRainIn = snapshot ? numberField(snapshot.rawObservation, "rainratein") ?? numberField(snapshot.rawObservation, "rainrate") ?? numberField(snapshot.rawObservation, "hourlyrainin") : null;
  const pressureInHg = snapshot ? numberField(snapshot.rawObservation, "baromrelin") ?? numberField(snapshot.rawObservation, "baromabsin") : null;
  const pressureTrendInHgPerHr = recordPressure(pressureInHg);
  const radarDbz = latestFrame ? await getRadarPointReflectivity(BRIDGEPORT_LAT, BRIDGEPORT_LON, latestFrame.observedAt) : null;
  const evolution = await assessStormEvolution(BRIDGEPORT_LAT, BRIDGEPORT_LON, frames, radarDbz);
  const assessment = assessThreat({ windGustMph, hourlyRainIn, radarDbz, strongestNearbyDbz: evolution.strongestNearbyDbz, stormTrend: evolution.trend, stormMotion: evolution.motion, pressureTrendInHgPerHr, alertsHere: alerts.here, alertsNearby: alerts.nearby, probSevereStorm: probSevere.storm });
  return Response.json({ assessment, evolution, probSevere, inputs: { windGustMph, hourlyRainIn, radarDbz, strongestNearbyDbz: evolution.strongestNearbyDbz, stormTrend: evolution.trend, stormMotion: evolution.motion, pressureTrendInHgPerHr, stationOnline: snapshot !== null, radarFrameTime: latestFrame?.observedAt ?? null, alertCountHere: alerts.here.length, alertCountNearby: alerts.nearby.length } }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
