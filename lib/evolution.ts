import "server-only";
import { getRadarPointReflectivity, type RadarFrame } from "./radar";

export type StormTrend = "strengthening" | "steady" | "weakening" | "quiet" | "unknown";
export type StormMotion = "approaching" | "movingAway" | "passingNearby" | "stationaryOrUnclear" | "unknown";
export type BridgeportRelevance = "overhead" | "nearby" | "quiet" | "unknown";

export type StormEvolution = {
  trend: StormTrend;
  motion: StormMotion;
  relevance: BridgeportRelevance;
  headline: string;
  detail: string;
  strongestSector: string | null;
  strongestNearbyDbz: number | null;
  strongestRadiusMiles: number | null;
  bridgeportDbz: number | null;
  previousBridgeportDbz: number | null;
  sampledRadiusMiles: number;
  comparisonMinutes: number | null;
};

const INNER_RADIUS_MILES = 4;
const OUTER_RADIUS_MILES = 8;
const SAMPLE_RADIUS_MILES = OUTER_RADIUS_MILES;
const DIRECTIONS = [
  { label: "N", bearing: 0 },
  { label: "NE", bearing: 45 },
  { label: "E", bearing: 90 },
  { label: "SE", bearing: 135 },
  { label: "S", bearing: 180 },
  { label: "SW", bearing: 225 },
  { label: "W", bearing: 270 },
  { label: "NW", bearing: 315 },
] as const;

function destinationPoint(lat: number, lon: number, bearingDeg: number, miles: number) {
  const earthRadiusMiles = 3958.8;
  const angularDistance = miles / earthRadiusMiles;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

function previousFrame(frames: RadarFrame[], latest: RadarFrame): RadarFrame | null {
  const target = latest.epochSeconds - 10 * 60;
  let best: RadarFrame | null = null;
  let bestDelta = Infinity;
  for (const frame of frames) {
    if (frame.epochSeconds >= latest.epochSeconds) continue;
    const delta = Math.abs(frame.epochSeconds - target);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

function trendFromChange(latest: number | null, previous: number | null): StormTrend {
  if (latest === null || previous === null) return "unknown";
  if (latest < 20 && previous < 20) return "quiet";
  const change = latest - previous;
  if (change >= 5) return "strengthening";
  if (change <= -5) return "weakening";
  return "steady";
}

function motionFromRadialShift(currentInner: number | null, currentOuter: number | null, previousInner: number | null, previousOuter: number | null): StormMotion {
  if ([currentInner, currentOuter, previousInner, previousOuter].some((value) => value === null)) return "unknown";
  const ci = currentInner as number;
  const co = currentOuter as number;
  const pi = previousInner as number;
  const po = previousOuter as number;
  const currentSignificant = Math.max(ci, co) >= 30;
  const previousSignificant = Math.max(pi, po) >= 30;
  if (!currentSignificant && !previousSignificant) return "stationaryOrUnclear";

  const innerChange = ci - pi;
  const outerChange = co - po;
  const inwardShift = innerChange >= 7 && ci >= 25 && innerChange >= outerChange + 5;
  const outwardShift = outerChange >= 7 && co >= 25 && outerChange >= innerChange + 5;

  if (inwardShift) return "approaching";
  if (outwardShift) return "movingAway";
  if (ci >= 30 || co >= 30) return "passingNearby";
  return "stationaryOrUnclear";
}

function motionPhrase(motion: StormMotion) {
  if (motion === "approaching") return "appears to be approaching Bridgeport";
  if (motion === "movingAway") return "appears to be moving away from Bridgeport";
  if (motion === "passingNearby") return "is passing nearby; approach is not confirmed";
  if (motion === "stationaryOrUnclear") return "has no clear toward/away motion signal";
  return "motion is uncertain";
}

export async function assessStormEvolution(lat: number, lon: number, frames: RadarFrame[], bridgeportDbz: number | null): Promise<StormEvolution> {
  const latest = frames[frames.length - 1] ?? null;
  if (!latest) {
    return { trend: "unknown", motion: "unknown", relevance: "unknown", headline: "Storm evolution unavailable", detail: "Recent radar frames are unavailable.", strongestSector: null, strongestNearbyDbz: null, strongestRadiusMiles: null, bridgeportDbz, previousBridgeportDbz: null, sampledRadiusMiles: SAMPLE_RADIUS_MILES, comparisonMinutes: null };
  }

  const samples = await Promise.all(DIRECTIONS.flatMap((direction) => [INNER_RADIUS_MILES, OUTER_RADIUS_MILES].map(async (radiusMiles) => {
    const point = destinationPoint(lat, lon, direction.bearing, radiusMiles);
    const dbz = await getRadarPointReflectivity(point.lat, point.lon, latest.observedAt);
    return { ...direction, ...point, radiusMiles, dbz };
  })));

  const valid = samples.filter((sample): sample is typeof sample & { dbz: number } => sample.dbz !== null && Number.isFinite(sample.dbz));
  const strongest = valid.reduce<(typeof valid)[number] | null>((best, sample) => !best || sample.dbz > best.dbz ? sample : best, null);
  const prior = previousFrame(frames, latest);
  const sectorSamples = strongest ? samples.filter((sample) => sample.label === strongest.label) : [];
  const currentInner = sectorSamples.find((sample) => sample.radiusMiles === INNER_RADIUS_MILES)?.dbz ?? null;
  const currentOuter = sectorSamples.find((sample) => sample.radiusMiles === OUTER_RADIUS_MILES)?.dbz ?? null;

  const [previousInner, previousOuter, previousBridgeportDbz] = prior && strongest
    ? await Promise.all([
        getRadarPointReflectivity(destinationPoint(lat, lon, strongest.bearing, INNER_RADIUS_MILES).lat, destinationPoint(lat, lon, strongest.bearing, INNER_RADIUS_MILES).lon, prior.observedAt),
        getRadarPointReflectivity(destinationPoint(lat, lon, strongest.bearing, OUTER_RADIUS_MILES).lat, destinationPoint(lat, lon, strongest.bearing, OUTER_RADIUS_MILES).lon, prior.observedAt),
        getRadarPointReflectivity(lat, lon, prior.observedAt),
      ])
    : [null, null, prior ? await getRadarPointReflectivity(lat, lon, prior.observedAt) : null];

  const strongestNearbyDbz = strongest?.dbz ?? null;
  const previousStrongestDbz = strongest?.radiusMiles === INNER_RADIUS_MILES ? previousInner : previousOuter;
  const nearbyTrend = trendFromChange(strongestNearbyDbz, previousStrongestDbz);
  const localTrend = trendFromChange(bridgeportDbz, previousBridgeportDbz);
  const trend = bridgeportDbz !== null && bridgeportDbz >= 20 ? localTrend : nearbyTrend;
  const motion = strongest && prior ? motionFromRadialShift(currentInner, currentOuter, previousInner, previousOuter) : "unknown";

  let relevance: BridgeportRelevance = "quiet";
  let headline = "No significant storm core near Bridgeport";
  let detail = "Radar sampling shows no significant echo over Bridgeport or on the nearby 4- and 8-mile rings.";

  if (bridgeportDbz === null && strongestNearbyDbz === null) {
    relevance = "unknown";
    headline = "Bridgeport radar relevance unavailable";
    detail = "Radar point sampling is unavailable right now.";
  } else if ((bridgeportDbz ?? 0) >= 35) {
    relevance = "overhead";
    headline = `Strong echo over Bridgeport · ${trend}`;
    detail = `Reflectivity at Bridgeport is ${bridgeportDbz?.toFixed(0)} dBZ. Recent radar samples suggest the local echo is ${trend}.`;
  } else if ((strongestNearbyDbz ?? 0) >= 30 && strongest) {
    relevance = "nearby";
    const motionLabel = motion === "approaching" ? "approaching" : motion === "movingAway" ? "moving away" : "nearby";
    headline = `Storm core ${strongest.label} of Bridgeport · ${motionLabel}`;
    detail = `The strongest sampled echo is about ${strongest.radiusMiles} miles ${strongest.label} of Bridgeport at ${strongestNearbyDbz?.toFixed(0)} dBZ. Its intensity is ${trend}, and the 4-/8-mile ring changes ${motionPhrase(motion)}. This is a radar-based motion cue, not a track or arrival-time forecast.`;
  } else if (trend === "strengthening" || trend === "weakening") {
    headline = `Nearby echoes are ${trend}`;
    detail = `Nearby radar samples are ${trend}, but no significant core is currently over or immediately near Bridgeport.`;
  }

  return {
    trend,
    motion,
    relevance,
    headline,
    detail,
    strongestSector: strongest?.label ?? null,
    strongestNearbyDbz,
    strongestRadiusMiles: strongest?.radiusMiles ?? null,
    bridgeportDbz,
    previousBridgeportDbz,
    sampledRadiusMiles: SAMPLE_RADIUS_MILES,
    comparisonMinutes: prior ? Math.round((latest.epochSeconds - prior.epochSeconds) / 60) : null,
  };
}
