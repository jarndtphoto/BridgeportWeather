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
type RadarFrame = { observedAt: string };
type Motion = "approaching" | "movingAway" | "passingNearby" | "stationaryOrUnclear" | "unknown";
type Evolution = { motion: Motion; strongestSector: string | null; comparisonMinutes: number | null };

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function validTimeLabel(init: string | null, min: number) {
  if (!init) return min === 0 ? "Current" : "Forecast";
  return timeLabel(new Date(Date.parse(init) + min * 60_000).toISOString());
}

function runLabel(init: string | null) {
  return init ? `Run ${timeLabel(init)}` : "Latest HRRR run";
}

function checkedLabel(value: string | null) {
  return value ? `Forecast data checked ${timeLabel(value)}` : "Checking forecast update time…";
}

function relativeLabel(m: number) {
  if (m === 0) return "Current";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return !h ? `+${r} min` : !r ? `+${h} hr` : `+${h} hr ${r} min`;
}

function iemRunId(v: string) {
  const d = new Date(v);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}00`;
}

function sectorBearing(label: string | null) {
  return ({ N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 } as Record<string, number>)[label ?? ""] ?? null;
}

function shiftedPoint(lat: number, lon: number, bearingDeg: number, miles: number) {
  const r = 3958.8;
  const a = miles / r;
  const b = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(a) + Math.cos(lat1) * Math.sin(a) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(lat1), Math.cos(a) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI] as [number, number];
}

function motionShift(evolution: Evolution | null, relative: number) {
  if (!evolution || relative <= 0 || relative > 45) return null;
  const sector = sectorBearing(evolution.strongestSector);
  if (sector === null) return null;

  let bearing: number | null = null;
  if (evolution.motion === "approaching") bearing = (sector + 180) % 360;
  else if (evolution.motion === "movingAway") bearing = sector;
  else return null;

  const comparison = evolution.comparisonMinutes && evolution.comparisonMinutes > 0 ? evolution.comparisonMinutes : 10;
  const mph = Math.max(8, Math.min(40, (4 / comparison) * 60));
  return { bearing, miles: mph * (relative / 60) };
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
  const [latestObservedAt, setLatestObservedAt] = useState<string | null>(null);
  const [evolution, setEvolution] = useState<Evolution | null>(null);
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
        const [m, r, t] = await Promise.all([
          fetch(`/api/forecast-radar/meta?t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/radar/frames?t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/threat?t=${Date.now()}`, { cache: "no-store" }),
        ]);
        const mp = (m.ok ? await m.json() : null) as MetaPayload | null;
        const rp = r.ok ? await r.json() as { frames: RadarFrame[] } : null;
        const tp = t.ok ? await t.json() as { evolution?: Evolution } : null;
        if (!active) return;
        setModelInitUtc(mp?.modelInitUtc ?? null);
        setLatestObservedAt(rp?.frames?.at(-1)?.observedAt ?? null);
        setEvolution(tp?.evolution ?? null);
        if (m.ok) setCheckedAt(new Date().toISOString());
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
  }, [modelInitUtc]);

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
      map.createPane("nowcast");
      map.getPane("nowcast")!.style.zIndex = "410";
      map.getPane("nowcast")!.style.pointerEvents = "none";
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
    if (!map || !L || !mapReady || !tabActive) return;

    const token = ++renderTokenRef.current;
    removeLayers(pendingLayersRef.current);
    pendingLayersRef.current = [];

    const frameMinutes = forecastMinutes[frameIndex];
    const relative = Math.max(0, frameMinutes - forecastMinutes[0]);
    const pending: Layer[] = [];
    const opacityTargets = new Map<Layer, number>();

    const promote = () => {
      if (token !== renderTokenRef.current) {
        removeLayers(pending);
        return;
      }
      removeLayers(currentLayersRef.current);
      for (const layer of pending) {
        const target = opacityTargets.get(layer);
        if (typeof target === "number") (layer as any).setOpacity?.(target);
      }
      currentLayersRef.current = [...pending];
      pendingLayersRef.current = [];
    };

    if (forecastLayer === "precipitation") {
      if (!modelInitUtc || !latestObservedAt) return;

      const bounds = map.getBounds();
      const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
      const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
      const size = map.getSize();
      if (size.x < 100 || size.y < 100) return;
      const scale = Math.max(1, Math.min(3, 1800 / size.x, 1800 / size.y));
      const params = new URLSearchParams({
        bbox: `${sw.x},${sw.y},${ne.x},${ne.y}`,
        width: String(Math.round(size.x * scale)),
        height: String(Math.round(size.y * scale)),
        time: latestObservedAt,
      });

      if (relative <= 45) {
        let overlayBounds = bounds;
        const shift = motionShift(evolution, relative);
        if (shift) {
          const s = shiftedPoint(bounds.getSouth(), bounds.getWest(), shift.bearing, shift.miles);
          const n = shiftedPoint(bounds.getNorth(), bounds.getEast(), shift.bearing, shift.miles);
          overlayBounds = L.latLngBounds(L.latLng(s[0], s[1]), L.latLng(n[0], n[1]));
        }

        const live: any = L.imageOverlay(`/api/radar/image?${params}`, overlayBounds, { opacity: 0, pane: "nowcast", interactive: false }).addTo(map);
        pending.push(live);
        opacityTargets.set(live, 0.78);

        if (relative > 0) {
          const frame = String(frameMinutes).padStart(4, "0");
          const run = iemRunId(modelInitUtc);
          const model: any = L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFP-F${frame}-${run}/{z}/{x}/{y}.png`, {
            pane: "weather",
            opacity: 0,
            maxZoom: 12,
            attribution: "HRRR via Iowa Environmental Mesonet",
          }).addTo(map);
          pending.unshift(model);
          opacityTargets.set(model, 0.28);
        }

        pendingLayersRef.current = [...pending];
        let done = false;
        const ready = () => {
          if (done) return;
          done = true;
          promote();
        };
        live.once("load", ready);
        const fallback = window.setTimeout(ready, 1000);
        return () => {
          window.clearTimeout(fallback);
          live.off("load", ready);
          if (token !== renderTokenRef.current) removeLayers(pending);
        };
      }

      const frame = String(frameMinutes).padStart(4, "0");
      const run = iemRunId(modelInitUtc);
      const model: any = L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFP-F${frame}-${run}/{z}/{x}/{y}.png`, {
        pane: "weather",
        opacity: 0,
        maxZoom: 12,
        attribution: "HRRR via Iowa Environmental Mesonet",
      }).addTo(map);
      pending.push(model);
      opacityTargets.set(model, 0.82);
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

    if (!modelInitUtc) return;
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
    opacityTargets.set(image, 0.9);
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
  }, [forecastMinutes, frameIndex, forecastLayer, mapReady, modelInitUtc, latestObservedAt, evolution, viewRevision, tabActive, removeLayers]);

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

  const sourceLabel = forecastLayer === "precipitation"
    ? (relativeMinutes === 0 ? "Live MRMS observation" : relativeMinutes <= 45 ? "Radar-motion nowcast + HRRR" : "HRRR forecast")
    : "HRRR cloud forecast";

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
          <strong>{frameIndex === 0 ? "Current" : validTimeLabel(modelInitUtc, displayMinutes)}</strong>
          <span>{relativeLabel(relativeMinutes)} · {sourceLabel} · {runLabel(modelInitUtc)}</span>
        </div>
      </div>
      <div className="radarControls">
        <button type="button" onClick={() => setPlaying((v) => !v)}><span>{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}</button>
        <input type="range" min="0" max={forecastMinutes.length - 1} value={frameIndex} step={forecastLayer === "clouds" ? 4 : 1} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} />
        <button type="button" className="newestButton" onClick={() => { setPlaying(false); setFrameIndex(0); }}>Current</button>
      </div>
      <p className="radarSource">{forecastLayer === "precipitation" ? "Current is live NOAA/NWS MRMS. The first 45 minutes use discrete radar-motion nowcast frames with HRRR guidance; the live image is no longer faded across future frames." : "NOAA/NCEP HRRR total cloud cover via NOMADS · hourly cloud fields · model guidance"}</p>
    </div>
  );
}
