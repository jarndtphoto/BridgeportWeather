export const dynamic = "force-dynamic";

const HRRR_REFD_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi";
const LAT = 41.8382;
const LON = -87.6331;

export async function GET(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("minutes") ?? "0");
  const forecastMinutes = Number.isFinite(value) ? Math.max(0, Math.min(1080, Math.round(value / 15) * 15)) : 0;
  const layer = `refd_${String(forecastMinutes).padStart(4, "0")}`;
  const delta = 0.04;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: layer,
    QUERY_LAYERS: layer,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: `${LON - delta},${LAT - delta},${LON + delta},${LAT + delta}`,
    WIDTH: "101",
    HEIGHT: "101",
    X: "50",
    Y: "50",
    INFO_FORMAT: "text/plain",
    FEATURE_COUNT: "1",
  });
  const response = await fetch(`${HRRR_REFD_WMS}?${params.toString()}`, { cache: "no-store" });
  const text = await response.text();
  return Response.json({ forecastMinutes, status: response.status, contentType: response.headers.get("content-type"), text });
}
