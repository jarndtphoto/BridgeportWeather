export const runtime = "edge";

export async function GET(request: Request) {
  return Response.redirect(new URL("/bsw-icon.png?v=4", request.url), 307);
}
