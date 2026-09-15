export const runtime = "edge";

const ICON_SOURCE =
  "https://raw.githubusercontent.com/jarndtphoto/BridgeportWeather/main/Codex%20Image%20Sep%2015%2C%202026%2C%2003_23_04%20PM.png";

export async function GET() {
  const source = await fetch(ICON_SOURCE, { cache: "no-store" });
  if (!source.ok) {
    return new Response("Icon unavailable", { status: 502 });
  }

  const bytes = await source.arrayBuffer();

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
