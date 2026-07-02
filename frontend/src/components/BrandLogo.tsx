import { useId } from 'react';

/**
 * BrandLogo — the Director's fused mark (approved 2026-07-01, executed 2026-07-02).
 *
 * Four concepts fused into one seal:
 *   الختم    — the hexagonal gold seal frame (his signature stamp)
 *   المُنسّق — the constellation spokes + corner nodes (the orchestrator uniting the workforce)
 *   T        — the monogram at the heart (Talal — it carries his name)
 *   نجمة الشمال — the north star above the T (the reference everyone calibrates to)
 *   التاج    — the small crown riding the seal's crest (quiet mastery)
 *
 * Gold (#b8860b→#f4d67b→#d9b74e) on indigo/violet (#8b5cf6→#6366f1) — reads perfectly
 * on all three themes (Dark / Light / Aurora). Pure SVG, no external assets.
 */
export default function BrandLogo({ size = 40, glow = false }: { size?: number; glow?: boolean }) {
  const uid = useId().replace(/[:]/g, '');
  const g = `blg-${uid}`, v = `blv-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="WFM Platform"
      style={glow ? { filter: 'drop-shadow(0 6px 18px rgba(230,193,90,0.35)) drop-shadow(0 2px 8px rgba(99,102,241,0.35))' } : undefined}
    >
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b8860b" />
          <stop offset="0.5" stopColor="#f4d67b" />
          <stop offset="1" stopColor="#d9b74e" />
        </linearGradient>
        <linearGradient id={v} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* الختم — hexagonal seal */}
      <polygon points="50,13 86,32 86,72 50,93 14,72 14,32" fill="none" stroke={`url(#${g})`} strokeWidth="2.6" strokeLinejoin="round" />
      <polygon points="50,19 80,35 80,69 50,87 20,69 20,35" fill="none" stroke={`url(#${g})`} strokeWidth="0.7" opacity="0.4" />

      {/* المُنسّق — constellation spokes + corner nodes */}
      <g stroke="#6366f1" strokeWidth="1" opacity="0.4">
        <line x1="50" y1="53" x2="50" y2="19" />
        <line x1="50" y1="53" x2="80" y2="35" />
        <line x1="50" y1="53" x2="80" y2="69" />
        <line x1="50" y1="53" x2="50" y2="87" />
        <line x1="50" y1="53" x2="20" y2="69" />
        <line x1="50" y1="53" x2="20" y2="35" />
      </g>
      <g fill={`url(#${g})`}>
        <circle cx="80" cy="35" r="2.4" />
        <circle cx="80" cy="69" r="2.4" />
        <circle cx="50" cy="87" r="2.4" />
        <circle cx="20" cy="69" r="2.4" />
        <circle cx="20" cy="35" r="2.4" />
      </g>

      {/* التاج — crown riding the crest */}
      <path d="M39,12 L43.5,3 L50,9.5 L56.5,3 L61,12 Z" fill={`url(#${g})`} />
      <circle cx="43.5" cy="3" r="1.9" fill={`url(#${v})`} />
      <circle cx="56.5" cy="3" r="1.9" fill={`url(#${v})`} />

      {/* نجمة الشمال — above the monogram */}
      <path d="M50,24 L52.1,30 L58,32.2 L52.1,34.4 L50,40.4 L47.9,34.4 L42,32.2 L47.9,30 Z" fill={`url(#${v})`} />

      {/* T — the monogram */}
      <rect x="35" y="46" width="30" height="7.5" rx="2.2" fill={`url(#${g})`} />
      <rect x="46.2" y="46" width="7.6" height="30" rx="2.2" fill={`url(#${g})`} />
    </svg>
  );
}
