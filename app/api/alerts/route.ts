import { getNwsAlerts } from "../../../lib/nws";
export const dynamic = "force-dynamic";
const BRIDGEPORT_LAT = 41.8382;
const BRIDGEPORT_LON = -87.6331;
const STATE_CODE = "IL";
export async function GET() { try { const alerts = await getNwsAlerts(BRIDGEPORT_LAT, BRIDGEPORT_LON, STATE_CODE); return Response.json(alerts, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }); } catch { return Response.json({ error: "NWS alerts are temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } }); } }
