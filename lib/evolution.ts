import "server-only";
import { getRadarPointReflectivity, type RadarFrame } from "./radar";

export type StormTrend = "strengthening" | "steady" | "weakening" | "quiet" | "unknown";
export type StormMotion = "approaching" | "movingAway" | "passingNearby" | "stationaryOrUnclear" | "unknown";
export type BridgeportRelevance = "overhead" | "nearby" | "quiet" | "unknown";
export type StormEvolution = { trend:StormTrend; motion:StormMotion; relevance:BridgeportRelevance; headline:string; detail:string; strongestSector:string|null; strongestNearbyDbz:number|null; strongestRadiusMiles:number|null; bridgeportDbz:number|null; previousBridgeportDbz:number|null; sampledRadiusMiles:number; comparisonMinutes:number|null; estimatedArrivalMinutes:number|null; estimatedArrivalWindowMinutes:[number,number]|null; closestApproachMiles:number|null };

const RADII_MILES=[3,6,9,12] as const;
const INNER_RADIUS_MILES=3, OUTER_RADIUS_MILES=9, SAMPLE_RADIUS_MILES=12;
const WEAK_ECHO_DBZ=5, RAIN_ECHO_DBZ=10;
const DIRECTIONS=[
  {label:"N",bearing:0},{label:"NE",bearing:45},{label:"E",bearing:90},{label:"SE",bearing:135},
  {label:"S",bearing:180},{label:"SW",bearing:225},{label:"W",bearing:270},{label:"NW",bearing:315},
] as const;

type Sample={label:(typeof DIRECTIONS)[number]["label"];bearing:number;lat:number;lon:number;radiusMiles:number;dbz:number|null};

function destinationPoint(lat:number,lon:number,bearingDeg:number,miles:number){const r=3958.8,a=miles/r,b=bearingDeg*Math.PI/180,lat1=lat*Math.PI/180,lon1=lon*Math.PI/180;const lat2=Math.asin(Math.sin(lat1)*Math.cos(a)+Math.cos(lat1)*Math.sin(a)*Math.cos(b));const lon2=lon1+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(lat1),Math.cos(a)-Math.sin(lat1)*Math.sin(lat2));return{lat:lat2*180/Math.PI,lon:lon2*180/Math.PI}}
function previousFrame(frames:RadarFrame[],latest:RadarFrame){const target=latest.epochSeconds-600;let best:RadarFrame|null=null,bestDelta=Infinity;for(const frame of frames){if(frame.epochSeconds>=latest.epochSeconds)continue;const delta=Math.abs(frame.epochSeconds-target);if(delta<bestDelta){best=frame;bestDelta=delta}}return best}
function trendFromChange(latest:number|null,previous:number|null):StormTrend{if(latest===null||previous===null)return"unknown";if(latest<20&&previous<20)return"quiet";const change=latest-previous;if(change>=5)return"strengthening";if(change<=-5)return"weakening";return"steady"}
function motionFromRadialShift(ci0:number|null,co0:number|null,pi0:number|null,po0:number|null):StormMotion{if([ci0,co0,pi0,po0].some(v=>v===null))return"unknown";const ci=ci0 as number,co=co0 as number,pi=pi0 as number,po=po0 as number;if(Math.max(ci,co)<20&&Math.max(pi,po)<20)return"stationaryOrUnclear";const innerChange=ci-pi,outerChange=co-po;if(innerChange>=4&&ci>=10&&innerChange>=outerChange+3)return"approaching";if(outerChange>=4&&co>=10&&outerChange>=innerChange+3)return"movingAway";if(ci>=10||co>=10)return"passingNearby";return"stationaryOrUnclear"}
function weightedRadius(samples:Sample[]){let total=0,weighted=0;for(const sample of samples){if(sample.dbz===null||!Number.isFinite(sample.dbz)||sample.dbz<WEAK_ECHO_DBZ)continue;const weight=Math.max(1,sample.dbz-WEAK_ECHO_DBZ+1);total+=weight;weighted+=sample.radiusMiles*weight}return total>0?weighted/total:null}
function motionFromFieldShift(current:Sample[],previous:Sample[]):StormMotion{const currentRadius=weightedRadius(current),previousRadius=weightedRadius(previous);if(currentRadius===null||previousRadius===null)return"unknown";const shift=previousRadius-currentRadius;if(shift>=.8)return"approaching";if(shift<=-.8)return"movingAway";return"stationaryOrUnclear"}
function arrivalEstimate(motion:StormMotion,radius:number|null,minutes:number|null){if(radius===null)return{estimatedArrivalMinutes:null,estimatedArrivalWindowMinutes:null as [number,number]|null,closestApproachMiles:null};if(motion==="approaching"&&minutes&&minutes>0){const mph=((OUTER_RADIUS_MILES-INNER_RADIUS_MILES)/minutes)*60;if(mph>=8&&mph<=60){const estimate=Math.round(radius/mph*60),margin=Math.max(5,Math.round(estimate*.6));return{estimatedArrivalMinutes:estimate,estimatedArrivalWindowMinutes:[Math.max(0,estimate-margin),estimate+margin] as [number,number],closestApproachMiles:0}}}if(motion==="passingNearby"||motion==="movingAway")return{estimatedArrivalMinutes:null,estimatedArrivalWindowMinutes:null as [number,number]|null,closestApproachMiles:radius};return{estimatedArrivalMinutes:null,estimatedArrivalWindowMinutes:null as [number,number]|null,closestApproachMiles:null}}
function directionWords(label:string){return({N:"north",NE:"northeast",E:"east",SE:"southeast",S:"south",SW:"southwest",W:"west",NW:"northwest"} as Record<string,string>)[label]??label}
function precipitationLabel(radarDbz:number,stationRainIn:number|null){if((stationRainIn??0)>=1)return"Heavy rain";if((stationRainIn??0)>=.1)return"Rain";if(radarDbz>=RAIN_ECHO_DBZ)return"Rain";return"Light precipitation"}

export async function assessStormEvolution(lat:number,lon:number,frames:RadarFrame[],bridgeportDbz:number|null,stationRainIn:number|null=null,nearTermForecastDry:boolean|null=null):Promise<StormEvolution>{
 const latest=frames[frames.length-1]??null;if(!latest)return{trend:"unknown",motion:"unknown",relevance:"unknown",headline:"Radar information unavailable",detail:"Recent radar information is unavailable.",strongestSector:null,strongestNearbyDbz:null,strongestRadiusMiles:null,bridgeportDbz,previousBridgeportDbz:null,sampledRadiusMiles:SAMPLE_RADIUS_MILES,comparisonMinutes:null,estimatedArrivalMinutes:null,estimatedArrivalWindowMinutes:null,closestApproachMiles:null};

 const samples:Sample[]=await Promise.all(DIRECTIONS.flatMap(direction=>RADII_MILES.map(async radiusMiles=>{const point=destinationPoint(lat,lon,direction.bearing,radiusMiles);const dbz=await getRadarPointReflectivity(point.lat,point.lon,latest.observedAt);return{...direction,...point,radiusMiles,dbz}})));
 const valid=samples.filter((s):s is Sample&{dbz:number}=>s.dbz!==null&&Number.isFinite(s.dbz));
 const strongest=valid.reduce<(typeof valid)[number]|null>((best,s)=>!best||s.dbz>best.dbz?s:best,null);
 const prior=previousFrame(frames,latest);
 const activeLabels=new Set(samples.filter(s=>(s.dbz??-Infinity)>=WEAK_ECHO_DBZ).map(s=>s.label));
 const previousSamples:Sample[]=prior?await Promise.all(samples.filter(s=>activeLabels.has(s.label)).map(async s=>({...s,dbz:await getRadarPointReflectivity(s.lat,s.lon,prior.observedAt)}))):[];
 const sector=strongest?samples.filter(s=>s.label===strongest.label):[];
 const previousSector=strongest?previousSamples.filter(s=>s.label===strongest.label):[];
 const currentInner=sector.find(s=>s.radiusMiles===INNER_RADIUS_MILES)?.dbz??null,currentOuter=sector.find(s=>s.radiusMiles===OUTER_RADIUS_MILES)?.dbz??null;
 const previousInner=previousSector.find(s=>s.radiusMiles===INNER_RADIUS_MILES)?.dbz??null,previousOuter=previousSector.find(s=>s.radiusMiles===OUTER_RADIUS_MILES)?.dbz??null;
 const previousBridgeportDbz=prior?await getRadarPointReflectivity(lat,lon,prior.observedAt):null;
 const previousStrongestDbz=strongest?previousSector.find(s=>s.radiusMiles===strongest.radiusMiles)?.dbz??null:null;
 const strongestNearbyDbz=strongest?.dbz??null;
 const nearbyTrend=trendFromChange(strongestNearbyDbz,previousStrongestDbz),localTrend=trendFromChange(bridgeportDbz,previousBridgeportDbz),trend=bridgeportDbz!==null&&bridgeportDbz>=20?localTrend:nearbyTrend;

 const fieldMotion=prior?motionFromFieldShift(samples,previousSamples):"unknown";
 const sectorMotion=strongest&&prior?motionFromRadialShift(currentInner,currentOuter,previousInner,previousOuter):"unknown";
 const rawMotion:StormMotion=fieldMotion!=="unknown"&&fieldMotion!=="stationaryOrUnclear"?fieldMotion:sectorMotion;
 const localDry=(bridgeportDbz??0)<RAIN_ECHO_DBZ&&(stationRainIn??0)<=.01;
 // Forecast guidance is only a tie-breaker when live radar cannot resolve motion.
 const forecastSupportsDeparture=localDry&&nearTermForecastDry===true&&(strongestNearbyDbz??0)>=RAIN_ECHO_DBZ&&(rawMotion==="unknown"||rawMotion==="stationaryOrUnclear");
 const motion:StormMotion=forecastSupportsDeparture?"movingAway":rawMotion;
 const comparisonMinutes=prior?Math.round((latest.epochSeconds-prior.epochSeconds)/60):null,estimate=arrivalEstimate(motion,strongest?.radiusMiles??null,comparisonMinutes);

 let relevance:BridgeportRelevance="quiet",headline="No significant precipitation near Bridgeport",detail="Radar is mostly quiet around Bridgeport.";
 if(bridgeportDbz===null&&strongestNearbyDbz===null){relevance="unknown";headline="Radar information unavailable";detail="Radar information is unavailable right now."}
 else if((bridgeportDbz??0)>=WEAK_ECHO_DBZ){relevance="overhead";const label=precipitationLabel(bridgeportDbz??0,stationRainIn);headline=`${label} over Bridgeport`;const stationText=(stationRainIn??0)>.01?"The local station is also measuring rain.":"The local station may not detect drizzle or light rain.";detail=`Radar shows precipitation over Bridgeport. ${stationText}`}
 else if((strongestNearbyDbz??0)>=WEAK_ECHO_DBZ&&strongest){relevance="nearby";const where=directionWords(strongest.label);const weak=(strongestNearbyDbz??0)<RAIN_ECHO_DBZ;headline=`${weak?"Light precipitation":"Rain"} ${where} of Bridgeport`;
   if(motion==="movingAway"){headline+=` moving away`;detail=forecastSupportsDeparture?`Radar is clear over Bridgeport and forecast guidance suggests the nearby precipitation is departing.`:`Live radar shows precipitation ${where} of Bridgeport moving away from our area.`}
   else if(motion==="approaching"){headline+=` moving toward us`;detail=`Live radar shows ${weak?"light precipitation":"rain"} ${where} of Bridgeport moving toward our area.`}
   else{detail=`Radar shows ${weak?"light precipitation":"rain"} ${where} of Bridgeport within about ${SAMPLE_RADIUS_MILES} miles.`}}
 return{trend,motion,relevance,headline,detail,strongestSector:strongest?.label??null,strongestNearbyDbz,strongestRadiusMiles:strongest?.radiusMiles??null,bridgeportDbz,previousBridgeportDbz,sampledRadiusMiles:SAMPLE_RADIUS_MILES,comparisonMinutes,estimatedArrivalMinutes:estimate.estimatedArrivalMinutes,estimatedArrivalWindowMinutes:estimate.estimatedArrivalWindowMinutes,closestApproachMiles:estimate.closestApproachMiles};
}
