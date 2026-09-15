export const runtime = "edge";

const ICON_SOURCE =
  "https://raw.githubusercontent.com/jarndtphoto/BridgeportWeather/main/Codex%20Image%20Sep%2015%2C%202026%2C%2003_23_04%20PM.png";

export async function GET() {
  return Response.redirect(ICON_SOURCE, 307);
}
