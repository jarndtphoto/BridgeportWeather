"use client";

import { useEffect, useRef, useState } from "react";

const tabs = [
  ["tab-radar", "Live Radar"],
  ["tab-station", "Current Conditions"],
  ["tab-forecast", "Forecasted Weather"],
] as const;

const REFRESH_THRESHOLD = 72;
const MAX_PULL = 96;
const TAB_STORAGE_KEY = "bsw-active-tab";

function isKnownTab(id: string | null): id is (typeof tabs)[number][0] {
  return tabs.some(([tabId]) => tabId === id);
}

function setActiveTab(id: string, scrollToTop = false) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  try {
    window.sessionStorage.setItem(TAB_STORAGE_KEY, id);
  } catch {}
  document.documentElement.style.scrollBehavior = "auto";
  document.body.style.scrollBehavior = "auto";
  window.requestAnimationFrame(() => {
    if (scrollToTop) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    window.dispatchEvent(new Event("resize"));
  });
}

export default function BottomNav() {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullDistanceRef = useRef(0);

  useEffect(() => {
    let savedTab: string | null = null;
    try {
      savedTab = window.sessionStorage.getItem(TAB_STORAGE_KEY);
    } catch {}
    if (isKnownTab(savedTab)) setActiveTab(savedTab, false);
  }, []);

  useEffect(() => {
    let startY: number | null = null;

    const reset = () => {
      startY = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    const shouldIgnoreTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest(".radarShell, .weatherLayerToggle, .radarControls, button, input, a"));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (refreshing || window.scrollY > 0 || shouldIgnoreTarget(event.target)) return;
      startY = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || refreshing || window.scrollY > 0) return;
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined) return;
      const delta = currentY - startY;
      if (delta <= 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      event.preventDefault();
      const resisted = Math.min(MAX_PULL, delta * 0.55);
      pullDistanceRef.current = resisted;
      setPullDistance(resisted);
    };

    const onTouchEnd = () => {
      if (startY === null || refreshing) return;
      const shouldRefresh = pullDistanceRef.current >= REFRESH_THRESHOLD;
      startY = null;
      if (!shouldRefresh) {
        reset();
        return;
      }

      const active = tabs.find(([id]) => (document.getElementById(id) as HTMLInputElement | null)?.checked)?.[0];
      if (active) {
        try {
          window.sessionStorage.setItem(TAB_STORAGE_KEY, active);
        } catch {}
      }

      setRefreshing(true);
      setPullDistance(REFRESH_THRESHOLD);
      window.setTimeout(() => window.location.reload(), 180);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [refreshing]);

  const changeTab = (id: string) => {
    setActiveTab(id, true);
  };

  const visible = refreshing || pullDistance > 8;
  const ready = pullDistance >= REFRESH_THRESHOLD;

  return (
    <>
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          top: `calc(env(safe-area-inset-top) + ${Math.max(8, pullDistance * 0.42)}px)`,
          left: "50%",
          zIndex: 1400,
          transform: `translate(-50%, ${visible ? 0 : -44}px)`,
          opacity: visible ? 1 : 0,
          transition: refreshing ? "opacity 120ms ease" : "opacity 90ms ease, transform 90ms ease",
          padding: "8px 12px",
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: 999,
          background: "rgba(8,12,18,.92)",
          color: "#f5f7fa",
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1,
          backdropFilter: "blur(12px)",
          pointerEvents: "none",
        }}
      >
        {refreshing ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh"}
      </div>
      <nav className="bottomNav" aria-label="Primary">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className="bottomNavButton" onClick={() => changeTab(id)}>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}
