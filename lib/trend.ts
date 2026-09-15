import "server-only";

type PressureSample = { atMs: number; inHg: number };

// Module-scope state persists only for the life of a warm serverless instance.
// This is a deliberate stopgap: good enough to catch a pressure drop during one
// active storm, but it resets on cold starts/redeploys and isn't a real history
// store. Replace with persistent storage when trend tracking becomes its own feature.
const HISTORY_WINDOW_MS = 60 * 60 * 1000; // keep up to 1 hour of samples
const MIN_SPAN_MS = 8 * 60 * 1000; // require at least 8 minutes of spread before trusting a trend

let pressureHistory: PressureSample[] = [];

export function recordPressure(inHg: number | null, atMs: number = Date.now()): number | null {
  if (inHg === null || !Number.isFinite(inHg)) return getPressureTrend(atMs);

  pressureHistory.push({ atMs, inHg });
  pressureHistory = pressureHistory.filter((sample) => atMs - sample.atMs <= HISTORY_WINDOW_MS);

  return getPressureTrend(atMs);
}

/** Returns inHg/hr change over the retained window, or null if there isn't enough history yet. */
export function getPressureTrend(atMs: number = Date.now()): number | null {
  if (pressureHistory.length < 2) return null;

  const oldest = pressureHistory[0];
  const newest = pressureHistory[pressureHistory.length - 1];
  const spanMs = newest.atMs - oldest.atMs;
  if (spanMs < MIN_SPAN_MS) return null;

  const spanHours = spanMs / (60 * 60 * 1000);
  return (newest.inHg - oldest.inHg) / spanHours;
}
