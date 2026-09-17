import "server-only";

const AMBIENT_DEVICES_URL = "https://rt.ambientweather.net/v1/devices";
const WIND_DIRECTION_OFFSET_DEGREES = 180;

type JsonScalar = string | number | boolean | null;
export type RawObservation = Record<string, JsonScalar>;

type AmbientDevice = { info?: { name?: unknown; location?: unknown }; lastData?: unknown };

export type AmbientSnapshot = {
  station: { name: string; location: string };
  observedAt: string | null;
  rawObservation: RawObservation;
};

export class AmbientWeatherError extends Error {
  constructor(
    public readonly code: "configuration" | "authentication" | "rate_limit" | "upstream" | "no_station" | "invalid_data",
    message: string,
  ) {
    super(message);
    this.name = "AmbientWeatherError";
  }
}

function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeObservation(value: unknown): RawObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AmbientWeatherError("invalid_data", "Ambient Weather returned an invalid latest observation.");
  }

  return Object.fromEntries(Object.entries(value).filter(([key, fieldValue]) => {
    const normalizedKey = key.toLowerCase();
    const isSensitive = ["key", "secret", "token", "authorization"].some((word) => normalizedKey.includes(word));
    const isScalar = fieldValue === null || ["string", "number", "boolean"].includes(typeof fieldValue);
    return !isSensitive && isScalar;
  })) as RawObservation;
}

function correctWindDirection(observation: RawObservation) {
  const value = observation.winddir;
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  observation.winddir = (value + WIND_DIRECTION_OFFSET_DEGREES) % 360;
}

function observationDate(observation: RawObservation) {
  if (typeof observation.date === "string") return observation.date;
  if (typeof observation.dateutc === "number") return new Date(observation.dateutc).toISOString();
  return null;
}

export async function getAmbientSnapshot(): Promise<AmbientSnapshot> {
  const apiKey = process.env.AMBIENT_API_KEY;
  const applicationKey = process.env.AMBIENT_APPLICATION_KEY;
  if (!apiKey || !applicationKey) {
    throw new AmbientWeatherError("configuration", "Live station data is not configured.");
  }

  const url = new URL(AMBIENT_DEVICES_URL);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("applicationKey", applicationKey);

  let response: Response;
  try {
    response = await fetch(url, { next: { revalidate: 60 } });
  } catch {
    throw new AmbientWeatherError("upstream", "Ambient Weather is temporarily unreachable.");
  }

  if (response.status === 401 || response.status === 403) throw new AmbientWeatherError("authentication", "Ambient Weather rejected the server credentials.");
  if (response.status === 429) throw new AmbientWeatherError("rate_limit", "Ambient Weather is temporarily rate limiting requests.");
  if (!response.ok) throw new AmbientWeatherError("upstream", "Ambient Weather returned an unavailable response.");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AmbientWeatherError("invalid_data", "Ambient Weather returned unreadable station data.");
  }

  if (!Array.isArray(payload) || payload.length === 0) throw new AmbientWeatherError("no_station", "No Ambient Weather station was found for this account.");
  const device = payload.find((item): item is AmbientDevice => Boolean(item && typeof item === "object" && "lastData" in item));
  if (!device) throw new AmbientWeatherError("no_station", "No station with a latest observation was found.");

  const rawObservation = sanitizeObservation(device.lastData);
  correctWindDirection(rawObservation);
  return {
    station: {
      name: safeText(device.info?.name, "Bridgeport weather station"),
      location: safeText(device.info?.location, "Bridgeport, Chicago"),
    },
    observedAt: observationDate(rawObservation),
    rawObservation,
  };
}
