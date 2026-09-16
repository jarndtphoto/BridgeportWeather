"use client";
import type * as Leaflet from "leaflet";
import type { Layer, Map as LeafletMap } from "leaflet";
import { useEffect,useMemo,useRef,useState } from "react";

const LOCAL_TARGET:[number,number]=[41.8382,-87.6331];
const BASEMAP="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const BASEMAP_ATTRIBUTION="&copy; OpenStreetMap contributors";
const FORECAST_STEP_MINUTES=15;
const FORECAST_WINDOW_MINUTES=360;
const FADE_MS=260;

type MetaPayload={modelInitUtc:string|null};
type ForecastLayer="precipitation"|"clouds";
type RadarFrame={observedAt:string};
type Motion="approaching"|"movingAway"|"passingNearby"|"stationaryOrUnclear"|"unknown";
type Evolution={motion:Motion;strongestSector:string|null;comparisonMinutes:number|null};

function timeLabel(value:string){return new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(value))}
function validTimeLabel(init:string|null,min:number){if(!init)return min===0?"Current":"Forecast";return timeLabel(new Date(Date.parse(init)+min*60000).toISOString())}
function runLabel(init:string|null){return init?`Run ${timeLabel(init)}`:"Latest HRRR run"}
function checkedLabel(value:string|null){return value?`Forecast data checked ${timeLabel(value)}`:"Checking forecast update time…"}
function relativeLabel(m:number){if(m===0)return"Current";const h=Math.floor(m/60),r=m%60;return!h?`+${r} min`:!r?`+${h} hr`:`+${h} hr ${r} min`}
function iemRunId(v:string){const d=new Date(v);return`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCHours()).padStart(2,"0")}00`}
function fadeLayer(layer:any,target:number){const started=performance.now();const tick=(now:number)=>{const p=Math.min(1,(now-started)/FADE_MS);layer.setOpacity?.(target*p);if(p<1)requestAnimationFrame(tick)};requestAnimationFrame(tick)}
function sectorBearing(label:string|null){return({N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315} as Record<string,number>)[label??""]??null}
function shiftedPoint(lat:number,lon:number,bearingDeg:number,miles:number){const r=3958.8,a=miles/r,b=bearingDeg*Math.PI/180,lat1=lat*Math.PI/180,lon1=lon*Math.PI/180;const lat2=Math.asin(Math.sin(lat1)*Math.cos(a)+Math.cos(lat1)*Math.sin(a)*Math.cos(b));const lon2=lon1+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(lat1),Math.cos(a)-Math.sin(lat1)*Math.sin(lat2));return[lat2*180/Math.PI,lon2*180/Math.PI] as [number,number]}
function nowcastWeight(relative:number){if(relative<=0)return 1;if(relative<=15)return .78;if(relative<=30)return .52;if(relative<=45)return .28;return 0}
function motionShift(evolution:Evolution|null,relative:number){if(!evolution||relative<=0||relative>45)return null;const sector=sectorBearing(evolution.strongestSector);if(sector===null)return null;let bearing:number|null=null;if(evolution.motion==="approaching")bearing=(sector+180)%360;else if(evolution.motion==="movingAway")bearing=sector;else return null;const comparison=evolution.comparisonMinutes&&evolution.comparisonMinutes>0?evolution.comparisonMinutes:10;const mph=Math.max(8,Math.min(40,(4/comparison)*60));return{bearing,miles:mph*(relative/60)}}

export default function ForecastRadar(){
 const containerRef=useRef<HTMLDivElement>(null),mapRef=useRef<LeafletMap|null>(null),leafletRef=useRef<typeof Leaflet|null>(null),modelRef=useRef<Layer|null>(null),observedRef=useRef<Layer|null>(null),renderTokenRef=useRef(0);
 const [frameIndex,setFrameIndex]=useState(0),[playing,setPlaying]=useState(false),[forecastLayer,setForecastLayer]=useState<ForecastLayer>("precipitation"),[mapReady,setMapReady]=useState(false),[modelInitUtc,setModelInitUtc]=useState<string|null>(null),[latestObservedAt,setLatestObservedAt]=useState<string|null>(null),[evolution,setEvolution]=useState<Evolution|null>(null),[checkedAt,setCheckedAt]=useState<string|null>(null),[touchMap,setTouchMap]=useState(false),[mapInteraction,setMapInteraction]=useState(false),[viewRevision,setViewRevision]=useState(0),[tabActive,setTabActive]=useState(false);

 useEffect(()=>{let active=true;async function load(){try{const [m,r,t]=await Promise.all([fetch(`/api/forecast-radar/meta?t=${Date.now()}`,{cache:"no-store"}),fetch(`/api/radar/frames?t=${Date.now()}`,{cache:"no-store"}),fetch(`/api/threat?t=${Date.now()}`,{cache:"no-store"})]);const mp=(m.ok?await m.json():null) as MetaPayload|null;const rp=r.ok?await r.json() as {frames:RadarFrame[]}:null;const tp=t.ok?await t.json() as {evolution?:Evolution}:null;if(active){setModelInitUtc(mp?.modelInitUtc??null);setLatestObservedAt(rp?.frames?.at(-1)?.observedAt??null);setEvolution(tp?.evolution??null);if(m.ok)setCheckedAt(new Date().toISOString())}}catch{}}void load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer)}},[]);

 const forecastMinutes=useMemo(()=>{const count=FORECAST_WINDOW_MINUTES/FORECAST_STEP_MINUTES+1;if(!modelInitUtc)return Array.from({length:count},(_,i)=>i*FORECAST_STEP_MINUTES);const ageMinutes=Math.max(0,(Date.now()-Date.parse(modelInitUtc))/60000),start=Math.max(0,Math.ceil(ageMinutes/FORECAST_STEP_MINUTES)*FORECAST_STEP_MINUTES);return Array.from({length:count},(_,i)=>start+i*FORECAST_STEP_MINUTES)},[modelInitUtc]);
 useEffect(()=>{setFrameIndex(0);setPlaying(false)},[modelInitUtc]);

 useEffect(()=>{const input=document.getElementById("tab-future") as HTMLInputElement|null;if(!input)return;const sync=()=>{const active=input.checked;setTabActive(active);if(active){setPlaying(false);setFrameIndex(0);requestAnimationFrame(()=>{mapRef.current?.invalidateSize(false);setViewRevision(v=>v+1)})}else setPlaying(false)};sync();input.addEventListener("change",sync);document.addEventListener("visibilitychange",sync);return()=>{input.removeEventListener("change",sync);document.removeEventListener("visibilitychange",sync)}},[]);

 useEffect(()=>{let active=true;void import("leaflet").then(module=>{if(!active||!containerRef.current||mapRef.current)return;const L=module.default;leafletRef.current=L;const map=L.map(containerRef.current,{zoomControl:true,attributionControl:true}).setView(LOCAL_TARGET,8);map.createPane("weather");map.getPane("weather")!.style.zIndex="400";map.getPane("weather")!.style.pointerEvents="none";map.createPane("nowcast");map.getPane("nowcast")!.style.zIndex="410";map.getPane("nowcast")!.style.pointerEvents="none";const isTouch=matchMedia("(pointer: coarse)").matches;if(isTouch)map.dragging.disable();setTouchMap(isTouch);L.tileLayer(BASEMAP,{maxZoom:19,attribution:BASEMAP_ATTRIBUTION}).addTo(map);L.circleMarker(LOCAL_TARGET,{radius:8,color:"#fff",weight:2,fillColor:"#ff4d67",fillOpacity:1}).bindTooltip("Bridgeport",{direction:"top"}).addTo(map);map.on("moveend zoomend",()=>setViewRevision(v=>v+1));mapRef.current=map;setMapReady(true)});return()=>{active=false;mapRef.current?.remove();mapRef.current=null}},[]);
 useEffect(()=>{if(!containerRef.current)return;const o=new ResizeObserver(e=>{const r=e[0]?.contentRect;if(!r||r.width<100||r.height<100)return;requestAnimationFrame(()=>{mapRef.current?.invalidateSize(false);setViewRevision(v=>v+1)})});o.observe(containerRef.current);return()=>o.disconnect()},[]);
 useEffect(()=>{const map=mapRef.current;if(!map||!touchMap)return;mapInteraction?map.dragging.enable():map.dragging.disable()},[mapInteraction,touchMap]);

 useEffect(()=>{const map=mapRef.current,L=leafletRef.current;if(!map||!L||!mapReady||!tabActive)return;const token=++renderTokenRef.current,frameMinutes=forecastMinutes[frameIndex],relative=Math.max(0,frameMinutes-forecastMinutes[0]);
  const removeLater=(layer:Layer|null)=>{if(layer)window.setTimeout(()=>{if(map.hasLayer(layer))map.removeLayer(layer)},FADE_MS+70)};
  const promote=(next:Layer,targetOpacity:number,ref:"model"|"observed")=>{if(token!==renderTokenRef.current){if(map.hasLayer(next))map.removeLayer(next);return}const old=ref==="model"?modelRef.current:observedRef.current;if(ref==="model")modelRef.current=next;else observedRef.current=next;fadeLayer(next,targetOpacity);removeLater(old)};

  if(forecastLayer==="precipitation"){
   if(!modelInitUtc)return;
   const weight=nowcastWeight(relative),modelOpacity=relative===0?0:Math.max(.2,.82*(1-weight*.72));
   let model:Layer|null=null,live:Layer|null=null;
   if(relative>0){const frame=String(frameMinutes).padStart(4,"0"),run=iemRunId(modelInitUtc),tile:any=L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFP-F${frame}-${run}/{z}/{x}/{y}.png`,{pane:"weather",opacity:0,maxZoom:12,attribution:"HRRR via Iowa Environmental Mesonet"}).addTo(map);model=tile;let ready=false;const onReady=()=>{if(ready)return;ready=true;promote(tile,modelOpacity,"model")};tile.once("load",onReady);window.setTimeout(onReady,1200)}else{removeLater(modelRef.current);modelRef.current=null}
   if(weight>0&&latestObservedAt){const bounds=map.getBounds(),sw=L.CRS.EPSG3857.project(bounds.getSouthWest()),ne=L.CRS.EPSG3857.project(bounds.getNorthEast()),size=map.getSize(),scale=Math.max(1,Math.min(3,1800/size.x,1800/size.y));const params=new URLSearchParams({bbox:`${sw.x},${sw.y},${ne.x},${ne.y}`,width:String(Math.round(size.x*scale)),height:String(Math.round(size.y*scale)),time:latestObservedAt});let overlayBounds=bounds;const shift=motionShift(evolution,relative);if(shift){const s=shiftedPoint(bounds.getSouth(),bounds.getWest(),shift.bearing,shift.miles),n=shiftedPoint(bounds.getNorth(),bounds.getEast(),shift.bearing,shift.miles);overlayBounds=L.latLngBounds(L.latLng(s[0],s[1]),L.latLng(n[0],n[1]))}const image:any=L.imageOverlay(`/api/radar/image?${params}`,overlayBounds,{opacity:0,pane:"nowcast",interactive:false}).addTo(map);live=image;let ready=false;const onReady=()=>{if(ready)return;ready=true;promote(image,weight,"observed")};image.once("load",onReady);window.setTimeout(onReady,900)}else{removeLater(observedRef.current);observedRef.current=null}
   return()=>{if(token!==renderTokenRef.current){if(model&&map.hasLayer(model))map.removeLayer(model);if(live&&map.hasLayer(live))map.removeLayer(live)}}
  }

  if(!modelInitUtc)return;removeLater(observedRef.current);observedRef.current=null;const bounds=map.getBounds(),sw=L.CRS.EPSG3857.project(bounds.getSouthWest()),ne=L.CRS.EPSG3857.project(bounds.getNorthEast()),size=map.getSize();if(size.x<100||size.y<100)return;const params=new URLSearchParams({bbox:`${sw.x},${sw.y},${ne.x},${ne.y}`,width:String(size.x),height:String(size.y),modelInitUtc,forecastMinutes:String(frameMinutes)});const image:any=L.imageOverlay(`/api/forecast-cloud/image?${params}`,bounds,{opacity:0,pane:"weather",interactive:false}).addTo(map);let promoted=false;const ready=()=>{if(promoted)return;promoted=true;promote(image,.9,"model")};image.once("load",ready);const fallback=window.setTimeout(ready,1200);return()=>{window.clearTimeout(fallback);image.off("load",ready);if(token!==renderTokenRef.current&&map.hasLayer(image))map.removeLayer(image)}
 },[forecastMinutes,frameIndex,forecastLayer,mapReady,modelInitUtc,latestObservedAt,evolution,viewRevision,tabActive]);

 useEffect(()=>{if(!playing||!tabActive||mapInteraction||forecastMinutes.length<2)return;const step=forecastLayer==="clouds"?4:1,delay=forecastLayer==="clouds"?1800:1500;const timer=window.setInterval(()=>setFrameIndex(i=>{const next=i+step;return next>=forecastMinutes.length?0:next}),delay);return()=>window.clearInterval(timer)},[forecastMinutes.length,playing,tabActive,mapInteraction,forecastLayer]);

 const frameMinutes=forecastMinutes[frameIndex],displayMinutes=forecastLayer==="clouds"?Math.round(frameMinutes/60)*60:frameMinutes,relativeMinutes=Math.max(0,displayMinutes-forecastMinutes[0]);
 const setLayer=(layer:ForecastLayer)=>{setPlaying(false);setForecastLayer(layer);setFrameIndex(0)};
 const sourceLabel=forecastLayer==="precipitation"?(relativeMinutes===0?"Live MRMS observation":relativeMinutes<=45?"Radar-led nowcast + HRRR":"HRRR forecast"):"HRRR cloud forecast";

 return <div className="forecastRadarPlayer"><p className="radarSource" style={{margin:"0 2px 10px"}}>{runLabel(modelInitUtc)} · {checkedLabel(checkedAt)}</p><div className="weatherLayerToggle"><button type="button" className={forecastLayer==="precipitation"?"active":""} onClick={()=>setLayer("precipitation")}>Precipitation</button><button type="button" className={forecastLayer==="clouds"?"active":""} onClick={()=>setLayer("clouds")}>Cloud Cover</button></div><div className="radarShell forecastRadarShell"><div ref={containerRef} className={`radarMap forecastRadarMap ${touchMap?(mapInteraction?"mapTouchActive":"mapTouchScroll"):""}`}/>{touchMap&&<button type="button" className="mapInteractionButton" onClick={()=>{if(!mapInteraction)setPlaying(false);setMapInteraction(v=>!v)}}>{mapInteraction?"Done":"Move map"}</button>}<div className="radarReadout"><strong>{frameIndex===0?"Current":validTimeLabel(modelInitUtc,displayMinutes)}</strong><span>{relativeLabel(relativeMinutes)} · {sourceLabel} · {runLabel(modelInitUtc)}</span></div></div><div className="radarControls"><button type="button" onClick={()=>setPlaying(v=>!v)}><span>{playing?"Ⅱ":"▶"}</span> {playing?"Pause":"Play"}</button><input type="range" min="0" max={forecastMinutes.length-1} value={frameIndex} step={forecastLayer==="clouds"?4:1} onChange={e=>{setPlaying(false);setFrameIndex(Number(e.target.value))}}/><button type="button" className="newestButton" onClick={()=>{setPlaying(false);setFrameIndex(0)}}>Current</button></div><p className="radarSource">{forecastLayer==="precipitation"?"Current uses live NOAA/NWS MRMS. First 45 minutes are radar-led nowcast blended into the freshest available HRRR, then HRRR takes over.":"NOAA/NCEP HRRR total cloud cover via NOMADS · hourly cloud fields · model guidance"}</p></div>
}
