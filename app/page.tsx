import { getAmbientSnapshot, type AmbientSnapshot, type RawObservation } from "../lib/ambient";
import RadarMap from "./components/RadarMap";

export const dynamic = "force-dynamic";

function numberValue(observation: RawObservation, key: string) {
  const value = observation[key];
  return typeof value === "number" ? value : null;
}

function formatNumber(value: number | null, unit: string, digits = 1) {
  return value === null ? "Not reported" : `${value.toFixed(digits)}${unit}`;
}

function cardinalDirection(degrees: number | null) {
  if (degrees === null) return null;
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

function observationMetrics(observation: RawObservation) {
  const windSpeed = numberValue(observation, "windspeedmph") ?? numberValue(observation, "windspdmph_avg10m");
  const windDirection = numberValue(observation, "winddir");
  const direction = cardinalDirection(windDirection);
  const gust = numberValue(observation, "windgustmph");
  const pressure = numberValue(observation, "baromrelin") ?? numberValue(observation, "baromabsin");

  return [
    { label: "Wind", value: `${formatNumber(windSpeed, " mph")}${direction ? ` ${direction}` : ""}`, detail: gust === null ? null : `Gust ${gust.toFixed(1)} mph`, caution: true },
    { label: "Outdoor temperature", value: formatNumber(numberValue(observation, "tempf"), "°F"), detail: "May read warm in direct afternoon sun", caution: true },
    { label: "Humidity", value: formatNumber(numberValue(observation, "humidity"), "%", 0), detail: null },
    { label: "Pressure", value: formatNumber(pressure, " inHg", 2), detail: observation.baromrelin !== undefined ? "Relative pressure" : "Absolute pressure" },
    { label: "Rain today", value: formatNumber(numberValue(observation, "dailyrainin"), " in", 2), detail: "Deck edge and wind can affect collection", caution: true },
    { label: "Rain rate", value: formatNumber(numberValue(observation, "hourlyrainin"), " in/hr", 2), detail: null, caution: true },
    { label: "Solar radiation", value: formatNumber(numberValue(observation, "solarradiation"), " W/m²", 0), detail: null },
    { label: "UV index", value: formatNumber(numberValue(observation, "uv"), "", 0), detail: null },
  ];
}

function observedTime(value: string | null) {
  if (!value) return "Latest observation";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Latest observation" : `Observed ${date.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`;
}

export default async function Home() {
  let snapshot: AmbientSnapshot | null = null;
  try {
    snapshot = await getAmbientSnapshot();
  } catch {}

  const metrics = snapshot ? observationMetrics(snapshot.rawObservation) : [
    { label: "Wind", value: "Live data unavailable", detail: null },
    { label: "Outdoor temperature", value: "Live data unavailable", detail: null },
    { label: "Rain", value: "Live data unavailable", detail: null },
    { label: "Solar", value: "Live data unavailable", detail: null },
  ];
  return (
    <main>
      <input className="tabInput" type="radio" id="tab-radar" name="screen" defaultChecked />
      <input className="tabInput" type="radio" id="tab-station" name="screen" />
      <input className="tabInput" type="radio" id="tab-forecast" name="screen" />

      <section className="tabPanel radarPanel" aria-labelledby="radar-title">
        <h1 id="radar-title">Bridgeport Severe Weather</h1>
        <div className="threatZone">
          <strong>No active severe-weather assessment</strong>
          <p>Live radar and local observations are available. Automated severe-weather interpretation is not active yet.</p>
        </div>
        <RadarMap />
      </section>

      <section className="tabPanel stationPanel" aria-labelledby="station-title">
        <div className="screenHeader">
          <div>
            <p className="eyebrow">BRIDGEPORT · CHICAGO</p>
            <h1 id="station-title">At the Station</h1>
          </div>
          <span className={`live ${snapshot ? "connected" : ""}`}><i /> {snapshot ? "LIVE" : "OFFLINE"}</span>
        </div>
        <div className="sectionTitle"><h3>WS-2902 observations</h3><span>LIVE FEED</span></div>
        {snapshot && <div className="stationMeta"><strong>{snapshot.station.name}</strong><span>{observedTime(snapshot.observedAt)}</span></div>}
        <div className="grid">
          {metrics.map((metric) => (
            <article className={`metric ${"caution" in metric && metric.caution ? "caution" : ""}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail && <small>{metric.detail}</small>}
            </article>
          ))}
        </div>
        <p className="note">Raw observations are retained. Wind reflects the intentionally exposed second-story deck. Temperature, rainfall, and elevated wind are direct sensor readings—not corrected ground truth.</p>
      </section>

      <section className="tabPanel forecastPanel" aria-labelledby="forecast-title">
        <h1 id="forecast-title">Forecast</h1>
        <div className="emptyState">
          <strong>Severe-weather forecast coming next</strong>
          <p>This area will eventually contain Bridgeport-specific severe-weather forecasting and storm evolution.</p>
        </div>
      </section>

      <nav className="bottomNav" aria-label="Primary">
        <label htmlFor="tab-radar">Radar</label>
        <label htmlFor="tab-station">Station</label>
        <label htmlFor="tab-forecast">Forecast</label>
      </nav>
    </main>
  );
}
