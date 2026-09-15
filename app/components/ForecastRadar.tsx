"use client";

import type * as Leaflet from "leaflet";
import type { ImageOverlay, Map as LeafletMap } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

const LOCAL_TARGET: [number, number] = [41.8382, -87.6331];
const HRRR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi";
const BASEMAP = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const BASEMAP_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const FORECAST_STEP_MINUTES = 15;
const FORECAST_WINDOW_MINUTES = 360;

type MetaPayload = { modelInitUtc: string | null };

function validTimeLabel(modelInitUtc: string | null, forecastMinutes: number) {
  if (!modelInitUtc) return forecastMinutes === 0 ? "Model analysis" : `Forecast +${forecastMinutes} min`;
  const valid = new Date(Date.parse(modelInitUtc) + forecastMinutes * 60_000);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(valid);
}

function runLabel(modelInitUtc: string | null) {
  if (!modelInitUtc) return "Latest HRRR run";
  return `Run ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(modelInitUtc))}`;
}

function relativeLabel(minutes: number) {
  if (minutes === 0) return "Current";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!hours) return `+${remaining} min`;
  if (!remaining) return `+${hours} hr`;
  return `+${hours} hr ${remaining} min`;
}

function forecastHourLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}:${String(remaining).padStart(2, "0")}` : String(hours);
}

export default function ForecastRadar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const overlayRef = useRef<ImageOverlay | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [modelInitUtc, setModelInitUtc] = useState<string | null>(null);
  const [touchMap, setTouchMap] = useState(false);
  const [mapInteraction, setMapInteraction] = useState(false);
  const [viewRevision, setViewRevision] = useState(0);

  useEffect(() => {
    void fetch("/api/forecast-radar/meta", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: MetaPayload | null) => setModelInitUtc(payload?.modelInitUtc ?? null))
      .catch(() => setModelInitUtc(null));
  }, []);

  const forecastMinutes = useMemo(() => {
    const frameCount = FORECAST_WINDOW_MINUTES / FORECAST_STEP_MINUTES + 1;
    if (!modelInitUtc) return Array.from({ length: frameCount }, (_, index) => index * FORECAST_STEP_MINUTES);
    const initMs = Date.parse(modelInitUtc);
    const ageMinutes = Math.max(0, Math.floor((Date.now() - initMs) / (FORECAST_STEP_MINUTES * 60_000)) * FORECAST_STEP_MINUTES);
    const startMinutes = Math.min(ageMinutes, 720);
    return Array.from({ length: frameCount }, (_, index) => startMinutes + index * FORECAST_STEP_MINUTES);
  }, [modelInitUtc]);

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [modelInitUtc]);

  useEffect(() => {
    let active = true;
    void import("leaflet").then((module) => {
      if (!active || !containerRef.current || mapRef.current) return;
      const L = module.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(LOCAL_TARGET, 8);
      map.createPane("weather");
      map.getPane("weather")!.style.zIndex = "400";
      map.getPane("weather")!.style.pointerEvents = "none";
      const isTouch = window.matchMedia("(pointer: coarse)").matches;
      if (isTouch) map.dragging.disable();
      setTouchMap(isTouch);
      L.tileLayer(BASEMAP, { maxZoom: 19, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
      L.circleMarker(LOCAL_TARGET, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff4d67", fillOpacity: 1 }).bindTooltip("Bridgeport", { direction: "top" }).addTo(map);
      map.on("moveend zoomend", () => setViewRevision((value) => value + 1));
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
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 100 || rect.height < 100) return;
      window.requestAnimationFrame(() => {
        const map = mapRef.current;
        if (!map) return;
        map.invalidateSize(false);
        setViewRevision((value) => value + 1);
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !touchMap) return;
    if (mapInteraction) map.dragging.enable();
    else map.dragging.disable();
  }, [mapInteraction, touchMap]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !mapReady) return;

    const frameMinutes = forecastMinutes[frameIndex];
    const layerName = `refp_${String(frameMinutes).padStart(4, "0")}`;
    const bounds = map.getBounds();
    const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
    const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
    const size = map.getSize();
    if (size.x < 100 || size.y < 100) return;
    const scale = Math.max(1, Math.min(3, 1800 / size.x, 1800 / size.y));
    const width = Math.round(size.x * scale);
    const height = Math.round(size.y * scale);
    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetMap",
      LAYERS: layerName,
      STYLES: "",
      FORMAT: "image/png",
      TRANSPARENT: "true",
      SRS: "EPSG:3857",
      BBOX: `${sw.x},${sw.y},${ne.x},${ne.y}`,
      WIDTH: String(width),
      HEIGHT: String(height),
    });
    const url = `${HRRR_WMS}?${params.toString()}`;
    const previous = overlayRef.current;
    const next = L.imageOverlay(url, bounds, { opacity: 0, pane: "weather", interactive: false }).addTo(map);

    let promoted = false;
    const promote = () => {
      if (promoted) return;
      promoted = true;
      next.setOpacity(0.56);
      overlayRef.current = next;
      if (previous && previous !== next && map.hasLayer(previous)) map.removeLayer(previous);
    };
    const discard = () => { if (map.hasLayer(next)) map.removeLayer(next); };

    next.once("load", promote);
    next.once("error", discard);
    return () => {
      next.off("load", promote);
      next.off("error", discard);
      if (overlayRef.current !== next && map.hasLayer(next)) map.removeLayer(next);
    };
  }, [forecastMinutes, frameIndex, mapReady, viewRevision]);

  useEffect(() => {
    if (!playing || mapInteraction) return;
    const timer = window.setInterval(() => setFrameIndex((index) => (index + 1) % forecastMinutes.length), 900);
    return () => window.clearInterval(timer);
  }, [forecastMinutes.length, playing, mapInteraction]);

  const frameMinutes = forecastMinutes[frameIndex];
  const relativeMinutes = frameIndex * FORECAST_STEP_MINUTES;
  const toggleMapInteraction = () => {
    if (!mapInteraction) setPlaying(false);
    setMapInteraction((value) => !value);
  };

  return <div className="forecastRadarPlayer">
    <div className="radarShell forecastRadarShell">
      <div ref={containerRef} className={`radarMap forecastRadarMap ${touchMap ? (mapInteraction ? "mapTouchActive" : "mapTouchScroll") : ""}`} aria-label="HRRR six-hour simulated reflectivity forecast in 15-minute increments with precipitation-type colors centered on Bridgeport, Chicago" />
      {touchMap && <button type="button" className="mapInteractionButton" onClick={toggleMapInteraction}>{mapInteraction ? "Done" : "Move map"}</button>}
      <div className="radarReadout" aria-live="polite"><strong>{validTimeLabel(modelInitUtc, frameMinutes)}</strong><span>{relativeLabel(relativeMinutes)} · HRRR F+{forecastHourLabel(frameMinutes)} · {runLabel(modelInitUtc)}</span></div>
    </div>
    <div className="radarControls">
      <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause forecast radar animation" : "Play forecast radar animation"}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}</button>
      <input type="range" min="0" max={forecastMinutes.length - 1} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} aria-label="HRRR forecast timeline in 15-minute increments" />
      <button type="button" className="newestButton" onClick={() => { setPlaying(false); setFrameIndex(forecastMinutes.length - 1); }} disabled={frameIndex === forecastMinutes.length - 1 && !playing}>+6 hr</button>
    </div>
    <p className="radarSource">NCEP HRRR simulated reflectivity at 1 km AGL via Iowa Environmental Mesonet · 15-minute forecast increments · precipitation-type color ramp · model guidance, not observed radar</p>
  </div>;
}
