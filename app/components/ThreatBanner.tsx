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
      {evolution ? (
        <div className="stormEvolution">
          <strong>{evolution.headline}</strong>
          <p>{evolution.detail}</p>
        </div>
      ) : authoritativeFactors.length === 0 ? (
        <p>Official alerts and local severe-weather indicators are currently quiet for Bridgeport.</p>
      ) : null}
    </div>
  );
}
