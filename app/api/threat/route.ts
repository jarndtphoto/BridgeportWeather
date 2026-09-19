import { getAmbientSnapshot } from "../../../lib/ambient";
import { getRadarFrames, getRadarPointReflectivity, radarWmsUrl, RADAR_LAYER } from "../../../lib/radar";
import { getNwsAlerts } from "../../../lib/nws";
import { getProbSevereNear } from "../../../lib/probsevere";
import { assessThreat } from "../../../lib/threat";
import { assessStormEvolution, type StormEvolution } from "../../../lib/evolution";
import { recordPressure } from "../../../lib/trend";
import { getLocalForecast } from "../../../lib/forecast";
import { getHrrrModelInitUtc, getHrrrPointSample, hrrrForecastMinutesForTime } from "../../../lib/hrrr";
import { PNG } from "pngjs";
export const dynamic = "force-dynamic";
const BRIDGEPORT_LAT = 41.8382, BRIDGEPORT_LON = -87.6331, STATE_CODE = "IL", MERCATOR_RADIUS = 20037508.34;
function numberField(observation: Record<string, unknown>, key: string): number | null { const value = observation[key]; return typeof value === "number" ? value : null; }
function precipText(value:string){const text=value.toLowerCase();return text.includes("rain")||text.includes("shower")||text.includes("thunder")||text.includes("drizzle");}
function toMercator(lat:number,lon:number){const x=lon*MERCATOR_RADIUS/180;const y=(Math.log(Math.tan(((90+lat)*Math.PI)/360))/(Math.PI/180))*(MERCATOR_RADIUS/180);return{x,y};}
function fallbackAnalysisFrames() {
  const stepMs = 5 * 60_000;
  const newestMs = Math.floor((Date.now() - stepMs) / stepMs) * stepMs;
  return Array.from({ length: 13 }, (_, index) => {
    const observedMs = newestMs - (12 - index) * stepMs;
    return {
      observedAt: new Date(observedMs).toISOString(),
      epochSeconds: Math.floor(observedMs / 1000),
      id: String(Math.floor(observedMs / 1000)),
    };
  });
}
async function visibleRadarEchoAtBridgeport(isoTime:string):Promise<boolean|null>{
  const center=toMercator(BRIDGEPORT_LAT,BRIDGEPORT_LON),halfSizeMeters=1200,size=9;
  const url=new URL(radarWmsUrl());
  url.search=new URLSearchParams({service:"WMS",version:"1.1.1",request:"GetMap",layers:RADAR_LAYER,styles:"",format:"image/png",transparent:"true",srs:"EPSG:3857",bbox:[center.x-halfSizeMeters,center.y-halfSizeMeters,center.x+halfSizeMeters,center.y+halfSizeMeters].join(","),width:String(size),height:String(size),time:isoTime}).toString();
  try{
    const response=await fetch(url,{next:{revalidate:60}});if(!response.ok)return null;
    const png=PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    const cx=Math.floor(png.width/2),cy=Math.floor(png.height/2);let visiblePixels=0;
    for(let y=Math.max(0,cy-1);y<=Math.min(png.height-1,cy+1);y++)for(let x=Math.max(0,cx-1);x<=Math.min(png.width-1,cx+1);x++){const alpha=png.data[(y*png.width+x)*4+3];if(alpha>32)visiblePixels++;}
    return visiblePixels>0;
  }catch{return null;}
}
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
  const radarFrameAgeMinutes = latestFrame ? (Date.now() - Date.parse(latestFrame.observedAt)) / 60_000 : Infinity;
  const radarFrameStale = radarFrameAgeMinutes > 10;
  const analysisFrames = radarFrameStale || !latestFrame ? fallbackAnalysisFrames() : frames;
  const analysisLatestFrame = analysisFrames[analysisFrames.length - 1] ?? null;
  const windGustMph = snapshot ? numberField(snapshot.rawObservation, "windgustmph") : null;
  const hourlyRainIn = snapshot ? numberField(snapshot.rawObservation, "rainratein") ?? numberField(snapshot.rawObservation, "rainrate") ?? numberField(snapshot.rawObservation, "hourlyrainin") : null;
  const pressureInHg = snapshot ? numberField(snapshot.rawObservation, "baromrelin") ?? numberField(snapshot.rawObservation, "baromabsin") : null;
  const pressureTrendInHgPerHr = recordPressure(pressureInHg);
  const [rawRadarSample, radarEchoVisible] = analysisLatestFrame
    ? await Promise.all([
        getRadarPointReflectivity(BRIDGEPORT_LAT, BRIDGEPORT_LON, analysisLatestFrame.observedAt),
        radarFrameStale ? Promise.resolve(null) : visibleRadarEchoAtBridgeport(analysisLatestFrame.observedAt),
      ])
    : [null, null];
  // The WMS feature-info value can be a palette/gray index rather than physical dBZ. Only treat it as a local radar signal when the rendered MRMS image actually shows an echo over Bridgeport.
  const radarDbz = radarEchoVisible === false ? null : rawRadarSample;

  // NOAA's point-sampling service can fail independently of the live image
  // service. When both local point checks are unavailable, do not launch the
  // dozens of additional point requests used by storm-evolution analysis.
  // Return a fast, explicit degraded state so the Home banner never hangs.
  let evolution: StormEvolution;
  const radarPointServiceUnavailable = analysisLatestFrame !== null && rawRadarSample === null && radarEchoVisible === null;
  if (radarPointServiceUnavailable) {
    evolution = {
      trend: "unknown",
      motion: "unknown",
      relevance: "unknown",
      headline: "Radar analysis temporarily unavailable",
      detail: "Live radar imagery is still available, but detailed radar analysis is temporarily unavailable.",
      strongestSector: null,
      strongestNearbyDbz: null,
      strongestRadiusMiles: null,
      bridgeportDbz: null,
      previousBridgeportDbz: null,
      sampledRadiusMiles: 12,
      comparisonMinutes: null,
      estimatedArrivalMinutes: null,
      estimatedArrivalWindowMinutes: null,
      closestApproachMiles: null,
      windAssist: false,
      surfaceWindMph: null,
      surfaceWindFromDeg: null,
    };
  } else {
    evolution = await assessStormEvolution(BRIDGEPORT_LAT, BRIDGEPORT_LON, analysisFrames, radarDbz, hourlyRainIn, forecastDry);
  }

  const assessment = assessThreat({ windGustMph, hourlyRainIn, radarDbz, strongestNearbyDbz: evolution.strongestNearbyDbz, stormTrend: evolution.trend, stormMotion: evolution.motion, pressureTrendInHgPerHr, alertsHere: alerts.here, alertsNearby: alerts.nearby, probSevereStorm: probSevere.storm });
  return Response.json({ assessment, evolution, probSevere, forecast: { nearTermDry: forecastDry }, inputs: { windGustMph, hourlyRainIn, radarDbz, radarEchoVisible, strongestNearbyDbz: evolution.strongestNearbyDbz, stormTrend: evolution.trend, stormMotion: evolution.motion, pressureTrendInHgPerHr, stationOnline: snapshot !== null, radarFrameTime: analysisLatestFrame?.observedAt ?? latestFrame?.observedAt ?? null, radarFrameAgeMinutes: Number.isFinite(radarFrameAgeMinutes) ? radarFrameAgeMinutes : null, radarFrameStale, radarAnalysisSource: radarFrameStale ? "IEM-N0Q-FALLBACK" : "NOAA-MRMS", alertCountHere: alerts.here.length, alertCountNearby: alerts.nearby.length } }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
