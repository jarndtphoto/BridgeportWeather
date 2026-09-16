"use client";

import type * as Leaflet from "leaflet";
import type { Layer, Map as LeafletMap } from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LOCAL_TARGET: [number, number] = [41.8382, -87.6331];
const DEFAULT_ZOOM = 8;
const BASEMAP = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const BASEMAP_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const FORECAST_STEP_MINUTES = 15;
const FORECAST_WINDOW_MINUTES = 360;

type MetaPayload = { modelInitUtc: string | null };
type ForecastLayer = "precipitation" | "clouds";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function validTimeLabel(init: string | null, min: number) {
  if (!init) return "Forecast";
  return timeLabel(new Date(Date.parse(init) + min * 60_000).toISOString());
}

function runLabel(init: string | null) {
  return init ? `Run ${timeLabel(init)}` : "Latest HRRR run";
}

function checkedLabel(value: string | null) {
  return value ? `Forecast data checked ${timeLabel(value)}` : "Checking forecast update time…";
}

function relativeLabel(m: number) {
  if (m === 0) return "Nearest forecast";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return !h ? `+${r} min` : !r ? `+${h} hr` : `+${h} hr ${r} min`;
}

function iemRunId(v: string) {
  const d = new Date(v);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}00`;
}

export default function ForecastRadar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const currentLayersRef = useRef<Layer[]>([]);
  const pendingLayersRef = useRef<Layer[]>([]);
  const renderTokenRef = useRef(0);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [forecastLayer, setForecastLayer] = useState<ForecastLayer>("precipitation");
  const [mapReady, setMapReady] = useState(false);
  const [modelInitUtc, setModelInitUtc] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [touchMap, setTouchMap] = useState(false);
  const [mapInteraction, setMapInteraction] = useState(false);
  const [viewRevision, setViewRevision] = useState(0);
  const [tabActive, setTabActive] = useState(false);

  const removeLayers = useCallback((layers: Layer[]) => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of layers) if (map.hasLayer(layer)) map.removeLayer(layer);
  }, []);

  const clearWeatherLayers = useCallback(() => {
    renderTokenRef.current += 1;
    removeLayers(pendingLayersRef.current);
    removeLayers(currentLayersRef.current);
    pendingLayersRef.current = [];
    currentLayersRef.current = [];
  }, [removeLayers]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/forecast-radar/meta?t=${Date.now()}`, { cache: "no-store" });
        const payload = (response.ok ? await response.json() : null) as MetaPayload | null;
        if (!active) return;
        setModelInitUtc(payload?.modelInitUtc ?? null);
        if (response.ok) setCheckedAt(new Date().toISOString());
      } catch {}
    }
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const forecastMinutes = useMemo(() => {
    const count = FORECAST_WINDOW_MINUTES / FORECAST_STEP_MINUTES + 1;
    if (!modelInitUtc) return Array.from({ length: count }, (_, i) => i * FORECAST_STEP_MINUTES);
    const ageMinutes = Math.max(0, (Date.now() - Date.parse(modelInitUtc)) / 60_000);
    const start = Math.max(0, Math.ceil(ageMinutes / FORECAST_STEP_MINUTES) * FORECAST_STEP_MINUTES);
    return Array.from({ length: count }, (_, i) => start + i * FORECAST_STEP_MINUTES);
  }, [modelInitUtc]);

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
    clearWeatherLayers();
  }, [modelInitUtc, clearWeatherLayers]);

  useEffect(() => {
    const input = document.getElementById("tab-future") as HTMLInputElement | null;
    if (!input) return;
    const sync = () => {
      const active = input.checked;
      setTabActive(active);
      if (!active) {
        setPlaying(false);
        return;
      }
      setPlaying(false);
      setFrameIndex(0);
      setMapInteraction(false);
      clearWeatherLayers();
      const map = mapRef.current;
      if (map) {
        map.setView(LOCAL_TARGET, DEFAULT_ZOOM, { animate: false });
        window.requestAnimationFrame(() => {
          map.invalidateSize(false);
          setViewRevision((v) => v + 1);
        });
      }
    };
    sync();
    input.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      input.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [clearWeatherLayers]);

  useEffect(() => {
    let active = true;
    void import("leaflet").then((module) => {
      if (!active || !containerRef.current || mapRef.current) return;
      const L = module.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(LOCAL_TARGET, DEFAULT_ZOOM);
      map.createPane("weather");
      map.getPane("weather")!.style.zIndex = "400";
      map.getPane("weather")!.style.pointerEvents = "none";
      const isTouch = matchMedia("(pointer: coarse)").matches;
      if (isTouch) map.dragging.disable();
      setTouchMap(isTouch);
      L.tileLayer(BASEMAP, { maxZoom: 19, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
      L.circleMarker(LOCAL_TARGET, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff4d67", fillOpacity: 1 }).bindTooltip("Bridgeport", { direction: "top" }).addTo(map);
      map.on("moveend zoomend", () => setViewRevision((v) => v + 1));
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
      currentLayersRef.current = [];
      pendingLayersRef.current = [];
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
        setViewRevision((v) => v + 1);
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
    if (!map || !L || !mapReady || !tabActive || !modelInitUtc) return;

    const token = ++renderTokenRef.current;
    removeLayers(pendingLayersRef.current);
    pendingLayersRef.current = [];

    const frameMinutes = forecastMinutes[frameIndex];
    const pending: Layer[] = [];

    const promote = () => {
      if (token !== renderTokenRef.current) {
        removeLayers(pending);
        return;
      }
      removeLayers(currentLayersRef.current);
      for (const layer of pending) (layer as any).setOpacity?.(forecastLayer === "clouds" ? 0.9 : 0.82);
      currentLayersRef.current = [...pending];
      pendingLayersRef.current = [];
    };

    if (forecastLayer === "precipitation") {
      const frame = String(frameMinutes).padStart(4, "0");
      const run = iemRunId(modelInitUtc);
      const model: any = L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFP-F${frame}-${run}/{z}/{x}/{y}.png`, {
        pane: "weather",
        opacity: 0,
        maxZoom: 12,
        attribution: "HRRR via Iowa Environmental Mesonet",
      }).addTo(map);
      pending.push(model);
      pendingLayersRef.current = [...pending];
      let done = false;
      const ready = () => {
        if (done) return;
        done = true;
        promote();
      };
      model.once("load", ready);
      const fallback = window.setTimeout(ready, 1200);
      return () => {
        window.clearTimeout(fallback);
        model.off("load", ready);
        if (token !== renderTokenRef.current) removeLayers(pending);
      };
    }

    const bounds = map.getBounds();
    const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
    const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
    const size = map.getSize();
    if (size.x < 100 || size.y < 100) return;
    const params = new URLSearchParams({
      bbox: `${sw.x},${sw.y},${ne.x},${ne.y}`,
      width: String(size.x),
      height: String(size.y),
      modelInitUtc,
      forecastMinutes: String(frameMinutes),
    });
    const image: any = L.imageOverlay(`/api/forecast-cloud/image?${params}`, bounds, { opacity: 0, pane: "weather", interactive: false }).addTo(map);
    pending.push(image);
    pendingLayersRef.current = [...pending];
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      promote();
    };
    image.once("load", ready);
    const fallback = window.setTimeout(ready, 1200);
    return () => {
      window.clearTimeout(fallback);
      image.off("load", ready);
      if (token !== renderTokenRef.current) removeLayers(pending);
    };
  }, [forecastMinutes, frameIndex, forecastLayer, mapReady, modelInitUtc, viewRevision, tabActive, removeLayers]);

  useEffect(() => {
    if (!playing || !tabActive || mapInteraction || forecastMinutes.length < 2) return;
    const step = forecastLayer === "clouds" ? 4 : 1;
    const delay = forecastLayer === "clouds" ? 1800 : 1500;
    const timer = window.setInterval(() => setFrameIndex((i) => {
      const next = i + step;
      return next >= forecastMinutes.length ? 0 : next;
    }), delay);
    return () => window.clearInterval(timer);
  }, [forecastMinutes.length, playing, tabActive, mapInteraction, forecastLayer]);

  const frameMinutes = forecastMinutes[frameIndex];
  const displayMinutes = forecastLayer === "clouds" ? Math.round(frameMinutes / 60) * 60 : frameMinutes;
  const relativeMinutes = Math.max(0, displayMinutes - forecastMinutes[0]);

  const setLayer = (layer: ForecastLayer) => {
    if (layer === forecastLayer) return;
    setPlaying(false);
    setMapInteraction(false);
    setFrameIndex(0);
    clearWeatherLayers();
    setForecastLayer(layer);
    const map = mapRef.current;
    if (map) {
      map.setView(LOCAL_TARGET, DEFAULT_ZOOM, { animate: false });
      window.requestAnimationFrame(() => {
        map.invalidateSize(false);
        setViewRevision((v) => v + 1);
      });
    }
  };

  return (
    <div className="forecastRadarPlayer">
      <p className="radarSource" style={{ margin: "0 2px 10px" }}>{runLabel(modelInitUtc)} · {checkedLabel(checkedAt)}</p>
      <div className="weatherLayerToggle">
        <button type="button" className={forecastLayer === "precipitation" ? "active" : ""} onClick={() => setLayer("precipitation")}>Precipitation</button>
        <button type="button" className={forecastLayer === "clouds" ? "active" : ""} onClick={() => setLayer("clouds")}>Cloud Cover</button>
      </div>
      <div className="radarShell forecastRadarShell">
        <div ref={containerRef} className={`radarMap forecastRadarMap ${touchMap ? (mapInteraction ? "mapTouchActive" : "mapTouchScroll") : ""}`} />
        {touchMap && <button type="button" className="mapInteractionButton" onClick={() => { if (!mapInteraction) setPlaying(false); setMapInteraction((v) => !v); }}>{mapInteraction ? "Done" : "Move map"}</button>}
        <div className="radarReadout">
          <strong>{validTimeLabel(modelInitUtc, displayMinutes)}</strong>
          <span>{relativeLabel(relativeMinutes)} · HRRR forecast only · {runLabel(modelInitUtc)}</span>
        </div>
      </div>
      <div className="radarControls">
        <button type="button" onClick={() => setPlaying((v) => !v)}><span>{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}</button>
        <input type="range" min="0" max={forecastMinutes.length - 1} value={frameIndex} step={forecastLayer === "clouds" ? 4 : 1} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} />
        <button type="button" className="newestButton" onClick={() => { setPlaying(false); setFrameIndex(0); }}>Current</button>
      </div>
      <p className="radarSource">{forecastLayer === "precipitation" ? "NOAA/NCEP HRRR composite reflectivity forecast only. Live MRMS radar is not used anywhere on Future Radar." : "NOAA/NCEP HRRR total cloud cover via NOMADS · hourly cloud fields · model guidance"}</p>
    </div>
  );
}
