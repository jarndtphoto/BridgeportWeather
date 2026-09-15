import "server-only";

const DIRECTORY_URL = "https://mrms.ncep.noaa.gov/ProbSevere/PROBSEVERE/";

export type ProbSevereStorm = {
  id: string | null;
  observedAt: string | null;
  distanceMiles: number;
  probSevere: number | null;
  probHail: number | null;
  probWind: number | null;
  probTor: number | null;
};

export type ProbSevereSnapshot = {
  storm: ProbSevereStorm | null;
  sourceFile: string | null;
};

type GeoFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  models?: Record<string, { PROB?: unknown }>;
};

type FeatureCollection = { features?: GeoFeature[] };

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/%/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function propertyNumber(feature: GeoFeature, property: string, model: string): number | null {
  const direct = numberValue(feature.properties?.[property]);
  if (direct !== null) return direct;
  return numberValue(feature.models?.[model]?.PROB);
}

function featureCenter(feature: GeoFeature): { lat: number; lon: number } | null {
  const lat = numberValue(feature.properties?.MLAT);
  const lon = numberValue(feature.properties?.MLON);
  if (lat !== null && lon !== null) return { lat, lon };

  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const points: Array<[number, number]> = [];
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push([value[0], value[1]]);
      return;
    }
    for (const child of value) collect(child);
  };
  collect(coordinates);
  if (!points.length) return null;
  const sum = points.reduce((acc, [x, y]) => ({ lon: acc.lon + x, lat: acc.lat + y }), { lon: 0, lat: 0 });
  return { lat: sum.lat / points.length, lon: sum.lon / points.length };
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 3958.8;
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

async function latestFile(): Promise<string | null> {
  try {
    const response = await fetch(`${DIRECTORY_URL}?C=M;O=D`, { next: { revalidate: 90 } });
    if (!response.ok) return null;
    const html = await response.text();
    const files = Array.from(html.matchAll(/MRMS_PROBSEVERE_(\d{8}_\d{6})\.json/g), match => match[0]);
    if (!files.length) return null;
    return [...new Set(files)].sort().at(-1) ?? null;
  } catch {
    return null;
  }
}

function observedAtFromFilename(file: string): string | null {
  const match = file.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
}

export async function getProbSevereNear(lat: number, lon: number, radiusMiles = 30): Promise<ProbSevereSnapshot> {
  const file = await latestFile();
  if (!file) return { storm: null, sourceFile: null };
  try {
    const response = await fetch(`${DIRECTORY_URL}${file}`, { next: { revalidate: 90 } });
    if (!response.ok) return { storm: null, sourceFile: file };
    const payload = await response.json() as FeatureCollection;
    const observedAt = observedAtFromFilename(file);
    const candidates = (payload.features ?? []).flatMap((feature): ProbSevereStorm[] => {
      const center = featureCenter(feature);
      if (!center) return [];
      const distance = distanceMiles(lat, lon, center.lat, center.lon);
      if (distance > radiusMiles) return [];
      return [{
        id: typeof feature.properties?.ID === "string" || typeof feature.properties?.ID === "number" ? String(feature.properties.ID) : null,
        observedAt,
        distanceMiles: distance,
        probSevere: propertyNumber(feature, "ProbSevere", "probsevere"),
        probHail: propertyNumber(feature, "ProbHail", "probhail"),
        probWind: propertyNumber(feature, "ProbWind", "probwind"),
        probTor: propertyNumber(feature, "ProbTor", "probtor"),
      }];
    });
    const storm = candidates.sort((a, b) => (b.probSevere ?? -1) - (a.probSevere ?? -1) || a.distanceMiles - b.distanceMiles)[0] ?? null;
    return { storm, sourceFile: file };
  } catch {
    return { storm: null, sourceFile: file };
  }
}
