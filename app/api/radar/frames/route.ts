export const dynamic = "force-dynamic";

const IEM_SOURCE = {
  provider: "Iowa Environmental Mesonet",
  product: "NEXRAD N0Q base reflectivity mosaic",
  observationType: "Observed radar reflectivity (not forecast precipitation)",
  expectedUpdateIntervalMinutes: 5,
  service: "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi",
} as const;

function liveIemFrames() {
  const stepMs = 5 * 60_000;
  const newestMs = Math.floor(Date.now() / stepMs) * stepMs;
  // IEM exposes current plus m05m through m55m tile layers.
  return Array.from({ length: 12 }, (_, index) => {
    const observedMs = newestMs - (11 - index) * stepMs;
    return {
      observedAt: new Date(observedMs).toISOString(),
      epochSeconds: Math.floor(observedMs / 1000),
      id: String(Math.floor(observedMs / 1000)),
    };
  });
}

export async function GET() {
  return Response.json(
    { source: IEM_SOURCE, frames: liveIemFrames() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
