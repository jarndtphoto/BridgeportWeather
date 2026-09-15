"use client";

const tabs = [
  ["tab-radar", "Live Radar"],
  ["tab-station", "Current Conditions"],
  ["tab-forecast", "Forecasted Weather"],
] as const;

export default function BottomNav() {
  const changeTab = (id: string) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      window.dispatchEvent(new Event("resize"));
    });
  };

  return (
    <nav className="bottomNav" aria-label="Primary">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" className="bottomNavButton" onClick={() => changeTab(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
