export type ThreatLevel = "none" | "monitor" | "elevated" | "severe";
export type ThreatCategory = "wind" | "hail" | "heavyRain" | "rotation";

export type ThreatFactor = {
  category: ThreatCategory;
  level: ThreatLevel;
  headline: string;
  detail: string;
};

export type ThreatAssessment = {
  overallLevel: ThreatLevel;
  factors: ThreatFactor[];
  generatedAt: string;
};

export type ThreatInput = {
  windGustMph: number | null;
  hourlyRainIn: number | null;
  /** Radar base reflectivity at the Bridgeport point, in dBZ. Used as a proxy for
   *  storm-core intensity (heavy rain / possible hail), not a direct hail sensor. */
  radarDbz: number | null;
  /** Pressure change over the trailing window, inHg/hr. Negative = falling. */
  pressureTrendInHgPerHr: number | null;
};

const LEVEL_RANK: Record<ThreatLevel, number> = { none: 0, monitor: 1, elevated: 2, severe: 3 };

function higherLevel(a: ThreatLevel, b: ThreatLevel): ThreatLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

function assessWind(gustMph: number | null): ThreatFactor {
  if (gustMph === null) {
    return { category: "wind", level: "none", headline: "Wind: no data", detail: "Live gust reading is unavailable." };
  }
  // 58 mph / 50 kt gust is the NWS severe-thunderstorm wind threshold.
  if (gustMph >= 58) return { category: "wind", level: "severe", headline: "Damaging wind gusts", detail: `Gusts to ${gustMph.toFixed(0)} mph meet the severe-thunderstorm wind threshold (58 mph).` };
  if (gustMph >= 40) return { category: "wind", level: "elevated", headline: "Strong, gusty wind", detail: `Gusts to ${gustMph.toFixed(0)} mph. Below severe threshold but capable of minor damage.` };
  if (gustMph >= 25) return { category: "wind", level: "monitor", headline: "Breezy to gusty", detail: `Gusts to ${gustMph.toFixed(0)} mph.` };
  return { category: "wind", level: "none", headline: "Wind: nominal", detail: `Gusts to ${gustMph.toFixed(0)} mph.` };
}

function assessHail(radarDbz: number | null): ThreatFactor {
  if (radarDbz === null) {
    return { category: "hail", level: "none", headline: "Hail: no radar data", detail: "Point reflectivity is unavailable." };
  }
  // Reflectivity is a proxy, not a direct hail measurement — high dBZ correlates with
  // dense/large hydrometeors but confirming hail requires dual-pol or a spotter report.
  if (radarDbz >= 55) return { category: "hail", level: "severe", headline: "Large hail possible", detail: `Reflectivity of ${radarDbz.toFixed(0)} dBZ overhead is consistent with a very intense core; large hail is possible.` };
  if (radarDbz >= 50) return { category: "hail", level: "elevated", headline: "Hail possible", detail: `Reflectivity of ${radarDbz.toFixed(0)} dBZ suggests a strong core capable of producing hail.` };
  if (radarDbz >= 45) return { category: "hail", level: "monitor", headline: "Strong core overhead", detail: `Reflectivity of ${radarDbz.toFixed(0)} dBZ. Heavy rain likely; small hail is possible.` };
  return { category: "hail", level: "none", headline: "Hail: unlikely", detail: radarDbz > 0 ? `Reflectivity of ${radarDbz.toFixed(0)} dBZ.` : "No significant echo overhead." };
}

function assessHeavyRain(hourlyRainIn: number | null): ThreatFactor {
  if (hourlyRainIn === null) {
    return { category: "heavyRain", level: "none", headline: "Rain: no data", detail: "Live rain-rate reading is unavailable." };
  }
  if (hourlyRainIn >= 2) return { category: "heavyRain", level: "severe", headline: "Flash-flooding rain rates", detail: `Rain rate of ${hourlyRainIn.toFixed(2)} in/hr can produce flash flooding, especially over pavement and low-lying areas.` };
  if (hourlyRainIn >= 1) return { category: "heavyRain", level: "elevated", headline: "Heavy rain", detail: `Rain rate of ${hourlyRainIn.toFixed(2)} in/hr — ponding on streets is likely.` };
  if (hourlyRainIn >= 0.3) return { category: "heavyRain", level: "monitor", headline: "Moderate rain", detail: `Rain rate of ${hourlyRainIn.toFixed(2)} in/hr.` };
  return { category: "heavyRain", level: "none", headline: "Rain: light or none", detail: hourlyRainIn > 0 ? `Rain rate of ${hourlyRainIn.toFixed(2)} in/hr.` : "No rain currently detected at the station." };
}

function assessRotation(pressureTrendInHgPerHr: number | null): ThreatFactor {
  // Base reflectivity has no velocity information, so rotation cannot be detected from
  // this app's radar feed. A sharp pressure fall is a loose supporting signal for storm
  // intensification, but it is not a rotation indicator on its own. Until NWS alerts are
  // wired in, this factor stays informational and never drives the overall level up.
  const trendNote = pressureTrendInHgPerHr !== null && pressureTrendInHgPerHr <= -0.05
    ? ` Local pressure is falling quickly (${pressureTrendInHgPerHr.toFixed(2)} inHg/hr), consistent with an intensifying storm nearby, though this does not confirm rotation.`
    : "";
  return {
    category: "rotation",
    level: "monitor",
    headline: "Rotation: not assessed here",
    detail: `This app's radar shows reflectivity only, which cannot detect rotation.${trendNote} For tornado risk, rely on active NWS Tornado Warnings.`,
  };
}

export function assessThreat(input: ThreatInput): ThreatAssessment {
  const wind = assessWind(input.windGustMph);
  const hail = assessHail(input.radarDbz);
  const heavyRain = assessHeavyRain(input.hourlyRainIn);
  const rotation = assessRotation(input.pressureTrendInHgPerHr);

  // Rotation is deliberately excluded from driving the overall level — see assessRotation.
  const overallLevel = [wind, hail, heavyRain].reduce((level, factor) => higherLevel(level, factor.level), "none" as ThreatLevel);

  return {
    overallLevel,
    factors: [wind, hail, heavyRain, rotation],
    generatedAt: new Date().toISOString(),
  };
}
