import type { HourlyForecastPeriod } from "./forecast";
import type { HrrrPointSample } from "./hrrr";

export type ForecastConfidence = "observed" | "high" | "medium" | "low";
export type ForecastConsensus = {
  precipitation: boolean;
  confidence: ForecastConfidence;
  thunder: boolean;
  reason: string;
};

function nwsPrecip(period: HourlyForecastPeriod) {
  const text = period.shortForecast.toLowerCase();
  return text.includes("rain") || text.includes("shower") || text.includes("thunder") || text.includes("drizzle") || text.includes("sleet") || text.includes("snow") || text.includes("freezing");
}
function nwsThunder(period: HourlyForecastPeriod) {
  const text = period.shortForecast.toLowerCase();
  return text.includes("thunder") || text.includes("storm");
}

export function forecastConsensus(period: HourlyForecastPeriod, hrrr: HrrrPointSample | null): ForecastConsensus {
  const nwsSaysPrecip = nwsPrecip(period);
  const pop = period.precipitationChance ?? 0;
  const hrrrSaysPrecip = hrrr?.precipitation === true && hrrr.intensity !== "none";
  const hrrrAvailable = hrrr?.precipitation !== null && hrrr?.intensity !== null;

  if (hrrrSaysPrecip && (nwsSaysPrecip || pop >= 40)) return { precipitation: true, confidence: "high", thunder: nwsThunder(period) && hrrr?.intensity === "strong", reason: "HRRR and NWS both support precipitation" };
  if (hrrrSaysPrecip) return { precipitation: true, confidence: "low", thunder: false, reason: "HRRR shows precipitation but NWS support is limited" };
  if (nwsSaysPrecip && pop >= 50) return { precipitation: true, confidence: "medium", thunder: nwsThunder(period), reason: hrrrAvailable ? "NWS supports precipitation while HRRR is less supportive" : "NWS supports precipitation; HRRR confirmation is unavailable" };
  return { precipitation: false, confidence: hrrrAvailable ? "high" : "medium", thunder: false, reason: "No strong precipitation consensus" };
}
