"use client";

import type * as Leaflet from "leaflet";
import type { ImageOverlay, Map as LeafletMap } from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";

type RadarFrame = { id: string; observedAt: string; epochSeconds: number };
type RadarPayload = { frames: RadarFrame[] };
type LiveLayer = "precipitation" | "clouds";

const LOCAL_TARGET: [number, number] = [41.8382, -87.6331];
const DEFAULT_ZOOM = 8;
const BASEMAP = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const BASEMAP_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const GOES_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/goes_east.cgi";

function frameLabel(value?: string) {
  if (!value) return "Waiting for NOAA";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export default function RadarMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const currentOverlayRef = useRef<ImageOverlay | null>(null);
  const pendingOverlayRef = useRef<ImageOverlay | null>(null);
  const renderTokenRef = useRef(0);
  const frameIndexRef = useRef(0);
  const framesLengthRef = useRef(0);

  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [liveLayer, setLiveLayer] = useState<LiveLayer>("precipitation");
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [touchMap, setTouchMap] = useState(false);
  const [mapInteraction, setMapInteraction] = useState(false);
  const [viewRevision, setViewRevision] = useState(0);
  const [cloudRevision, setCloudRevision] = useState(0);

  useEffect(() => { frameIndexRef.current = frameIndex; }, [frameIndex]);
  useEffect(() => { framesLengthRef.current = frames.length; }, [frames.length]);

  const removeOverlay = useCallback((overlay: ImageOverlay | null) => {
    const map = mapRef.current;
    if (map && overlay && map.hasLayer(overlay)) map.removeLayer(overlay);
  }, []);

  const clearWeatherOverlays = useCallback(() => {
    renderTokenRef.current += 1;
    removeOverlay(pendingOverlayRef.current);
    removeOverlay(currentOverlayRef.current);
    pendingOverlayRef.current = null;
    currentOverlayRef.current = null;
  }, [removeOverlay]);

  const resetLiveView = useCallback(() => {
    setPlaying(false);
    setMapInteraction(false);
    setFrameIndex(Math.max(0, framesLengthRef.current - 1));
    clearWeatherOverlays();
    const map = mapRef.current;
    if (!map) return;
    map.setView(LOCAL_TARGET, DEFAULT_ZOOM, { animate: false });
    window.requestAnimationFrame(() => {
      map.invalidateSize(false);
      setViewRevision((value) => value + 1);
    });
  }, [clearWeatherOverlays]);

  const loadFrames = useCallback(async () => {
    try {
      const response = await fetch(`/api/radar/frames?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Radar metadata unavailable");
      const payload = (await response.json()) as RadarPayload;
      if (!payload.frames.length) throw new Error("No radar frames available");
      framesLengthRef.current = payload.frames.length;
      setFrames((current) => {
        const currentId = current[frameIndexRef.current]?.id;
        const retainedIndex = payload.frames.findIndex((frame) => frame.id === currentId);
        setFrameIndex(retainedIndex >= 0 ? retainedIndex : payload.frames.length - 1);
        return payload.frames;
      });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadFrames();
    const refresh = window.setInterval(loadFrames, 60_000);
    return () => window.clearInterval(refresh);
  }, [loadFrames]);

  useEffect(() => {
    const input = document.getElementById("tab-live") as HTMLInputElement | null;
    if (!input) return;
    const sync = () => {
      if (!input.checked) {
        setPlaying(false);
        return;
      }
      resetLiveView();
    };
    sync();
    input.addEventListener("change", sync);
    return () => input.removeEventListener("change", sync);
  }, [resetLiveView]);

  useEffect(() => {
    if (liveLayer !== "clouds") return;
    const refresh = window.setInterval(() => setCloudRevision((value) => value + 1), 60_000);
    return () => window.clearInterval(refresh);
  }, [liveLayer]);

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
      const isTouch = window.matchMedia("(pointer: coarse)").matches;
      if (isTouch) map.dragging.disable();
      setTouchMap(isTouch);
      L.tileLayer(BASEMAP, { maxZoom: 19, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
      L.circleMarker(LOCAL_TARGET, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff4d67", fillOpacity: 1 }).bindTooltip("Bridgeport", { direction: "top" }).addTo(map);
      L.circle(LOCAL_TARGET, { radius: 900, color: "#ff7185", weight: 1, fillColor: "#ff4d67", fillOpacity: 0.06, dashArray: "5 6" }).addTo(map);
      map.on("moveend zoomend", () => setViewRevision((value) => value + 1));
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
      currentOverlayRef.current = null;
      pendingOverlayRef.current = null;
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
    const frame = frames[frameIndex];
    if (!map || !L || !mapReady || (liveLayer === "precipitation" && !frame)) return;

    const bounds = map.getBounds();
    const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
    const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
    const size = map.getSize();
    if (size.x < 100 || size.y < 100) return;

    const scale = Math.max(1, Math.min(3, 1800 / size.x, 1800 / size.y));
    const width = Math.round(size.x * scale);
    const height = Math.round(size.y * scale);

    let url: string;
    let opacity: number;
    if (liveLayer === "clouds") {
      const params = new URLSearchParams({
        SERVICE: "WMS",
        VERSION: "1.1.1",
        REQUEST: "GetMap",
        LAYERS: "conus_ch13",
        STYLES: "",
        FORMAT: "image/png",
        TRANSPARENT: "true",
        SRS: "EPSG:3857",
        BBOX: `${sw.x},${sw.y},${ne.x},${ne.y}`,
        WIDTH: String(width),
        HEIGHT: String(height),
        _: String(cloudRevision),
      });
      url = `${GOES_WMS}?${params.toString()}`;
      opacity = 0.72;
    } else {
      const params = new URLSearchParams({
        bbox: `${sw.x},${sw.y},${ne.x},${ne.y}`,
        width: String(width),
        height: String(height),
      });
      // For the newest frame, let NOAA render its current layer directly instead
      // of pinning the image to a capabilities timestamp that can briefly lag the
      // image service. Historical frames still request their exact observation.
      const newestFrame = frameIndex === frames.length - 1;
      if (!newestFrame) params.set("time", frame.observedAt);
      else params.set("latest", String(Date.now()));
      url = `/api/radar/image?${params.toString()}`;
      opacity = 0.58;
    }

    const token = ++renderTokenRef.current;
    removeOverlay(pendingOverlayRef.current);

    const next = L.imageOverlay(url, bounds, { opacity: 0, pane: "weather", interactive: false }).addTo(map);
    pendingOverlayRef.current = next;
    let settled = false;

    const promote = () => {
      if (settled) return;
      settled = true;
      if (token !== renderTokenRef.current) {
        removeOverlay(next);
        if (pendingOverlayRef.current === next) pendingOverlayRef.current = null;
        return;
      }

      next.setOpacity(opacity);
      const previous = currentOverlayRef.current;
      currentOverlayRef.current = next;
      pendingOverlayRef.current = null;
      if (previous && previous !== next) removeOverlay(previous);
    };

    const discard = () => {
      if (settled) return;
      settled = true;
      removeOverlay(next);
      if (pendingOverlayRef.current === next) pendingOverlayRef.current = null;
    };

    next.once("load", promote);
    next.once("error", discard);

    return () => {
      next.off("load", promote);
      next.off("error", discard);
      if (pendingOverlayRef.current === next) {
        removeOverlay(next);
        pendingOverlayRef.current = null;
      }
    };
  }, [frames, frameIndex, liveLayer, mapReady, viewRevision, cloudRevision, removeOverlay]);

  useEffect(() => {
    if (liveLayer !== "precipitation" || !playing || frames.length < 2 || mapInteraction) return;
    const timer = window.setInterval(() => setFrameIndex((index) => (index + 1) % frames.length), 1800);
    return () => window.clearInterval(timer);
  }, [playing, frames.length, mapInteraction, liveLayer]);

  const currentFrame = frames[frameIndex];
  const isNewest = frameIndex === frames.length - 1;

  const setLayer = (layer: LiveLayer) => {
    if (layer === liveLayer) return;
    setPlaying(false);
    setMapInteraction(false);
    setFrameIndex(Math.max(0, framesLengthRef.current - 1));
    clearWeatherOverlays();
    setLiveLayer(layer);
    if (layer === "clouds") setCloudRevision((value) => value + 1);

    const map = mapRef.current;
    if (map) {
      map.setView(LOCAL_TARGET, DEFAULT_ZOOM, { animate: false });
      window.requestAnimationFrame(() => {
        map.invalidateSize(false);
        setViewRevision((value) => value + 1);
      });
    }
  };

  const toggleMapInteraction = () => {
    if (!mapInteraction) setPlaying(false);
    setMapInteraction((value) => !value);
  };

  return (
    <section className="radarSection" id="radar" aria-labelledby="radar-heading">
      <div className="sectionTitle radarHeading"><div><p className="kicker">LIVE OBSERVATIONS</p><h2 id="radar-heading">Bridgeport radar</h2></div><span className={`radarFreshness ${status}`}>{status === "ready" ? "NOAA LIVE" : status.toUpperCase()}</span></div>
      <div className="weatherLayerToggle" role="group" aria-label="Live weather layer">
        <button type="button" className={liveLayer === "precipitation" ? "active" : ""} onClick={() => setLayer("precipitation")}>Precipitation</button>
        <button type="button" className={liveLayer === "clouds" ? "active" : ""} onClick={() => setLayer("clouds")}>Cloud Cover</button>
      </div>
      <div className="radarShell">
        <div ref={containerRef} className={`radarMap ${touchMap ? (mapInteraction ? "mapTouchActive" : "mapTouchScroll") : ""}`} aria-label={`Interactive ${liveLayer === "precipitation" ? "NOAA precipitation radar" : "GOES-East infrared cloud"} map centered on Bridgeport, Chicago`} />
        {touchMap && <button type="button" className="mapInteractionButton" onClick={toggleMapInteraction}>{mapInteraction ? "Done" : "Move map"}</button>}
        <div className="radarReadout" aria-live="polite">
          {liveLayer === "precipitation" ? <><strong>{frameLabel(currentFrame?.observedAt)}</strong><span>{isNewest ? "Newest observation" : `${Math.max(0, frames.length - 1 - frameIndex)} frames before newest`}</span></> : <><strong>Current cloud cover</strong><span>GOES-East infrared · day/night</span></>}
        </div>
      </div>
      {liveLayer === "precipitation" ? (
        <div className="radarControls">
          <button type="button" onClick={() => setPlaying((value) => !value)} disabled={status !== "ready"} aria-label={playing ? "Pause radar animation" : "Play radar animation"}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}</button>
          <input type="range" min="0" max={Math.max(0, frames.length - 1)} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} disabled={!frames.length} aria-label="Radar observation timeline" />
          <button type="button" className="newestButton" onClick={() => { setPlaying(false); setFrameIndex(Math.max(0, frames.length - 1)); }} disabled={!frames.length || isNewest}>Current Radar</button>
        </div>
      ) : <div className="cloudLayerNote">Latest GOES-East infrared image · refreshes automatically</div>}
      {status === "error" && liveLayer === "precipitation" && <p className="radarError">NOAA radar is temporarily unavailable. The app will retry automatically.</p>}
      <p className="radarSource">{liveLayer === "precipitation" ? "NOAA/NWS MRMS quality-controlled base reflectivity · high-resolution observed radar · typically updates about every 2 minutes" : "NOAA GOES-East infrared Channel 13 via Iowa Environmental Mesonet · near-real-time cloud-top imagery · available day and night"}</p>
    </section>
  );
}
