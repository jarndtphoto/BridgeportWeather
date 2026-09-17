"use client";

import { useEffect, useState } from "react";
import type { ThreatAssessment, ThreatLevel } from "../../lib/threat";
import type { StormEvolution } from "../../lib/evolution";

type ThreatInputs = { hourlyRainIn?: number | null; windGustMph?: number | null; radarDbz?: number | null };
type ThreatResponse = { assessment: ThreatAssessment; evolution?: StormEvolution; inputs?: ThreatInputs };

const LEVEL_COPY: Record<ThreatLevel, string> = {
  none: "No elevated threat",
  monitor: "Monitor conditions",
  elevated: "Elevated threat",
  severe: "Severe threat indicators",
};

const STATION_DRY_COPY = "The local station has not measured rain yet.";
const STATION_LIGHT_RAIN_COPY = "The local station may not detect drizzle or light rain.";

function directionWords(label: string | null) {
  return ({ N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" } as Record<string, string>)[label ?? ""] ?? null;
}

function windDirectionWords(fromDeg: number | null) {
  if (fromDeg === null || !Number.isFinite(fromDeg)) return null;
  const labels = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return labels[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}

function estimatedMotionMph(evolution: StormEvolution) {
  if (evolution.motion !== "approaching" || evolution.strongestRadiusMiles === null || evolution.estimatedArrivalMinutes === null || evolution.estimatedArrivalMinutes <= 0) return null;
  const mph = evolution.strongestRadiusMiles / (evolution.estimatedArrivalMinutes / 60);
  if (!Number.isFinite(mph) || mph < 5 || mph > 70) return null;
  return Math.round(mph);
}

function userFriendlyEvolution(evolution: StormEvolution, inputs: ThreatInputs | null) {
  const localDbz = inputs?.radarDbz ?? evolution.bridgeportDbz ?? null;
  const rainRate = inputs?.hourlyRainIn ?? null;
  const gust = inputs?.windGustMph ?? null;
  const windFrom = windDirectionWords(evolution.surfaceWindFromDeg);
  const windSpeed = evolution.surfaceWindMph === null ? null : Math.round(evolution.surfaceWindMph);
  const motionSpeed = estimatedMotionMph(evolution);

  if (evolution.relevance === "overhead") {
    const intensity = (localDbz ?? 0) >= 45 ? "Heavy precipitation" : (localDbz ?? 0) >= 30 ? "Moderate precipitation" : "Rain";
    let detail = `Radar shows ${intensity.toLowerCase()} over Bridgeport.`;
    if (rainRate !== null && rainRate > 0) detail += ` The local station is measuring ${rainRate.toFixed(2)} in/hr.`;
    if (windFrom && windSpeed !== null) detail += ` Surface wind is from the ${windFrom} around ${windSpeed} mph.`;
    if (gust !== null && gust >= 20) detail += ` Gusts are near ${Math.round(gust)} mph.`;
    if (evolution.motion === "approaching") detail += ` The precipitation is still moving into the area${motionSpeed ? ` at about ${motionSpeed} mph` : ""}.`;
    else if (evolution.motion === "movingAway") detail += " The precipitation is beginning to move away from the area.";
    return { headline: `${intensity} over Bridgeport`, detail };
  }

  if (evolution.relevance !== "nearby" || evolution.motion !== "approaching") {
    return { headline: evolution.headline, detail: evolution.detail.replace(STATION_DRY_COPY, STATION_LIGHT_RAIN_COPY) };
  }

  const where = directionWords(evolution.strongestSector);
  const precip = (evolution.strongestNearbyDbz ?? 0) >= 10 ? "Rain" : "Light precipitation";
  const headline = where
    ? `${precip} ${where} of Bridgeport is moving in our direction${motionSpeed ? ` at about ${motionSpeed} mph` : ""}`
    : `${precip} near Bridgeport is moving in our direction${motionSpeed ? ` at about ${motionSpeed} mph` : ""}`;

  let detail = "Radar motion shows the precipitation tracking toward Bridgeport.";
  if (evolution.windAssist && windFrom && windSpeed !== null) detail += ` Surface winds from the ${windFrom} around ${windSpeed} mph are also helping carry low-level moisture toward the area.`;
  else if (windFrom && windSpeed !== null) detail += ` Current surface winds are from the ${windFrom} around ${windSpeed} mph.`;
  detail += " As the area gets closer, its track, speed, and the local wind can allow drizzle or rain to begin reaching Bridgeport even before the strongest radar echo is directly overhead.";
  return { headline, detail };
}

export default function ThreatBanner() {
  const [assessment, setAssessment] = useState<ThreatAssessment | null>(null);
  const [evolution, setEvolution] = useState<StormEvolution | null>(null);
  const [inputs, setInputs] = useState<ThreatInputs | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/threat", { cache: "no-store" });
        if (!response.ok) throw new Error("Threat assessment unavailable");
        const payload = (await response.json()) as ThreatResponse;
        if (!active) return;
        setAssessment(payload.assessment);
        setEvolution(payload.evolution ?? null);
        setInputs(payload.inputs ?? null);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    }
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (status === "loading") return <div className="threatZone"><strong>Checking local conditions…</strong><p>Combining live station data, radar evolution, and official NWS alerts.</p></div>;
  if (status === "error" || !assessment) return <div className="threatZone"><strong>Threat assessment unavailable</strong><p>Live weather data couldn&rsquo;t be reached. The app will retry automatically.</p></div>;

  const authoritativeFactors = assessment.factors.filter((factor) => factor.level !== "none" && ["officialWarning", "tornado", "probSevere"].includes(factor.category));
  const evolutionCopy = evolution ? userFriendlyEvolution(evolution, inputs) : null;
  const rainActive = Boolean(evolutionCopy && /\brain\b|\bprecipitation\b|\bdrizzle\b|\bshowers?\b/i.test(`${evolutionCopy.headline} ${evolutionCopy.detail}`));
  const weatherStateClass = rainActive ? " weatherState-rain" : "";

  return (
    <div className={`threatZone threatLevel-${assessment.overallLevel}${weatherStateClass}`}>
      <strong>{LEVEL_COPY[assessment.overallLevel]}</strong>
      {authoritativeFactors.length > 0 && <ul className="threatFactorList">{authoritativeFactors.map((factor) => <li key={factor.category} className={`threatFactor-${factor.level}`}><strong>{factor.headline}</strong><span>{factor.detail}</span></li>)}</ul>}
      {evolution && evolutionCopy ? <div className="stormEvolution"><strong>{evolutionCopy.headline}</strong><p>{evolutionCopy.detail}</p></div> : authoritativeFactors.length === 0 ? <p>Official alerts and local severe-weather indicators are currently quiet for Bridgeport.</p> : null}
    </div>
  );
}
