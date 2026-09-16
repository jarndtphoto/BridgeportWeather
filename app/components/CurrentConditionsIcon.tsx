"use client";

import { useEffect, useState, type ComponentProps } from "react";
import WeatherIcon from "./WeatherIcon";

type IconKind = ComponentProps<typeof WeatherIcon>["kind"];

type ThreatPayload = {
  evolution?: {
    relevance?: string;
    headline?: string;
  };
};

export default function CurrentConditionsIcon({ kind, className = "" }: { kind: IconKind; className?: string }) {
  const [displayKind, setDisplayKind] = useState<IconKind>(kind);

  useEffect(() => {
    setDisplayKind(kind);
  }, [kind]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const response = await fetch("/api/threat", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as ThreatPayload;
        if (!active) return;

        const headline = payload.evolution?.headline?.toLowerCase() ?? "";
        const rainOverBridgeport = payload.evolution?.relevance === "overhead" && headline.includes("rain") && headline.includes("bridgeport");
        setDisplayKind(rainOverBridgeport ? "light-rain" : kind);
      } catch {
        if (active) setDisplayKind(kind);
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [kind]);

  return <WeatherIcon className={className} kind={displayKind} />;
}
