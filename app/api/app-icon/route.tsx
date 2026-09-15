export const runtime = "edge";

const ICON_SOURCE =
  "https://raw.githubusercontent.com/jarndtphoto/BridgeportWeather/main/app/assets/bsw-icon.b64";

export async function GET() {
  const source = await fetch(ICON_SOURCE, { cache: "no-store" });
  if (!source.ok) {
    return new Response("Icon unavailable", { status: 502 });
  }

  const base64 = (await source.text()).trim();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
