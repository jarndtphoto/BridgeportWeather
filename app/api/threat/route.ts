import { getAmbientSnapshot } from "../../../lib/ambient";
import { getRadarFrames, getRadarPointReflectivity } from "../../../lib/radar";
import { getNwsAlerts } from "../../../lib/nws";
import { getProbSevereNear } from "../../../lib/probsevere";
import { assessThreat } from "../../../lib/threat";
import { assessStormEvolution } from "../../../lib/evolution";
import { recordPressure } from "../../../lib/trend";
import { getLocalForecast } from "../../../lib/forecast";
import { getHrrrModelInitUtc, getHrrrPointSample, hrrrForecastMinutesForTime } from "../../../lib/hrrr";
export const dynamic = "force-dynamic";
const BRIDGEPORT_LAT = 41.8382, BRIDGEPORT_LON = -87.6331, STATE_CODE = "IL";
function numberField(observation: Record<string, unknown>, key: string): number | null { const value = observation[key]; return typeof value === "number" ? value : null; }
function precipText(value:string){const text=value.toLowerCase();return text.includes("rain")||text.includes("shower")||text.includes("thunder")||text.includes("drizzle");}
// Treat the next two hours as dry only when HRRR stays dry and NWS does not show likely precipitation.
async function nearTermForecastDry(){
  const [forecastResult,hrrrMetaResult]=await Promise.allSettled([getLocalForecast(BRIDGEPORT_LAT,BRIDGEPORT_LON),getHrrrModelInitUtc()]);
  if(forecastResult.status!=="fulfilled"||hrrrMetaResult.status!=="fulfilled"||!hrrrMetaResult.value)return null;
  const now=Date.now();
  const periods=forecastResult.value.hourly.filter(period=>Date.parse(period.startTime)+3_600_000>now).slice(0,3);
  if(periods.length<2)return null;
  const samples=await Promise.all(periods.slice(0,2).map(async period=>{
    const minutes=hrrrForecastMinutesForTime(period.startTime,hrrrMetaResult.value);
    return minutes===null?null:getHrrrPointSample(BRIDGEPORT_LAT,BRIDGEPORT_LON,minutes);
  }));
  if(samples.some(sample=>sample===null||sample.precipitation===null))return null;
  const hrrrWet=samples.some(sample=>sample?.precipitation===true);
  const nwsLikelyWet=periods.slice(0,2).some(period=>precipText(period.shortForecast)&&(period.precipitationChance??0)>=50);
  return !hrrrWet&&!nwsLikelyWet;
}
export async function GET() {
  const [ambientResult, framesResult, alertsResult, probSevereResult, forecastDryResult] = await Promise.allSettled([
    getAmbientSnapshot(), getRadarFrames(), getNwsAlerts(BRIDGEPORT_LAT, BRIDGEPORT_LON, STATE_CODE), getProbSevereNear(BRIDGEPORT_LAT, BRIDGEPORT_LON), nearTermForecastDry(),
  ]);
  const snapshot = ambientResult.status === "fulfilled" ? ambientResult.value : null;
  const frames = framesResult.status === "fulfilled" ? framesResult.value : [];
  const alerts = alertsResult.status === "fulfilled" ? alertsResult.value : { here: [], nearby: [] };
  const probSevere = probSevereResult.status === "fulfilled" ? probSevereResult.value : { storm: null, sourceFile: null };
  const forecastDry = forecastDryResult.status === "fulfilled" ? forecastDryResult.value : null;
  const latestFrame = frames[frames.length - 1] ?? null;
  const windGustMph = snapshot ? numberField(snapshot.rawObservation, "windgustmph") : null;
  const hourlyRainIn = snapshot ? numberField(snapshot.rawObservation, "rainratein") ?? numberField(snapshot.rawObservation, "rainrate") ?? numberField(snapshot.rawObservation, "hourlyrainin") : null;
  const pressureInHg = snapshot ? numberField(snapshot.rawObservation, "baromrelin") ?? numberField(snapshot.rawObservation, "baromabsin") : null;
  const pressureTrendInHgPerHr = recordPressure(pressureInHg);
  const radarDbz = latestFrame ? await getRadarPointReflectivity(BRIDGEPORT_LAT, BRIDGEPORT_LON, latestFrame.observedAt) : null;
  const evolution = await assessStormEvolution(BRIDGEPORT_LAT, BRIDGEPORT_LON, frames, radarDbz, hourlyRainIn, forecastDry);
  const assessment = assessThreat({ windGustMph, hourlyRainIn, radarDbz, strongestNearbyDbz: evolution.strongestNearbyDbz, stormTrend: evolution.trend, stormMotion: evolution.motion, pressureTrendInHgPerHr, alertsHere: alerts.here, alertsNearby: alerts.nearby, probSevereStorm: probSevere.storm });
  return Response.json({ assessment, evolution, probSevere, forecast: { nearTermDry: forecastDry }, inputs: { windGustMph, hourlyRainIn, radarDbz, strongestNearbyDbz: evolution.strongestNearbyDbz, stormTrend: evolution.trend, stormMotion: evolution.motion, pressureTrendInHgPerHr, stationOnline: snapshot !== null, radarFrameTime: latestFrame?.observedAt ?? null, alertCountHere: alerts.here.length, alertCountNearby: alerts.nearby.length } }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
