/** 白底友好的墨迹风格天气插画（柔和渐变 SVG，无外链） */

export type WeatherArtKind =
  | "sunny"
  | "mostly-sunny"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "shower"
  | "thunder"
  | "unknown";

export function weatherArtKind(code: number): WeatherArtKind {
  if (code === 0) return "sunny";
  if (code === 1) return "mostly-sunny";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "shower";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "thunder";
  return "unknown";
}

function Sun({ cx = 40, cy = 36, r = 14 }: { cx?: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 10} fill="url(#w-sun-glow)" opacity="0.7" />
      <circle cx={cx} cy={cy} r={r} fill="url(#w-sun)" />
      <circle cx={cx - 3} cy={cy - 3} r={r * 0.35} fill="#fff6d0" opacity="0.65" />
    </g>
  );
}

function Cloud({
  x = 18,
  y = 38,
  scale = 1,
  fill = "url(#w-cloud)",
}: {
  x?: number;
  y?: number;
  scale?: number;
  fill?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="28" cy="22" rx="28" ry="16" fill={fill} />
      <circle cx="12" cy="18" r="14" fill={fill} />
      <circle cx="36" cy="14" r="16" fill={fill} />
      <circle cx="48" cy="20" r="12" fill={fill} />
    </g>
  );
}

function RainDrops({ x = 28, y = 58 }: { x?: number; y?: number }) {
  return (
    <g stroke="#3b9ae8" strokeWidth="2.4" strokeLinecap="round" opacity="0.95">
      <line x1={x} y1={y} x2={x - 2} y2={y + 10} />
      <line x1={x + 12} y1={y + 2} x2={x + 10} y2={y + 12} />
      <line x1={x + 24} y1={y} x2={x + 22} y2={y + 10} />
      <line x1={x + 36} y1={y + 3} x2={x + 34} y2={y + 13} />
    </g>
  );
}

function SnowFlakes({ x = 30, y = 58 }: { x?: number; y?: number }) {
  const flakes = [0, 14, 28, 40];
  return (
    <g fill="#6eb0ef">
      {flakes.map((dx, i) => (
        <circle key={i} cx={x + dx} cy={y + (i % 2) * 6} r="2.4" opacity={0.95 - i * 0.06} />
      ))}
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <radialGradient id="w-sun" cx="35%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#ffe070" />
        <stop offset="50%" stopColor="#ffb024" />
        <stop offset="100%" stopColor="#f07800" />
      </radialGradient>
      <radialGradient id="w-sun-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ffcc55" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#ffcc55" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="w-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#eef4ff" />
        <stop offset="100%" stopColor="#9eb6d8" />
      </linearGradient>
      <linearGradient id="w-cloud-deep" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#d4e0f2" />
        <stop offset="100%" stopColor="#7a94b8" />
      </linearGradient>
      <linearGradient id="w-fog" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#b8c8e0" stopOpacity="0" />
        <stop offset="40%" stopColor="#8fa6c4" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#b8c8e0" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="w-bolt" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#ffe033" />
        <stop offset="100%" stopColor="#ff9800" />
      </linearGradient>
    </defs>
  );
}

function ArtBody({ kind }: { kind: WeatherArtKind }) {
  switch (kind) {
    case "sunny":
      return <Sun cx={48} cy={42} r={18} />;
    case "mostly-sunny":
      return (
        <>
          <Sun cx={58} cy={30} r={14} />
          <Cloud x={8} y={42} scale={0.92} />
        </>
      );
    case "partly-cloudy":
      return (
        <>
          <Sun cx={62} cy={28} r={12} />
          <Cloud x={6} y={36} scale={1} />
        </>
      );
    case "cloudy":
      return (
        <>
          <Cloud x={4} y={28} scale={0.85} fill="url(#w-cloud-deep)" />
          <Cloud x={14} y={38} scale={1} />
        </>
      );
    case "fog":
      return (
        <>
          <Cloud x={10} y={26} scale={0.9} fill="url(#w-cloud-deep)" />
          <rect x="8" y="58" width="80" height="6" rx="3" fill="url(#w-fog)" />
          <rect x="14" y="68" width="68" height="5" rx="2.5" fill="url(#w-fog)" opacity="0.75" />
          <rect x="18" y="77" width="60" height="4" rx="2" fill="url(#w-fog)" opacity="0.55" />
        </>
      );
    case "drizzle":
      return (
        <>
          <Cloud x={12} y={22} scale={0.95} />
          <RainDrops x={30} y={56} />
        </>
      );
    case "rain":
    case "shower":
      return (
        <>
          <Cloud x={8} y={18} scale={1} fill="url(#w-cloud-deep)" />
          <RainDrops x={26} y={54} />
        </>
      );
    case "snow":
      return (
        <>
          <Cloud x={10} y={20} scale={0.98} />
          <SnowFlakes x={28} y={56} />
        </>
      );
    case "thunder":
      return (
        <>
          <Cloud x={8} y={16} scale={1} fill="url(#w-cloud-deep)" />
          <path
            d="M48 52 L40 68 H48 L42 84 L62 62 H52 L58 52 Z"
            fill="url(#w-bolt)"
          />
          <RainDrops x={22} y={58} />
        </>
      );
    default:
      return <Cloud x={14} y={34} scale={1} />;
  }
}

export default function WeatherArt({
  code,
  className,
}: {
  code: number;
  className?: string;
}) {
  const kind = weatherArtKind(code);
  return (
    <svg
      viewBox="0 0 96 96"
      className={className}
      aria-hidden
      focusable="false"
    >
      <Defs />
      <ArtBody kind={kind} />
    </svg>
  );
}
