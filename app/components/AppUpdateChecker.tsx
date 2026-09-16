"use client";

import { useEffect } from "react";

type VersionResponse = { version?: string };

const CANONICAL_HOST = "bridgeport-weather-git-main-jarndtphoto.vercel.app";

export default function AppUpdateChecker({ currentVersion }: { currentVersion: string }) {
  useEffect(() => {
    // Deployment-specific Vercel URLs are immutable. If the app was added to the
    // iOS Home Screen from one of those URLs, it would otherwise stay pinned to
    // that old deployment forever. Move it onto the stable production alias so
    // future launches and version checks always see current main.
    if (
      window.location.hostname.endsWith(".vercel.app") &&
      window.location.hostname !== CANONICAL_HOST
    ) {
      const canonical = new URL(window.location.href);
      canonical.protocol = "https:";
      canonical.hostname = CANONICAL_HOST;
      canonical.port = "";
      window.location.replace(canonical.toString());
      return;
    }

    let checking = false;

    async function checkForUpdate() {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch(`/api/version?t=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as VersionResponse;
        const latestVersion = payload.version;
        if (!latestVersion || latestVersion === currentVersion) return;

        const url = new URL(window.location.href);
        url.searchParams.set("appVersion", latestVersion);
        window.location.replace(url.toString());
      } catch {
        // Stay on the current version when the update check cannot reach the server.
      } finally {
        checking = false;
      }
    }

    void checkForUpdate();

    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const onPageShow = () => void checkForUpdate();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [currentVersion]);

  return null;
}
