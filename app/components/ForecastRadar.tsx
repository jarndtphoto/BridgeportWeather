"use client";

import type * as Leaflet from "leaflet";
import type { Map as LeafletMap, TileLayer } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

const LOCAL_TARGET: [number, number] = [41.8382, -87.6331];
const HRRR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi";

type MetaPayload = { modelInitUtc: string | null };

function validTimeLabel(modelInitUtc: string | null, forecastMinutes: number) {
  if (!modelInitUtc) return forecastMinutes === 0 ? "Model analysis" : `Forecast +${forecastMinutes / 60} hr`;
  const valid = new Date(Date.parse(modelInitUtc) + forecastMinutes * 60_000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(valid);
}

function runLabel(modelInitUtc: string | null) {
  if (!modelInitUtc) return "Latest HRRR run";
  return `Run ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(modelInitUtc))}`;
}

export default function ForecastRadar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<TileLayer.WMS | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [modelInitUtc, setModelInitUtc] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/forecast-radar/meta", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: MetaPayload | null) => setModelInitUtc(payload?.modelInitUtc ?? null))
      .catch(() => setModelInitUtc(null));
  }, []);

  const forecastMinutes = useMemo(() => {
    if (!modelInitUtc) return [0, 60, 120, 180, 240, 300, 360];
    const initMs = Date.parse(modelInitUtc);
    const ageHours = Math.max(0, Math.ceil((Date.now() - initMs) / 3_600_000));
    const startMinutes = Math.min(ageHours * 60, 720);
    return Array.from({ length: 7 }, (_, index) => startMinutes + index * 60);
  }, [modelInitUtc]);

  useEffect(() => {
    setFrameIndex(0);
  }, [modelInitUtc]);

  useEffect(() => {
    let active = true;
    void import("leaflet").then((module) => {
      if (!active || !containerRef.current || mapRef.current) return;
      const L = module.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(LOCAL_TARGET, 8);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      L.circleMarker(LOCAL_TARGET, {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#ff4d67",
        fillOpacity: 1,
      }).bindTooltip("Bridgeport", { direction: "top" }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !mapReady) return;

    const frameMinutes = forecastMinutes[frameIndex];
    const layerName = `refd_${String(frameMinutes).padStart(4, "0")}`;
    const previous = layerRef.current;
    const next = L.tileLayer.wms(HRRR_WMS, {
      layers: layerName,
      format: "image/png",
      transparent: true,
      opacity: 0.72,
      version: "1.1.1",
      zIndex: 400,
    } as L.WMSOptions).addTo(map);
    layerRef.current = next;
    if (previous && map.hasLayer(previous)) map.removeLayer(previous);
  }, [forecastMinutes, frameIndex, mapReady]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % forecastMinutes.length);
    }, 1700);
    return () => window.clearInterval(timer);
  }, [forecastMinutes.length, playing]);

  const frameMinutes = forecastMinutes[frameIndex];
  const relativeHours = frameIndex;

  return (
    <div className="forecastRadarPlayer">
      <div className="radarShell forecastRadarShell">
        <div ref={containerRef} className="radarMap forecastRadarMap" aria-label="HRRR six-hour simulated reflectivity forecast centered on Bridgeport, Chicago" />
        <div className="radarReadout" aria-live="polite">
          <strong>{validTimeLabel(modelInitUtc, frameMinutes)}</strong>
          <span>{relativeHours === 0 ? "First future HRRR hour" : `+${relativeHours} hr from start`} · HRRR F+{frameMinutes / 60} · {runLabel(modelInitUtc)}</span>
        </div>
      </div>
      <div className="radarControls">
        <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause forecast radar animation" : "Play forecast radar animation"}>
          <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min="0"
          max={forecastMinutes.length - 1}
          value={frameIndex}
          onChange={(event) => {
            setPlaying(false);
            setFrameIndex(Number(event.target.value));
          }}
          aria-label="HRRR forecast hour"
        />
        <button
          type="button"
          className="newestButton"
          onClick={() => {
            setPlaying(false);
            setFrameIndex(forecastMinutes.length - 1);
          }}
          disabled={frameIndex === forecastMinutes.length - 1 && !playing}
        >
          +6 hr
        </button>
      </div>
      <p className="radarSource">NCEP HRRR simulated reflectivity at 1 km AGL via Iowa Environmental Mesonet · model guidance, not observed radar</p>
    </div>
  );
}
