"use client";

import type * as Leaflet from "leaflet";
import type { Map as LeafletMap, TileLayer } from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";

type RadarFrame = { id: string; observedAt: string; epochSeconds: number };
type RadarPayload = { frames: RadarFrame[] };
const LOCAL_TARGET: [number, number] = [41.8382, -87.6331];

function frameLabel(value?: string) {
  if (!value) return "Waiting for NOAA";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export default function RadarMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const radarLayerRef = useRef<TileLayer.WMS | null>(null);
  const frameIndexRef = useRef(0);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [touchMap, setTouchMap] = useState(false);
  const [mapInteraction, setMapInteraction] = useState(false);

  useEffect(() => { frameIndexRef.current = frameIndex; }, [frameIndex]);

  const loadFrames = useCallback(async () => {
    try {
      const response = await fetch("/api/radar/frames", { cache: "no-store" });
      if (!response.ok) throw new Error("Radar metadata unavailable");
      const payload = (await response.json()) as RadarPayload;
      if (!payload.frames.length) throw new Error("No radar frames available");
      setFrames((current) => {
        const currentId = current[frameIndexRef.current]?.id;
        const retainedIndex = payload.frames.findIndex((frame) => frame.id === currentId);
        setFrameIndex(retainedIndex >= 0 ? retainedIndex : payload.frames.length - 1);
        return payload.frames;
      });
      setStatus("ready");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => {
    void loadFrames();
    const refresh = window.setInterval(loadFrames, 60_000);
    return () => window.clearInterval(refresh);
  }, [loadFrames]);

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
      L.circle(LOCAL_TARGET, { radius: 900, color: "#ff7185", weight: 1, fillColor: "#ff4d67", fillOpacity: 0.06, dashArray: "5 6" }).addTo(map);
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
      window.requestAnimationFrame(() => mapRef.current?.invalidateSize(false));
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
    if (!map || !L || !frame || !mapReady) return;

    const previousLayer = radarLayerRef.current;
    const nextLayer = L.tileLayer.wms("/api/radar/image", {
      layers: "conus_bref_qcd",
      format: "image/png",
      transparent: true,
      opacity: 0,
      time: frame.observedAt,
      zIndex: 400,
      tileSize: 256,
      updateWhenIdle: true,
      keepBuffer: 2,
    } as L.WMSOptions).addTo(map);

    let promoted = false;
    const promote = () => {
      if (promoted) return;
      promoted = true;
      nextLayer.setOpacity(0.72);
      radarLayerRef.current = nextLayer;
      if (previousLayer && previousLayer !== nextLayer && map.hasLayer(previousLayer)) map.removeLayer(previousLayer);
    };

    nextLayer.once("load", promote);

    return () => {
      nextLayer.off("load", promote);
      if (radarLayerRef.current !== nextLayer && map.hasLayer(nextLayer)) map.removeLayer(nextLayer);
    };
  }, [frames, frameIndex, mapReady]);

  useEffect(() => {
    if (!playing || frames.length < 2 || mapInteraction) return;
    const timer = window.setInterval(() => setFrameIndex((index) => (index + 1) % frames.length), 1800);
    return () => window.clearInterval(timer);
  }, [playing, frames.length, mapInteraction]);

  const currentFrame = frames[frameIndex];
  const isNewest = frameIndex === frames.length - 1;
  const toggleMapInteraction = () => {
    if (!mapInteraction) setPlaying(false);
    setMapInteraction((value) => !value);
  };

  return (
    <section className="radarSection" id="radar" aria-labelledby="radar-heading">
      <div className="sectionTitle radarHeading"><div><p className="kicker">LIVE OBSERVATIONS</p><h2 id="radar-heading">Bridgeport radar</h2></div><span className={`radarFreshness ${status}`}>{status === "ready" ? "NOAA LIVE" : status.toUpperCase()}</span></div>
      <div className="radarShell">
        <div ref={containerRef} className={`radarMap ${touchMap ? (mapInteraction ? "mapTouchActive" : "mapTouchScroll") : ""}`} aria-label="Interactive NOAA radar map centered on Bridgeport, Chicago" />
        {touchMap && <button type="button" className="mapInteractionButton" onClick={toggleMapInteraction}>{mapInteraction ? "Done" : "Move map"}</button>}
        <div className="radarReadout" aria-live="polite"><strong>{frameLabel(currentFrame?.observedAt)}</strong><span>{isNewest ? "Newest observation" : `${Math.max(0, frames.length - 1 - frameIndex)} frames before newest`}</span></div>
      </div>
      <div className="radarControls">
        <button type="button" onClick={() => setPlaying((value) => !value)} disabled={status !== "ready"} aria-label={playing ? "Pause radar animation" : "Play radar animation"}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Pause" : "Play"}</button>
        <input type="range" min="0" max={Math.max(0, frames.length - 1)} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} disabled={!frames.length} aria-label="Radar observation timeline" />
        <button type="button" className="newestButton" onClick={() => { setPlaying(false); setFrameIndex(Math.max(0, frames.length - 1)); }} disabled={!frames.length || isNewest}>Current Radar</button>
      </div>
      {status === "error" && <p className="radarError">NOAA radar is temporarily unavailable. The app will retry automatically.</p>}
      <p className="radarSource">NOAA/NWS MRMS quality-controlled base reflectivity · actual observations · typically updates about every 2 minutes</p>
    </section>
  );
}
