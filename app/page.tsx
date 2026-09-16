import { getAmbientSnapshot, type AmbientSnapshot, type RawObservation } from "../lib/ambient";
import { getLocalForecast, type LocalForecast, type HourlyForecastPeriod } from "../lib/forecast";
import { getHrrrModelInitUtc, getHrrrPointSample, hrrrForecastMinutesForTime, type HrrrPointSample } from "../lib/hrrr";
import { forecastConsensus } from "../lib/forecastConsensus";
import { getRadarFrames, getRadarPointReflectivity, type RadarFrame } from "../lib/radar";
import { assessStormEvolution, type StormEvolution } from "../lib/evolution";
import { isNightAt, isNightLive } from "../lib/daylight";
import RadarMap from "./components/RadarMap";
import ForecastRadar from "./components/ForecastRadar";
import ThreatBanner from "./components/ThreatBanner";
import AlertsList from "./components/AlertsList";
import BottomNav from "./components/BottomNav";
import CurrentConditionsIcon from "./components/CurrentConditionsIcon";
import WeatherIcon, { forecastIconKind } from "./components/WeatherIcon";

export const dynamic = "force-dynamic";
const BRIDGEPORT_LAT = 41.8382;
const BRIDGEPORT_LON = -87.6331;

function numberValue(o: RawObservation, k: string) {
  const v = o[k];
  return typeof v === "number" ? v : null;
}

function formatNumber(v: number | null, u: string, d = 1) {
  return v === null ? "Not reported" : `${v.toFixed(d)}${u}`;
}

function cardinalDirection(d: number | null) {
  if (d === null) return null;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
}

function observationMetrics(o: RawObservation) {
  const w = numberValue(o, "windspeedmph") ?? numberValue(o, "windspdmph_avg10m");
  const dir = cardinalDirection(numberValue(o, "winddir"));
  const g = numberValue(o, "windgustmph");
  const p = numberValue(o, "baromrelin") ?? numberValue(o, "baromabsin");
  return [
    { label: "Outdoor temperature", value: formatNumber(numberValue(o, "tempf"), "°F"), detail: null },
    { label: "Wind", value: `${formatNumber(w, " mph")}${dir ? ` ${dir}` : ""}`, detail: g === null ? null : `Gust ${g.toFixed(1)} mph` },
    { label: "Humidity", value: formatNumber(numberValue(o, "humidity"), "%", 0), detail: null },
    { label: "Pressure", value: formatNumber(p, " inHg", 2), detail: null },
    { label: "Rain today", value: formatNumber(numberValue(o, "dailyrainin"), " in", 2), detail: null },
    { label: "Rain rate", value: formatNumber(numberValue(o, "hourlyrainin"), " in/hr", 2), detail: null },
    { label: "Solar radiation", value: formatNumber(numberValue(o, "solarradiation"), " W/m²", 0), detail: null },
    { label: "UV index", value: formatNumber(numberValue(o, "uv"), "", 0), detail: null },
  ];
}

function observedTime(v: string | null) {
  if (!v) return "Latest observation";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "Latest observation"
    : `Observed ${d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`;
}

function forecastTime(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric" });
}

function precipitationForecast(t: string) {
  const v = t.toLowerCase();
  return v.includes("rain") || v.includes("shower") || v.includes("thunder") || v.includes("drizzle") || v.includes("sleet") || v.includes("snow") || v.includes("freezing");
}

function stationRainActive(o: RawObservation | null) {
  if (!o) return false;
  const r = numberValue(o, "rainratein") ?? numberValue(o, "rainrate") ?? numberValue(o, "hourlyrainin");
  return r !== null && r > 0.001;
}

function stationRainRate(o: RawObservation | null) {
  if (!o) return null;
  return numberValue(o, "rainratein") ?? numberValue(o, "rainrate") ?? numberValue(o, "hourlyrainin");
}

function forecastNight(p: HourlyForecastPeriod) {
  return isNightAt(new Date(p.startTime), BRIDGEPORT_LAT, BRIDGEPORT_LON);
}

function consensusIcon(p: HourlyForecastPeriod, s: HrrrPointSample | null) {
  const c = forecastConsensus(p, s);
  const night = forecastNight(p);
  const text = p.shortForecast.toLowerCase();
  const wordingSaysRain = text.includes("rain") || text.includes("shower") || text.includes("drizzle");
  const wordingSaysHeavy = text.includes("heavy rain") || text.includes("heavy shower");
  const wordingSaysLight = text.includes("scattered") || text.includes("slight chance") || text.includes("chance") || text.includes("isolated") || text.includes("light rain") || text.includes("drizzle");

  // If the NWS wording explicitly says rain/showers, always keep a rain-family icon.
  // HRRR can increase the intensity, but a dry model sample must not turn a rainy card into a plain cloud.
  if (wordingSaysRain) {
    if (wordingSaysHeavy || s?.intensity === "strong") return forecastIconKind("Heavy Rain", p.icon, p.precipitationChance, night);
    if (s?.intensity === "moderate" && !wordingSaysLight) return forecastIconKind("Rain", p.icon, p.precipitationChance, night);
    return forecastIconKind(wordingSaysLight ? "Light Rain" : "Rain", p.icon, p.precipitationChance, night);
  }

  if (c.thunder) return forecastIconKind("Thunderstorms", p.icon, p.precipitationChance, night);
  if (!c.precipitation) return forecastIconKind(p.shortForecast, p.icon, p.precipitationChance, night);
  if (s?.intensity === "strong") return forecastIconKind("Heavy Rain", p.icon, p.precipitationChance, night);
  if (s?.intensity === "moderate") return forecastIconKind("Rain", p.icon, p.precipitationChance, night);
  return forecastIconKind("Light Rain", p.icon, p.precipitationChance, night);
}

function observedCurrentIcon(p: HourlyForecastPeriod, dbz: number | null, raining: boolean, night: boolean) {
  const predicted = forecastIconKind(p.shortForecast, p.icon, p.precipitationChance, night);
  const cloudy = forecastIconKind("Mostly Cloudy", p.icon, null, night);
  if ((dbz ?? 0) < 10 && !raining) return precipitationForecast(p.shortForecast) ? cloudy : predicted;
  if ((dbz ?? 0) >= 45) return forecastIconKind("Heavy Rain", p.icon, p.precipitationChance, night);
  if ((dbz ?? 0) >= 30) return forecastIconKind("Rain", p.icon, p.precipitationChance, night);
  return forecastIconKind("Light Rain", p.icon, p.precipitationChance, night);
}

export default async function Home() {
  let snapshot: AmbientSnapshot | null = null;
  let forecast: LocalForecast | null = null;
  let hrrrModelInitUtc: string | null = null;
  let liveRadarDbz: number | null = null;
  let radarFrames: RadarFrame[] = [];
  let radarEvolution: StormEvolution | null = null;

  const [a, f, h, r] = await Promise.allSettled([
    getAmbientSnapshot(),
    getLocalForecast(BRIDGEPORT_LAT, BRIDGEPORT_LON),
    getHrrrModelInitUtc(),
    getRadarFrames(),
  ]);

  if (a.status === "fulfilled") snapshot = a.value;
  if (f.status === "fulfilled") forecast = f.value;
  if (h.status === "fulfilled") hrrrModelInitUtc = h.value;
  if (r.status === "fulfilled" && r.value.length) {
    radarFrames = r.value;
    const latest = r.value[r.value.length - 1];
    liveRadarDbz = await getRadarPointReflectivity(BRIDGEPORT_LAT, BRIDGEPORT_LON, latest.observedAt);
  }

  if (radarFrames.length) {
    try {
      radarEvolution = await assessStormEvolution(
        BRIDGEPORT_LAT,
        BRIDGEPORT_LON,
        radarFrames,
        null,
        stationRainRate(snapshot?.rawObservation ?? null),
        null,
      );
    } catch {}
  }

  const metrics = snapshot
    ? observationMetrics(snapshot.rawObservation)
    : [
        { label: "Outdoor temperature", value: "Live data unavailable", detail: null },
        { label: "Wind", value: "Live data unavailable", detail: null },
        { label: "Rain", value: "Live data unavailable", detail: null },
        { label: "Solar", value: "Live data unavailable", detail: null },
      ];

  const now = Date.now();
  const nextSix = forecast?.hourly.filter((p) => Date.parse(p.startTime) + 3600000 > now).slice(0, 6) ?? [];
  const later = forecast?.daily.slice(0, 4) ?? [];
  const samples = await Promise.all(
    nextSix.map(async (p, i) => {
      if (i === 0) return null;
      const m = hrrrForecastMinutesForTime(p.startTime, hrrrModelInitUtc);
      return m === null ? null : getHrrrPointSample(BRIDGEPORT_LAT, BRIDGEPORT_LON, m);
    }),
  );

  const current = nextSix[0] ?? null;
  const stationRaining = stationRainActive(snapshot?.rawObservation ?? null);
  const solarRadiation = snapshot ? numberValue(snapshot.rawObservation, "solarradiation") : null;
  const liveNight = isNightLive(new Date(), BRIDGEPORT_LAT, BRIDGEPORT_LON, solarRadiation);
  const currentIcon = current ? observedCurrentIcon(current, liveRadarDbz, stationRaining, liveNight) : forecastIconKind("Mostly Cloudy", null, null, liveNight);
  const radarApproaching = radarEvolution?.relevance === "nearby" && radarEvolution.motion === "approaching";

  const renderHour = (p: HourlyForecastPeriod, i: number) => {
    const night = i === 0 ? liveNight : forecastNight(p);
    const radarNowcastHour = radarApproaching && i > 0 && i <= 2;
    const kind = i === 0 ? currentIcon : radarNowcastHour ? forecastIconKind("Rain", p.icon, Math.max(50, p.precipitationChance ?? 0), night) : consensusIcon(p, samples[i] ?? null);
    const summary = radarNowcastHour ? "Rain approaching" : p.shortForecast;
    const precipLine = radarNowcastHour ? "Live radar indicates approaching precipitation" : p.precipitationChance === null ? "Rain chance —" : `${p.precipitationChance}% rain`;
    return (
      <article className="forecastHour" key={p.startTime}>
        <span className="forecastHourTime">{forecastTime(p.startTime)}</span>
        {i === 0 ? <CurrentConditionsIcon className="forecastHourIcon" kind={kind} /> : <WeatherIcon className="forecastHourIcon" kind={kind} />}
        <strong>{p.temperature}°</strong>
        <span>{summary}</span>
        <small>{precipLine}</small>
        <small>{p.windDirection} {p.windSpeed}</small>
      </article>
    );
  };

  return (
    <main>
      <input className="tabInput" type="radio" id="tab-station" name="screen" defaultChecked />
      <input className="tabInput" type="radio" id="tab-live" name="screen" />
      <input className="tabInput" type="radio" id="tab-future" name="screen" />
      <input className="tabInput" type="radio" id="tab-forecast" name="screen" />

      <section className="tabPanel stationPanel homePanel" aria-labelledby="home-title">
        <h1 id="home-title">Bridgeport Severe Weather</h1>
        <ThreatBanner />
        <AlertsList />

        <section className="homeConditions" aria-labelledby="conditions-title">
          <div className="stationHeader">
            <div className="stationTopline">
              <p className="eyebrow">CURRENT CONDITIONS · BRIDGEPORT</p>
              <span className={`live ${snapshot ? "connected" : ""}`}><i /> {snapshot ? "LIVE" : "OFFLINE"}</span>
            </div>
            <div className="stationTitleRow">
              <div>
                <h2 id="conditions-title">Right now</h2>
                {snapshot && <p className="stationObserved">{observedTime(snapshot.observedAt)}</p>}
              </div>
              <CurrentConditionsIcon className="stationCurrentIcon" kind={currentIcon} />
            </div>
          </div>
          <div className="grid stationGrid compactMetrics">
            {metrics.map((m) => (
              <article className="metric" key={m.label}>
                <span>{m.label}</span>
                <strong>{m.value}</strong>
                {m.detail && <small>{m.detail}</small>}
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="tabPanel liveRadarPanel radarFullscreenPanel" aria-labelledby="live-radar-page-title">
        <div className="radarPageHeader">
          <p className="eyebrow">BRIDGEPORT · CHICAGO</p>
          <h1 id="live-radar-page-title">Live Radar</h1>
        </div>
        <RadarMap />
      </section>

      <section className="tabPanel futureRadarPanel radarFullscreenPanel" aria-labelledby="future-radar-page-title">
        <div className="radarPageHeader">
          <p className="eyebrow">BRIDGEPORT · CHICAGO</p>
          <h1 id="future-radar-page-title">Future Radar</h1>
        </div>
        <ForecastRadar />
      </section>

      <section className="tabPanel forecastPanel" aria-labelledby="forecast-title">
        <p className="eyebrow">BRIDGEPORT · CHICAGO</p>
        <h1 id="forecast-title">Forecast</h1>
        {nextSix.length ? (
          <>
            <div className="sectionTitle"><h2>Next 6 Hours</h2><span>NWS + HRRR + RADAR</span></div>
            <div className="forecastHours">{nextSix.map(renderHour)}</div>
            <div className="sectionTitle forecastOutlookTitle"><h2>Later outlook</h2><span>NWS</span></div>
            <div className="forecastOutlook">
              {later.map((p) => (
                <article key={`${p.number}-${p.startTime}`}>
                  <div><strong>{p.name}</strong><span>{p.shortForecast}</span></div>
                  <b>{p.temperature}°</b>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="emptyState"><strong>Forecast temporarily unavailable</strong><p>The NWS local forecast feed could not be reached. Live radar and local station observations remain available.</p></div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
