type IconKind =
  | "sunny"
  | "partly-cloudy"
  | "mostly-cloudy"
  | "cloudy"
  | "overcast"
  | "light-rain"
  | "rain"
  | "heavy-rain"
  | "chance-thunderstorms"
  | "thunderstorms"
  | "severe-storms"
  | "snow"
  | "wintry-mix"
  | "blowing-snow"
  | "sleet"
  | "freezing-rain"
  | "fog"
  | "windy"
  | "clear-night"
  | "partly-cloudy-night"
  | "mostly-cloudy-night";

export function forecastIconKind(shortForecast: string, iconUrl: string | null, precipitationChance: number | null = null): IconKind {
  const text = shortForecast.toLowerCase();
  const night = iconUrl?.includes("/night/") ?? false;
  const probabilistic = text.includes("chance") || text.includes("likely") || text.includes("possible") || text.includes("isolated") || text.includes("scattered");
  if (text.includes("severe") && (text.includes("storm") || text.includes("thunder"))) return "severe-storms";
  if (text.includes("thunder")) return probabilistic ? "chance-thunderstorms" : "thunderstorms";
  if (text.includes("freezing rain")) return "freezing-rain";
  if (text.includes("sleet")) return "sleet";
  if (text.includes("wintry") || (text.includes("snow") && text.includes("rain"))) return "wintry-mix";
  if (text.includes("blowing snow")) return "blowing-snow";
  if (text.includes("snow")) return "snow";
  if (text.includes("heavy rain") || text.includes("heavy showers")) return "heavy-rain";
  if (text.includes("light rain") || text.includes("drizzle") || (text.includes("slight chance") && text.includes("rain"))) return "light-rain";
  if (text.includes("rain") || text.includes("showers")) return precipitationChance !== null && precipitationChance < 40 ? "light-rain" : "rain";
  if (text.includes("fog") || text.includes("haze") || text.includes("mist")) return "fog";
  if (text.includes("windy") || text.includes("breezy")) return "windy";
  if (text.includes("overcast")) return "overcast";
  if (text.includes("mostly cloudy")) return night ? "mostly-cloudy-night" : "mostly-cloudy";
  if (text.includes("partly cloudy") || text.includes("partly sunny")) return night ? "partly-cloudy-night" : "partly-cloudy";
  if (text.includes("cloudy")) return "cloudy";
  if (night) return "clear-night";
  return "sunny";
}

function Cloud({ dark = false, x = 18, y = 31, scale = 1 }: { dark?: boolean; x?: number; y?: number; scale?: number }) {
  const fill = dark ? "url(#darkCloud)" : "url(#cloud)";
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="28" cy="22" rx="26" ry="15" fill={fill}/>
    <circle cx="18" cy="16" r="13" fill={fill}/>
    <circle cx="34" cy="11" r="17" fill={fill}/>
    <circle cx="49" cy="18" r="13" fill={fill}/>
  </g>;
}

function LightRainCloud({ x = 12, y = 26, scale = 1.05 }: { x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="28" cy="22" rx="26" ry="15" fill="url(#lightRainCloud)"/>
    <circle cx="18" cy="16" r="13" fill="url(#lightRainCloud)"/>
    <circle cx="34" cy="11" r="17" fill="url(#lightRainCloud)"/>
    <circle cx="49" cy="18" r="13" fill="url(#lightRainCloud)"/>
  </g>;
}

function Drops({ count = 4 }: { count?: number }) {
  const xs = count === 2 ? [36, 59] : count === 3 ? [30, 49, 68] : count === 5 ? [24, 37, 50, 63, 76] : [28, 43, 58, 73];
  return <g>{xs.map((x, i) => <path key={i} d={`M${x} 66c-5 7-7 10-7 14a7 7 0 0 0 14 0c0-4-2-7-7-14Z`} fill="url(#rain)"/>)}</g>;
}

export default function WeatherIcon({ kind, className = "" }: { kind: IconKind; className?: string }) {
  const night = kind.includes("night");
  const cloudDark = ["heavy-rain","thunderstorms","severe-storms","overcast"].includes(kind);
  return <svg className={className} viewBox="0 0 100 100" role="img" aria-label={kind.replaceAll("-", " ")}>
    <defs>
      <radialGradient id="sun" cx="38%" cy="35%"><stop offset="0" stopColor="#fff69a"/><stop offset=".55" stopColor="#ffd42a"/><stop offset="1" stopColor="#ff9c16"/></radialGradient>
      <linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f7fbff"/><stop offset=".55" stopColor="#b8d8ff"/><stop offset="1" stopColor="#78aee8"/></linearGradient>
      <linearGradient id="lightRainCloud" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffffff"/><stop offset=".58" stopColor="#eef7ff"/><stop offset="1" stopColor="#cfe8ff"/></linearGradient>
      <linearGradient id="darkCloud" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#7d95b9"/><stop offset=".55" stopColor="#506b96"/><stop offset="1" stopColor="#30476c"/></linearGradient>
      <linearGradient id="rain" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#65d2ff"/><stop offset="1" stopColor="#1687ff"/></linearGradient>
      <linearGradient id="moon" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff2a7"/><stop offset="1" stopColor="#ffca5f"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>

    {kind === "sunny" && <g filter="url(#glow)"><g stroke="#ffb111" strokeWidth="4" strokeLinecap="round">{[[50,8,50,18],[50,82,50,92],[8,50,18,50],[82,50,92,50],[20,20,27,27],[73,73,80,80],[20,80,27,73],[73,27,80,20]].map((v,i)=><line key={i} x1={v[0]} y1={v[1]} x2={v[2]} y2={v[3]}/>)}</g><circle cx="50" cy="50" r="25" fill="url(#sun)"/></g>}

    {night && <g filter="url(#glow)"><path d="M57 18a26 26 0 1 0 20 43A22 22 0 0 1 57 18Z" fill="url(#moon)"/>{kind === "clear-night" && <g fill="#ffe88b"><circle cx="76" cy="23" r="2"/><circle cx="82" cy="37" r="1.6"/><circle cx="67" cy="31" r="1.4"/></g>}</g>}

    {kind === "partly-cloudy" && <><g filter="url(#glow)"><circle cx="35" cy="32" r="20" fill="url(#sun)"/></g><Cloud x={22} y={35} scale={.95}/></>}
    {kind === "mostly-cloudy" && <><Cloud x={30} y={20} scale={.9}/><Cloud x={12} y={38} scale={.95}/></>}
    {kind === "cloudy" && <><Cloud x={24} y={22} scale={.9}/><Cloud x={9} y={39} scale={1.02}/></>}
    {kind === "overcast" && <><Cloud dark x={24} y={22} scale={.9}/><Cloud dark x={9} y={39} scale={1.02}/></>}
    {kind === "partly-cloudy-night" && <Cloud x={23} y={43} scale={.9}/>} 
    {kind === "mostly-cloudy-night" && <><Cloud dark x={32} y={33} scale={.8}/><Cloud dark x={13} y={45} scale={.95}/></>}

    {kind === "chance-thunderstorms" && <><Cloud x={13} y={30} scale={1.02}/><path d="M59 58 51 72h8l-5 13 16-20h-8l6-7Z" fill="#ffd41f" stroke="#ffad00" strokeWidth="1.2"/><Drops count={2}/></>}
    {kind === "light-rain" && <LightRainCloud/>}
    {["rain","heavy-rain","thunderstorms","severe-storms"].includes(kind) && <Cloud dark={cloudDark} x={12} y={26} scale={1.05}/>} 
    {kind === "light-rain" && <Drops count={2}/>} 
    {kind === "rain" && <Drops count={4}/>} 
    {kind === "heavy-rain" && <Drops count={5}/>} 
    {(kind === "thunderstorms" || kind === "severe-storms") && <><Drops count={kind === "severe-storms" ? 5 : 3}/><path d="M54 56 43 75h10l-7 18 22-27H57l8-10Z" fill="#ffd41f" stroke="#ffad00" strokeWidth="1.5"/></>}

    {kind === "snow" && <><Cloud x={12} y={25} scale={1.05}/><g fill="#d9eeff" fontSize="18" fontWeight="700"><text x="25" y="84">✣</text><text x="47" y="89">✣</text><text x="68" y="82">✣</text></g></>}
    {kind === "wintry-mix" && <><Cloud x={12} y={25} scale={1.05}/><g fill="#d9eeff" fontSize="15" fontWeight="700"><text x="25" y="84">✣</text></g><Drops count={3}/></>}
    {kind === "blowing-snow" && <><g stroke="#a8d7ff" strokeWidth="6" strokeLinecap="round" fill="none"><path d="M15 42h54c13 0 14-18 3-18-7 0-9 5-9 9"/><path d="M20 58h62c10 0 11 15 1 15-5 0-7-4-7-7"/></g><g fill="#d9eeff" fontSize="14"><text x="22" y="88">✣</text><text x="47" y="91">✣</text></g></>}
    {kind === "sleet" && <><Cloud x={12} y={25} scale={1.05}/><g fill="#eaf6ff">{[28,43,58,73].map((x,i)=><circle key={i} cx={x} cy={78+(i%2)*7} r="4"/>)}</g></>}
    {kind === "freezing-rain" && <><Cloud x={12} y={23} scale={1.05}/><path d="M29 60 36 88 43 60ZM57 60 62 91 70 60Z" fill="#aee6ff"/><Drops count={2}/></>}
    {kind === "fog" && <><Cloud dark x={21} y={16} scale={.75}/><g stroke="#81a8d7" strokeWidth="6" strokeLinecap="round"><line x1="20" y1="64" x2="80" y2="64"/><line x1="14" y1="76" x2="72" y2="76"/><line x1="28" y1="88" x2="84" y2="88"/></g></>}
    {kind === "windy" && <g stroke="#9bd0ff" strokeWidth="7" strokeLinecap="round" fill="none"><path d="M12 35h55c14 0 14-18 3-18-7 0-9 5-9 9"/><path d="M18 54h67c10 0 11 15 1 15-5 0-7-4-7-7"/><path d="M25 73h38c10 0 10 13 1 13-5 0-6-3-6-6"/></g>}
  </svg>;
}
