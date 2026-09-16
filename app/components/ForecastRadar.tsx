"use client";
import type * as Leaflet from "leaflet";
import type { Layer, Map as LeafletMap } from "leaflet";
import { useEffect,useMemo,useRef,useState } from "react";

const LOCAL_TARGET:[number,number]=[41.8382,-87.6331];
const BASEMAP="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const BASEMAP_ATTRIBUTION="&copy; OpenStreetMap contributors";
const FORECAST_STEP_MINUTES=15;
const FORECAST_WINDOW_MINUTES=360;
const FADE_MS=360;

type MetaPayload={modelInitUtc:string|null};
type ForecastLayer="precipitation"|"clouds";

function timeLabel(value:string){return new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(value))}
function validTimeLabel(init:string|null,min:number){if(!init)return min===0?"Model analysis":`Forecast +${min} min`;return timeLabel(new Date(Date.parse(init)+min*60000).toISOString())}
function runLabel(init:string|null){return init?`Run ${timeLabel(init)}`:"Latest HRRR run"}
function checkedLabel(value:string|null){return value?`Forecast data checked ${timeLabel(value)}`:"Checking forecast update time…"}
function relativeLabel(m:number){if(m===0)return"Current";const h=Math.floor(m/60),r=m%60;return!h?`+${r} min`:!r?`+${h} hr`:`+${h} hr ${r} min`}
function iemRunId(v:string){const d=new Date(v);return`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCHours()).padStart(2,"0")}00`}
function fadeLayer(layer:any,target:number){const started=performance.now();const tick=(now:number)=>{const p=Math.min(1,(now-started)/FADE_MS);layer.setOpacity?.(target*p);if(p<1)requestAnimationFrame(tick)};requestAnimationFrame(tick)}

export default function ForecastRadar(){
 const containerRef=useRef<HTMLDivElement>(null),mapRef=useRef<LeafletMap|null>(null),leafletRef=useRef<typeof Leaflet|null>(null),modelRef=useRef<Layer|null>(null),renderTokenRef=useRef(0);
 const [frameIndex,setFrameIndex]=useState(0),[playing,setPlaying]=useState(false),[forecastLayer,setForecastLayer]=useState<ForecastLayer>("precipitation"),[mapReady,setMapReady]=useState(false),[modelInitUtc,setModelInitUtc]=useState<string|null>(null),[checkedAt,setCheckedAt]=useState<string|null>(null),[touchMap,setTouchMap]=useState(false),[mapInteraction,setMapInteraction]=useState(false),[viewRevision,setViewRevision]=useState(0);

 useEffect(()=>{let active=true;async function load(){try{const m=await fetch("/api/forecast-radar/meta",{cache:"no-store"});const mp=(m.ok?await m.json():null) as MetaPayload|null;if(active){setModelInitUtc(mp?.modelInitUtc??null);if(m.ok)setCheckedAt(new Date().toISOString())}}catch{}}void load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer)}},[]);

 const forecastMinutes=useMemo(()=>{const count=FORECAST_WINDOW_MINUTES/FORECAST_STEP_MINUTES+1;if(!modelInitUtc)return Array.from({length:count},(_,i)=>i*FORECAST_STEP_MINUTES);const age=Math.max(0,Math.floor((Date.now()-Date.parse(modelInitUtc))/(FORECAST_STEP_MINUTES*60000))*FORECAST_STEP_MINUTES),start=Math.min(age,720);return Array.from({length:count},(_,i)=>start+i*FORECAST_STEP_MINUTES)},[modelInitUtc]);
 useEffect(()=>{setFrameIndex(0);setPlaying(false)},[modelInitUtc]);

 useEffect(()=>{let active=true;void import("leaflet").then(module=>{if(!active||!containerRef.current||mapRef.current)return;const L=module.default;leafletRef.current=L;const map=L.map(containerRef.current,{zoomControl:true,attributionControl:true}).setView(LOCAL_TARGET,8);map.createPane("weather");map.getPane("weather")!.style.zIndex="400";map.getPane("weather")!.style.pointerEvents="none";const isTouch=matchMedia("(pointer: coarse)").matches;if(isTouch)map.dragging.disable();setTouchMap(isTouch);L.tileLayer(BASEMAP,{maxZoom:19,attribution:BASEMAP_ATTRIBUTION}).addTo(map);L.circleMarker(LOCAL_TARGET,{radius:8,color:"#fff",weight:2,fillColor:"#ff4d67",fillOpacity:1}).bindTooltip("Bridgeport",{direction:"top"}).addTo(map);map.on("moveend zoomend",()=>setViewRevision(v=>v+1));mapRef.current=map;setMapReady(true)});return()=>{active=false;mapRef.current?.remove();mapRef.current=null}},[]);
 useEffect(()=>{if(!containerRef.current)return;const o=new ResizeObserver(e=>{const r=e[0]?.contentRect;if(!r||r.width<100||r.height<100)return;requestAnimationFrame(()=>{mapRef.current?.invalidateSize(false);setViewRevision(v=>v+1)})});o.observe(containerRef.current);return()=>o.disconnect()},[]);
 useEffect(()=>{const map=mapRef.current;if(!map||!touchMap)return;mapInteraction?map.dragging.enable():map.dragging.disable()},[mapInteraction,touchMap]);

 useEffect(()=>{const map=mapRef.current,L=leafletRef.current;if(!map||!L||!mapReady||!modelInitUtc)return;const token=++renderTokenRef.current,frameMinutes=forecastMinutes[frameIndex];
  const promote=(next:Layer,targetOpacity:number)=>{if(token!==renderTokenRef.current){if(map.hasLayer(next))map.removeLayer(next);return}const old=modelRef.current;modelRef.current=next;fadeLayer(next,targetOpacity);window.setTimeout(()=>{if(old&&old!==next&&map.hasLayer(old))map.removeLayer(old)},FADE_MS+80)};
  if(forecastLayer==="precipitation"){const frame=String(frameMinutes).padStart(4,"0"),run=iemRunId(modelInitUtc),tile:any=L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFP-F${frame}-${run}/{z}/{x}/{y}.png`,{pane:"weather",opacity:0,maxZoom:12,attribution:"HRRR via Iowa Environmental Mesonet"}).addTo(map);let promoted=false;const ready=()=>{if(promoted)return;promoted=true;promote(tile,.82)};tile.once("load",ready);window.setTimeout(ready,1100);return()=>{tile.off("load",ready);if(token!==renderTokenRef.current&&map.hasLayer(tile))map.removeLayer(tile)}}
  const bounds=map.getBounds(),sw=L.CRS.EPSG3857.project(bounds.getSouthWest()),ne=L.CRS.EPSG3857.project(bounds.getNorthEast()),size=map.getSize();if(size.x<100||size.y<100)return;const params=new URLSearchParams({bbox:`${sw.x},${sw.y},${ne.x},${ne.y}`,width:String(size.x),height:String(size.y),modelInitUtc,forecastMinutes:String(frameMinutes)});const image:any=L.imageOverlay(`/api/forecast-cloud/image?${params}`,bounds,{opacity:0,pane:"weather",interactive:false}).addTo(map);let promoted=false;const ready=()=>{if(promoted)return;promoted=true;promote(image,.9)};image.once("load",ready);window.setTimeout(ready,1100);return()=>{image.off("load",ready);if(token!==renderTokenRef.current&&map.hasLayer(image))map.removeLayer(image)}
 },[forecastMinutes,frameIndex,forecastLayer,mapReady,modelInitUtc,viewRevision]);

 useEffect(()=>{if(!playing||mapInteraction||forecastMinutes.length<2)return;const step=forecastLayer==="clouds"?4:1,delay=forecastLayer==="clouds"?1450:1050;let timer:number;const advance=()=>{setFrameIndex(i=>{const next=i+step;return next>=forecastMinutes.length?0:next});timer=window.setTimeout(advance,delay)};timer=window.setTimeout(advance,delay);return()=>window.clearTimeout(timer)},[forecastMinutes.length,playing,mapInteraction,forecastLayer]);

 const frameMinutes=forecastMinutes[frameIndex],displayMinutes=forecastLayer==="clouds"?Math.round(frameMinutes/60)*60:frameMinutes,relativeMinutes=Math.max(0,displayMinutes-forecastMinutes[0]);
 const setLayer=(layer:ForecastLayer)=>{setPlaying(false);setForecastLayer(layer);if(layer==="clouds")setFrameIndex(Math.min(forecastMinutes.length-1,Math.round(frameIndex/4)*4))};

 return <div className="forecastRadarPlayer"><p className="radarSource" style={{margin:"0 2px 10px"}}>{runLabel(modelInitUtc)} · {checkedLabel(checkedAt)}</p><div className="weatherLayerToggle"><button type="button" className={forecastLayer==="precipitation"?"active":""} onClick={()=>setLayer("precipitation")}>Precipitation</button><button type="button" className={forecastLayer==="clouds"?"active":""} onClick={()=>setLayer("clouds")}>Cloud Cover</button></div><div className="radarShell forecastRadarShell"><div ref={containerRef} className={`radarMap forecastRadarMap ${touchMap?(mapInteraction?"mapTouchActive":"mapTouchScroll"):""}`}/>{touchMap&&<button type="button" className="mapInteractionButton" onClick={()=>{if(!mapInteraction)setPlaying(false);setMapInteraction(v=>!v)}}>{mapInteraction?"Done":"Move map"}</button>}<div className="radarReadout"><strong>{validTimeLabel(modelInitUtc,displayMinutes)}</strong><span>{relativeLabel(relativeMinutes)} · HRRR forecast · {runLabel(modelInitUtc)}</span></div></div><div className="radarControls"><button type="button" onClick={()=>setPlaying(v=>!v)}><span>{playing?"Ⅱ":"▶"}</span> {playing?"Pause":"Play"}</button><input type="range" min="0" max={forecastMinutes.length-1} value={frameIndex} step={forecastLayer==="clouds"?4:1} onChange={e=>{setPlaying(false);setFrameIndex(Number(e.target.value))}}/><button type="button" className="newestButton" onClick={()=>{setPlaying(false);setFrameIndex(forecastMinutes.length-1)}}>+6 hr</button></div><p className="radarSource">{forecastLayer==="precipitation"?"NOAA/NCEP HRRR composite reflectivity forecast via Iowa Environmental Mesonet · 15-minute forecast steps":"NOAA/NCEP HRRR total cloud cover via NOMADS · hourly cloud fields · model guidance"}</p></div>
}
