import { ImageResponse } from "next/og";

export const runtime = "edge";

const ALLOWED_SIZES = new Set([180, 192, 512]);

export async function GET(request: Request) {
  const rawSize = Number(new URL(request.url).searchParams.get("size"));
  const size = ALLOWED_SIZES.has(rawSize) ? rawSize : 512;
  const s = (value: number) => Math.round((value / 512) * size);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 38%, #0e4b72 0%, #08243c 36%, #04111f 72%, #020911 100%)",
          borderRadius: s(72),
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 512 512"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#66efff" />
              <stop offset="100%" stopColor="#1687ff" />
            </linearGradient>
            <linearGradient id="sweep" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#3cf7da" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#8fffea" stopOpacity="0.62" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect x="14" y="14" width="484" height="484" rx="66" fill="none" stroke="#2e9bff" strokeWidth="5" opacity="0.7" />

          <g fill="none" stroke="url(#ring)" strokeWidth="3" opacity="0.85">
            <circle cx="256" cy="256" r="195" />
            <circle cx="256" cy="256" r="151" />
            <circle cx="256" cy="256" r="106" />
            <circle cx="256" cy="256" r="61" />
          </g>
          <g stroke="#48dfff" strokeWidth="2" opacity="0.72">
            <line x1="256" y1="34" x2="256" y2="478" />
            <line x1="34" y1="256" x2="478" y2="256" />
          </g>

          <path d="M256 256 L425 63 Q463 84 480 117 L256 256 Z" fill="url(#sweep)" />
          <circle cx="256" cy="256" r="7" fill="#dfffff" filter="url(#glow)" />

          <g opacity="0.96">
            <ellipse cx="299" cy="153" rx="84" ry="48" fill="#37d449" />
            <ellipse cx="272" cy="167" rx="67" ry="43" fill="#77e43d" />
            <ellipse cx="330" cy="173" rx="67" ry="39" fill="#57d846" />
            <ellipse cx="292" cy="156" rx="56" ry="34" fill="#ffe72f" />
            <ellipse cx="322" cy="164" rx="50" ry="31" fill="#ffb91e" />
            <ellipse cx="300" cy="158" rx="38" ry="25" fill="#ff5d24" />
            <ellipse cx="313" cy="155" rx="28" ry="19" fill="#d91c2b" />
          </g>

          <g opacity="0.42" fill="#16446e">
            <circle cx="70" cy="400" r="64" />
            <circle cx="120" cy="425" r="77" />
            <circle cx="392" cy="423" r="84" />
            <circle cx="447" cy="399" r="58" />
          </g>

          <path
            d="M77 329 C150 292 340 292 436 325 C338 345 178 354 86 343"
            fill="none"
            stroke="white"
            strokeWidth="9"
            strokeLinecap="round"
            opacity="0.95"
            filter="url(#glow)"
          />

          <g fill="none" stroke="white" strokeLinecap="round" filter="url(#glow)">
            <path d="M250 352 C278 344 302 350 316 359 C292 365 271 368 252 370" strokeWidth="10" />
            <path d="M260 374 C281 370 298 374 305 381 C291 386 276 389 264 390" strokeWidth="8" />
            <path d="M270 393 C283 391 291 394 294 399 C287 403 280 405 274 407" strokeWidth="6" />
            <path d="M278 409 C285 409 289 411 289 414 C286 417 283 419 281 420" strokeWidth="4" />
          </g>
        </svg>

        <div
          style={{
            position: "absolute",
            top: s(206),
            left: 0,
            width: "100%",
            display: "flex",
            justifyContent: "center",
            fontSize: s(118),
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: s(-7),
            color: "#f7fcff",
            textShadow: `0 0 ${s(10)}px #2faeff, 0 ${s(5)}px ${s(5)}px rgba(0,0,0,.55)`,
          }}
        >
          BSW
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    },
  );
}
