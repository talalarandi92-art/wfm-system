import { useMemo } from 'react';

/**
 * LivingBackground — a calm, premium, animated canvas that sits behind the whole
 * app (fixed, z-index:-1, pointer-events:none). Drifting brand auroras + a faint
 * masked grid for depth + a few slow floating motes. Pure CSS transforms, so it
 * stays cheap; the global prefers-reduced-motion rule freezes all of it.
 * Mounted once in AppLayout, so every page breathes the same living surface.
 */
export default function LivingBackground() {
  // a handful of motes with stable per-mount randomness (CSR only, no hydration)
  const motes = useMemo(() => {
    const COLORS = ['rgba(129,140,248,0.9)', 'rgba(34,211,238,0.85)', 'rgba(167,139,250,0.85)', 'rgba(255,255,255,0.7)'];
    return Array.from({ length: 16 }, (_, i) => {
      const size = 2 + Math.round(Math.random() * 4);
      return {
        left: Math.round(Math.random() * 100),
        size,
        color: COLORS[i % COLORS.length],
        duration: 20 + Math.round(Math.random() * 22),   // 20–42s
        delay: -Math.round(Math.random() * 30),          // negative → already in flight
        blur: size > 4 ? 1 : 0,
      };
    });
  }, []);

  return (
    <div className="living-bg" aria-hidden="true">
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <div className="aurora a4" />
      <div className="gridlines" />
      {motes.map((m, i) => (
        <span
          key={i}
          className="mote"
          style={{
            left: `${m.left}%`,
            width: m.size,
            height: m.size,
            background: m.color,
            filter: m.blur ? `blur(${m.blur}px)` : undefined,
            boxShadow: `0 0 ${m.size * 2}px ${m.color}`,
            animation: `moteRise ${m.duration}s linear ${m.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
