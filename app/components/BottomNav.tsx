"use client";

const tabs = [
  ["tab-radar", "Live Radar"],
  ["tab-station", "Current Conditions"],
  ["tab-forecast", "Forecasted Weather"],
] as const;

export default function BottomNav() {
  const finishTabChange = () => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        window.dispatchEvent(new Event("resize"));
      });
    }, 0);
  };

  return (
    <nav className="bottomNav" aria-label="Primary">
      {tabs.map(([id, label]) => (
        <label key={id} htmlFor={id} onClick={finishTabChange}>{label}</label>
      ))}
    </nav>
  );
}
