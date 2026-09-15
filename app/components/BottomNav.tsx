"use client";

const tabs = [
  ["tab-radar", "Radar"],
  ["tab-station", "Station"],
  ["tab-forecast", "Forecast"],
] as const;

export default function BottomNav() {
  const resetScroll = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  return (
    <nav className="bottomNav" aria-label="Primary">
      {tabs.map(([id, label]) => (
        <label key={id} htmlFor={id} onClick={resetScroll}>{label}</label>
      ))}
    </nav>
  );
}
