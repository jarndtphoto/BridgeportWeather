import "server-only";
import { getRadarPointReflectivity, type RadarFrame } from "./radar";

export type StormTrend = "strengthening" | "steady" | "weakening" | "quiet" | "unknown";
export type BridgeportRelevance = "overhead" | "nearby" | "quiet" | "unknown";

export type StormEvolution = {
  trend: StormTrend;
  relevance: BridgeportRelevance;
  headline: string;
  detail: string;
  strongestSector: string | null;
  strongestNearbyDbz: number | null;
  bridgeportDbz: number | null;
  previousBridgeportDbz: number | null;
  sampledRadiusMiles: number;
  comparisonMinutes: number | null;
};

const SAMPLE_RADIUS_MILES = 8;
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

export async function assessStormEvolution(lat: number, lon: number, frames: RadarFrame[], bridgeportDbz: number | null): Promise<StormEvolution> {
  const latest = frames[frames.length - 1] ?? null;
  if (!latest) {
    return { trend: "unknown", relevance: "unknown", headline: "Storm evolution unavailable", detail: "Recent radar frames are unavailable.", strongestSector: null, strongestNearbyDbz: null, bridgeportDbz, previousBridgeportDbz: null, sampledRadiusMiles: SAMPLE_RADIUS_MILES, comparisonMinutes: null };
  }

  const samples = await Promise.all(DIRECTIONS.map(async (direction) => {
    const point = destinationPoint(lat, lon, direction.bearing, SAMPLE_RADIUS_MILES);
    const dbz = await getRadarPointReflectivity(point.lat, point.lon, latest.observedAt);
    return { ...direction, ...point, dbz };
  }));

  const valid = samples.filter((sample): sample is typeof sample & { dbz: number } => sample.dbz !== null && Number.isFinite(sample.dbz));
  const strongest = valid.reduce<(typeof valid)[number] | null>((best, sample) => !best || sample.dbz > best.dbz ? sample : best, null);
  const prior = previousFrame(frames, latest);
  const [previousStrongestDbz, previousBridgeportDbz] = prior
    ? await Promise.all([
        strongest ? getRadarPointReflectivity(strongest.lat, strongest.lon, prior.observedAt) : Promise.resolve(null),
        getRadarPointReflectivity(lat, lon, prior.observedAt),
      ])
    : [null, null];

  const strongestNearbyDbz = strongest?.dbz ?? null;
  const nearbyTrend = trendFromChange(strongestNearbyDbz, previousStrongestDbz);
  const localTrend = trendFromChange(bridgeportDbz, previousBridgeportDbz);
  const trend = bridgeportDbz !== null && bridgeportDbz >= 20 ? localTrend : nearbyTrend;

  let relevance: BridgeportRelevance = "quiet";
  let headline = "No significant storm core near Bridgeport";
  let detail = "Radar sampling shows no significant echo over Bridgeport or at the nearby 8-mile ring.";

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
    headline = `Nearby storm core ${strongest.label} of Bridgeport · ${trend}`;
    detail = `The strongest sampled echo about ${SAMPLE_RADIUS_MILES} miles ${strongest.label} of Bridgeport is ${strongestNearbyDbz?.toFixed(0)} dBZ. Its sampled intensity is ${trend}; reflectivity alone does not confirm that it is moving toward Bridgeport.`;
  } else if (trend === "strengthening" || trend === "weakening") {
    headline = `Nearby echoes are ${trend}`;
    detail = `Nearby radar samples are ${trend}, but no significant core is currently over or immediately near Bridgeport.`;
  }

  return {
    trend,
    relevance,
    headline,
    detail,
    strongestSector: strongest?.label ?? null,
    strongestNearbyDbz,
    bridgeportDbz,
    previousBridgeportDbz,
    sampledRadiusMiles: SAMPLE_RADIUS_MILES,
    comparisonMinutes: prior ? Math.round((latest.epochSeconds - prior.epochSeconds) / 60) : null,
  };
}
