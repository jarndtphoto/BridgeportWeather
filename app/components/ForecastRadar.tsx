"use client";

import type * as Leaflet from "leaflet";
import type { Map as LeafletMap, TileLayer } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

const LOCAL_TARGET: [number, number] = [41.8382, -87.6331];
const HRRR_TMS_BASE = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0";
const TRANSPARENT_TILE = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

type MetaPayload = { modelInitUtc: string | null };

function validTimeLabel(modelInitUtc: string | null, forecastMinutes: number) {
  if (!modelInitUtc) return forecastMinutes === 0 ? "Model analysis" : `Forecast +${forecastMinutes / 60} hr`;
  const valid = new Date(Date.parse(modelInitUtc) + forecastMinutes * 60_000);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(valid);
}
function runLabel(modelInitUtc: string | null) {
  if (!modelInitUtc) return "Latest HRRR run";
  return `Run ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(modelInitUtc))}`;
}
function runKey(modelInitUtc: string | null) {
  if (!modelInitUtc) return "0";
  const date = new Date(modelInitUtc);
  if (Number.isNaN(date.getTime())) return "0";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

export default function ForecastRadar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<TileLayer | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [modelInitUtc, setModelInitUtc] = useState<string | null>(null);
  const [touchMap, setTouchMap] = useState(false);
  const [mapInteraction, setMapInteraction] = useState(false);

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

  useEffect(() => { setFrameIndex(0); }, [modelInitUtc]);

  useEffect(() => {
    let active = true;
    void import("leaflet").then((module) => {
      if (!active || !containerRef.current || mapRef.current) return;
      const L = module.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(LOCAL_TARGET, 8);
      const isTouch = window.matchMedia("(pointer: coarse)").matches;
      if (isTouch) map.dragging.disable();
      setTouchMap(isTouch);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      L.circleMarker(LOCAL_TARGET, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff4d67", fillOpacity: 1 }).bindTooltip("Bridgeport", { direction: "top" }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => { active = false; mapRef.current?.remove(); mapRef.current = null; };
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
    const forecastKey = String(frameMinutes).padStart(4, "0");
    const url = `${HRRR_TMS_BASE}/hrrr::REFD-F${forecastKey}-${runKey(modelInitUtc)}/{z}/{x}/{y}.png`;
    const previous = layerRef.current;
    const next = L.tileLayer(url, { opacity: 0.72, zIndex: 400, maxZoom: 10, errorTileUrl: TRANSPARENT_TILE, attribution: "HRRR reflectivity via Iowa Environmental Mesonet" }).addTo(map);
    let replaced = false;
    const replacePrevious = () => { if (replaced) return; replaced = true; layerRef.current = next; if (previous && map.hasLayer(previous)) map.removeLayer(previous); };
    next.once("load", replacePrevious);
    const fallbackTimer = window.setTimeout(replacePrevious, 1800);
    return () => { window.clearTimeout(fallbackTimer); next.off("load", replacePrevious); if (layerRef.current !== next && map.hasLayer(next)) map.removeLayer(next); };
  }, [forecastMinutes, frameIndex, mapReady, modelInitUtc]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setFrameIndex((index) => (index + 1) % forecastMinutes.length), 1700);
    return () => window.clearInterval(timer);
  }, [forecastMinutes.length, playing]);

  const frameMinutes = forecastMinutes[frameIndex];
  const relativeHours = frameIndex;

  return <div className="forecastRadarPlayer">
    <div className="radarShell forecastRadarShell">
      <div ref={containerRef} className={`radarMap forecastRadarMap ${touchMap ? (mapInteraction ? "mapTouchActive" : "mapTouchScroll") : ""}`} aria-label="HRRR six-hour simulated reflectivity forecast centered on Bridgeport, Chicago" />
      {touchMap && <button type="button" className="mapInteractionButton" onClick={() => setMapInteraction((value) => !value)}>{mapInteraction ? "Done" : "Move map"}</button>}
      <div className="radarReadout" aria-live="polite"><strong>{validTimeLabel(modelInitUtc, frameMinutes)}</strong><span>{relativeHours === 0 ? "First future HRRR hour" : `+${relativeHours} hr from start`} · HRRR F+{frameMinutes / 60} · {runLabel(modelInitUtc)}</span></div>
    </div>
    <div className="radarControls">
      <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause forecast radar animation" : "Play forecast radar animation"}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}</button>
      <input type="range" min="0" max={forecastMinutes.length - 1} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} aria-label="HRRR forecast hour" />
      <button type="button" className="newestButton" onClick={() => { setPlaying(false); setFrameIndex(forecastMinutes.length - 1); }} disabled={frameIndex === forecastMinutes.length - 1 && !playing}>+6 hr</button>
    </div>
    <p className="radarSource">NCEP HRRR simulated reflectivity at 1 km AGL via Iowa Environmental Mesonet · model guidance, not observed radar</p>
  </div>;
}
