import { getAmbientSnapshot, type AmbientSnapshot, type RawObservation } from "../lib/ambient";
import { getLocalForecast, type LocalForecast } from "../lib/forecast";
import RadarMap from "./components/RadarMap";
import ForecastRadar from "./components/ForecastRadar";
import ThreatBanner from "./components/ThreatBanner";
import AlertsList from "./components/AlertsList";
import BottomNav from "./components/BottomNav";
import WeatherIcon, { forecastIconKind } from "./components/WeatherIcon";

export const dynamic = "force-dynamic";

const BRIDGEPORT_LAT = 41.8382;
const BRIDGEPORT_LON = -87.6331;

function numberValue(observation: RawObservation, key: string) { const value = observation[key]; return typeof value === "number" ? value : null; }
function formatNumber(value: number | null, unit: string, digits = 1) { return value === null ? "Not reported" : `${value.toFixed(digits)}${unit}`; }
function cardinalDirection(degrees: number | null) { if (degrees === null) return null; const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]; return directions[Math.round(degrees / 45) % directions.length]; }
function observationMetrics(observation: RawObservation) { const windSpeed = numberValue(observation, "windspeedmph") ?? numberValue(observation, "windspdmph_avg10m"); const direction = cardinalDirection(numberValue(observation, "winddir")); const gust = numberValue(observation, "windgustmph"); const pressure = numberValue(observation, "baromrelin") ?? numberValue(observation, "baromabsin"); return [ { label:"Outdoor temperature",value:formatNumber(numberValue(observation,"tempf"),"°F"),detail:null }, { label:"Wind",value:`${formatNumber(windSpeed," mph")}${direction?` ${direction}`:""}`,detail:gust===null?null:`Gust ${gust.toFixed(1)} mph` }, { label:"Humidity",value:formatNumber(numberValue(observation,"humidity"),"%",0),detail:null }, { label:"Pressure",value:formatNumber(pressure," inHg",2),detail:null }, { label:"Rain today",value:formatNumber(numberValue(observation,"dailyrainin")," in",2),detail:null }, { label:"Rain rate",value:formatNumber(numberValue(observation,"hourlyrainin")," in/hr",2),detail:null }, { label:"Solar radiation",value:formatNumber(numberValue(observation,"solarradiation")," W/m²",0),detail:null }, { label:"UV index",value:formatNumber(numberValue(observation,"uv"),"",0),detail:null } ]; }
function observedTime(value:string|null){if(!value)return"Latest observation";const date=new Date(value);return Number.isNaN(date.getTime())?"Latest observation":`Observed ${date.toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})}`;}
function forecastTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleTimeString("en-US",{timeZone:"America/Chicago",hour:"numeric"});}

export default async function Home(){
  let snapshot:AmbientSnapshot|null=null;
  let forecast:LocalForecast|null=null;
  const [ambientResult, forecastResult] = await Promise.allSettled([
    getAmbientSnapshot(),
    getLocalForecast(BRIDGEPORT_LAT, BRIDGEPORT_LON),
  ]);
  if(ambientResult.status==="fulfilled") snapshot=ambientResult.value;
  if(forecastResult.status==="fulfilled") forecast=forecastResult.value;

  const metrics=snapshot?observationMetrics(snapshot.rawObservation):[{label:"Outdoor temperature",value:"Live data unavailable",detail:null},{label:"Wind",value:"Live data unavailable",detail:null},{label:"Rain",value:"Live data unavailable",detail:null},{label:"Solar",value:"Live data unavailable",detail:null}];
  const now = Date.now();
  const nextSix = forecast?.hourly.filter(period => Date.parse(period.startTime) + 3_600_000 > now).slice(0,6) ?? [];
  const later = forecast?.daily.slice(0,4) ?? [];

  return <main>
    <input className="tabInput" type="radio" id="tab-radar" name="screen" defaultChecked/>
    <input className="tabInput" type="radio" id="tab-station" name="screen"/>
    <input className="tabInput" type="radio" id="tab-forecast" name="screen"/>

    <section className="tabPanel radarPanel" aria-labelledby="radar-title">
      <h1 id="radar-title">Bridgeport Severe Weather</h1><ThreatBanner/><AlertsList/><RadarMap/>
    </section>

    <section className="tabPanel stationPanel" aria-labelledby="station-title">
      <div className="stationHeader">
        <div className="stationTopline"><p className="eyebrow">BRIDGEPORT · CHICAGO</p><span className={`live ${snapshot?"connected":""}`}><i/> {snapshot?"LIVE":"OFFLINE"}</span></div>
        <h1 id="station-title">Current Local Weather</h1>
        {snapshot&&<p className="stationObserved">{observedTime(snapshot.observedAt)}</p>}
      </div>
      <div className="grid stationGrid">{metrics.map((metric,index)=><article className={`metric ${index<2?"metricFeatured":""}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.detail&&<small>{metric.detail}</small>}</article>)}</div>
    </section>

    <section className="tabPanel forecastPanel" aria-labelledby="forecast-title">
      <p className="eyebrow">BRIDGEPORT · CHICAGO</p>
      <h1 id="forecast-title">Next 6 Hours</h1>
      {nextSix.length ? <>
        <div className="forecastHours">
          {nextSix.map(period=><article className="forecastHour" key={period.startTime}>
            <span className="forecastHourTime">{forecastTime(period.startTime)}</span>
            <WeatherIcon className="forecastHourIcon" kind={forecastIconKind(period.shortForecast, period.icon, period.precipitationChance)} />
            <strong>{period.temperature}°</strong>
            <span>{period.shortForecast}</span>
            <small>{period.precipitationChance===null?"Rain chance —":`${period.precipitationChance}% rain`}</small>
            <small>{period.windDirection} {period.windSpeed}</small>
          </article>)}
        </div>
        <section className="forecastRadarCard" aria-labelledby="forecast-radar-title">
          <div className="sectionTitle radarHeading"><div><p className="kicker">MODEL GUIDANCE</p><h2 id="forecast-radar-title">6-Hour Forecast Radar</h2></div><span>HRRR</span></div>
          <ForecastRadar />
        </section>
        <div className="sectionTitle forecastOutlookTitle"><h3>Later outlook</h3><span>NWS</span></div>
        <div className="forecastOutlook">
          {later.map(period=><article key={`${period.number}-${period.startTime}`}><div><strong>{period.name}</strong><span>{period.shortForecast}</span></div><b>{period.temperature}°</b></article>)}
        </div>
      </> : <div className="emptyState"><strong>Forecast temporarily unavailable</strong><p>The NWS local forecast feed could not be reached. Live radar and local station observations remain available.</p></div>}
    </section>
    <BottomNav/>
  </main>
}
