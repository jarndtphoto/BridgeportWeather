const SUN_ALTITUDE_DEGREES = -0.833;
const TRANSITION_MINUTES = 45;
const DARK_SOLAR_WM2 = 10;
const DAYLIGHT_SOLAR_WM2 = 40;

function toJulian(date: Date) {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function fromJulian(julian: number) {
  return new Date((julian - 2_440_587.5) * 86_400_000);
}

function rad(value: number) {
  return value * Math.PI / 180;
}

function deg(value: number) {
  return value * 180 / Math.PI;
}

export function sunriseSunsetFor(date: Date, lat: number, lon: number) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const jd = toJulian(day);
  const n = Math.round(jd - 2_451_545.0009 - lon / 360);
  const jStar = 2_451_545.0009 + lon / 360 + n;
  const meanAnomaly = (357.5291 + 0.98560028 * (jStar - 2_451_545)) % 360;
  const c = 1.9148 * Math.sin(rad(meanAnomaly)) + 0.02 * Math.sin(rad(2 * meanAnomaly)) + 0.0003 * Math.sin(rad(3 * meanAnomaly));
  const eclipticLongitude = (meanAnomaly + c + 180 + 102.9372) % 360;
  const transit = jStar + 0.0053 * Math.sin(rad(meanAnomaly)) - 0.0069 * Math.sin(rad(2 * eclipticLongitude));
  const declination = Math.asin(Math.sin(rad(eclipticLongitude)) * Math.sin(rad(23.44)));
  const numerator = Math.sin(rad(SUN_ALTITUDE_DEGREES)) - Math.sin(rad(lat)) * Math.sin(declination);
  const denominator = Math.cos(rad(lat)) * Math.cos(declination);
  const hourAngle = Math.acos(Math.max(-1, Math.min(1, numerator / denominator)));
  const delta = deg(hourAngle) / 360;
  return { sunrise: fromJulian(transit - delta), sunset: fromJulian(transit + delta) };
}

export function isNightAt(time: Date, lat: number, lon: number) {
  const { sunrise, sunset } = sunriseSunsetFor(time, lat, lon);
  return time < sunrise || time >= sunset;
}

export function isNightLive(time: Date, lat: number, lon: number, solarRadiation: number | null) {
  const { sunrise, sunset } = sunriseSunsetFor(time, lat, lon);
  if (time < sunrise || time >= sunset) return true;

  if (solarRadiation === null || !Number.isFinite(solarRadiation)) return false;
  const minsAfterSunrise = (time.getTime() - sunrise.getTime()) / 60_000;
  const minsBeforeSunset = (sunset.getTime() - time.getTime()) / 60_000;
  const nearTransition = (minsAfterSunrise >= 0 && minsAfterSunrise <= TRANSITION_MINUTES) || (minsBeforeSunset >= 0 && minsBeforeSunset <= TRANSITION_MINUTES);

  if (!nearTransition) return false;
  if (solarRadiation < DARK_SOLAR_WM2) return true;
  if (solarRadiation > DAYLIGHT_SOLAR_WM2) return false;
  return false;
}
