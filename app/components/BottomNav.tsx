"use client";

const tabs = [
  ["tab-radar", "Live Radar"],
  ["tab-station", "Current Conditions"],
  ["tab-forecast", "Forecasted Weather"],
] as const;

export default function BottomNav() {
  const snapToTop = () => {
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  const finishTabChange = () => {
    snapToTop();
    window.requestAnimationFrame(() => {
      snapToTop();
      window.requestAnimationFrame(() => {
        snapToTop();
        window.dispatchEvent(new Event("resize"));
      });
    });
  };

  return (
    <nav className="bottomNav" aria-label="Primary">
      {tabs.map(([id, label]) => (
        <label
          key={id}
          htmlFor={id}
          onPointerDown={snapToTop}
          onClick={finishTabChange}
        >
          {label}
        </label>
      ))}
    </nav>
  );
}
