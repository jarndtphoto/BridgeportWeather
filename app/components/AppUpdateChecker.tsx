"use client";

import { useEffect } from "react";

type VersionResponse = { version?: string };

export default function AppUpdateChecker({ currentVersion }: { currentVersion: string }) {
  useEffect(() => {
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
