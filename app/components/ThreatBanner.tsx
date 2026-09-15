"use client";

import { useEffect, useState } from "react";
import type { ThreatAssessment, ThreatLevel } from "../../lib/threat";

type ThreatResponse = { assessment: ThreatAssessment };

const LEVEL_COPY: Record<ThreatLevel, string> = {
  none: "No elevated threat",
  monitor: "Monitor conditions",
  elevated: "Elevated threat",
  severe: "Severe threat indicators",
};

export default function ThreatBanner() {
  const [assessment, setAssessment] = useState<ThreatAssessment | null>(null);
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
        <p>Combining live station data and radar to assess current severe-weather threats.</p>
      </div>
    );
  }

  if (status === "error" || !assessment) {
    return (
      <div className="threatZone">
        <strong>Threat assessment unavailable</strong>
        <p>Live station or radar data couldn&rsquo;t be reached. The app will retry automatically.</p>
      </div>
    );
  }

  const activeFactors = assessment.factors.filter((factor) => factor.category !== "rotation" && factor.level !== "none");
  const rotationFactor = assessment.factors.find((factor) => factor.category === "rotation");

  return (
    <div className={`threatZone threatLevel-${assessment.overallLevel}`}>
      <strong>{LEVEL_COPY[assessment.overallLevel]}</strong>
      {activeFactors.length === 0 ? (
        <p>Wind, rain rate, and radar reflectivity at Bridgeport are all within normal ranges.</p>
      ) : (
        <ul className="threatFactorList">
          {activeFactors.map((factor) => (
            <li key={factor.category} className={`threatFactor-${factor.level}`}>
              <strong>{factor.headline}</strong>
              <span>{factor.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {rotationFactor && <p className="threatRotationNote">{rotationFactor.detail}</p>}
    </div>
  );
}
