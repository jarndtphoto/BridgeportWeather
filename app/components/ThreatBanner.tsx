"use client";

import { useEffect, useState } from "react";
import type { ThreatAssessment, ThreatLevel } from "../../lib/threat";
import type { StormEvolution } from "../../lib/evolution";

type ThreatResponse = { assessment: ThreatAssessment; evolution?: StormEvolution };

const LEVEL_COPY: Record<ThreatLevel, string> = {
  none: "No elevated threat",
  monitor: "Monitor conditions",
  elevated: "Elevated threat",
  severe: "Severe threat indicators",
};

const STATION_DRY_COPY = "The local station has not measured rain yet.";
const STATION_LIGHT_RAIN_COPY = "The local station may not detect drizzle or light rain.";

function directionWords(label: string | null) {
  return ({
    N: "north",
    NE: "northeast",
    E: "east",
    SE: "southeast",
    S: "south",
    SW: "southwest",
    W: "west",
    NW: "northwest",
  } as Record<string, string>)[label ?? ""] ?? null;
}

function windDirectionWords(fromDeg: number | null) {
  if (fromDeg === null || !Number.isFinite(fromDeg)) return null;
  const labels = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return labels[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}

function estimatedMotionMph(evolution: StormEvolution) {
  if (
    evolution.motion !== "approaching" ||
    evolution.strongestRadiusMiles === null ||
    evolution.estimatedArrivalMinutes === null ||
    evolution.estimatedArrivalMinutes <= 0
  ) return null;
  const mph = evolution.strongestRadiusMiles / (evolution.estimatedArrivalMinutes / 60);
  if (!Number.isFinite(mph) || mph < 5 || mph > 70) return null;
  return Math.round(mph);
}

function userFriendlyEvolution(evolution: StormEvolution) {
  if (evolution.relevance !== "nearby" || evolution.motion !== "approaching") {
    return {
      headline: evolution.headline,
      detail: evolution.detail.replace(STATION_DRY_COPY, STATION_LIGHT_RAIN_COPY),
    };
  }

  const where = directionWords(evolution.strongestSector);
  const speed = estimatedMotionMph(evolution);
  const windFrom = windDirectionWords(evolution.surfaceWindFromDeg);
  const windSpeed = evolution.surfaceWindMph === null ? null : Math.round(evolution.surfaceWindMph);
  const precip = (evolution.strongestNearbyDbz ?? 0) >= 10 ? "Rain" : "Light precipitation";

  const headline = where
    ? `${precip} ${where} of Bridgeport is moving in our direction${speed ? ` at about ${speed} mph` : ""}`
    : `${precip} near Bridgeport is moving in our direction${speed ? ` at about ${speed} mph` : ""}`;

  let detail = "Radar motion shows the precipitation tracking toward Bridgeport.";
  if (evolution.windAssist && windFrom && windSpeed !== null) {
    detail += ` Surface winds from the ${windFrom} around ${windSpeed} mph are also helping carry low-level moisture toward the area.`;
  } else if (windFrom && windSpeed !== null) {
    detail += ` Current surface winds are from the ${windFrom} around ${windSpeed} mph.`;
  }
  detail += " As the area gets closer, its track, speed, and the local wind can allow drizzle or rain to begin reaching Bridgeport even before the strongest radar echo is directly overhead.";

  return { headline, detail };
}

export default function ThreatBanner() {
  const [assessment, setAssessment] = useState<ThreatAssessment | null>(null);
  const [evolution, setEvolution] = useState<StormEvolution | null>(null);
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
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    }
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="threatZone">
        <strong>Checking local conditions…</strong>
        <p>Combining live station data, radar evolution, and official NWS alerts.</p>
      </div>
    );
  }

  if (status === "error" || !assessment) {
    return (
      <div className="threatZone">
        <strong>Threat assessment unavailable</strong>
        <p>Live weather data couldn&rsquo;t be reached. The app will retry automatically.</p>
      </div>
    );
  }

  const authoritativeFactors = assessment.factors.filter(
    (factor) => factor.level !== "none" && ["officialWarning", "tornado", "probSevere"].includes(factor.category),
  );
  const evolutionCopy = evolution ? userFriendlyEvolution(evolution) : null;

  return (
    <div className={`threatZone threatLevel-${assessment.overallLevel}`}>
      <strong>{LEVEL_COPY[assessment.overallLevel]}</strong>
      {authoritativeFactors.length > 0 && (
        <ul className="threatFactorList">
          {authoritativeFactors.map((factor) => (
            <li key={factor.category} className={`threatFactor-${factor.level}`}>
              <strong>{factor.headline}</strong>
              <span>{factor.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {evolution && evolutionCopy ? (
        <div className="stormEvolution">
          <strong>{evolutionCopy.headline}</strong>
          <p>{evolutionCopy.detail}</p>
        </div>
      ) : authoritativeFactors.length === 0 ? (
        <p>Official alerts and local severe-weather indicators are currently quiet for Bridgeport.</p>
      ) : null}
    </div>
  );
}
