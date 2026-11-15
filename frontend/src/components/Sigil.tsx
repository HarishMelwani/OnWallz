/** A deterministic mark for an anonymous writer.
 *
 *  Every post gets its own sigil, derived from its id. Two posts by the same
 *  person look unrelated — which is exactly what the chain does too. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function Sigil({ seed, size = 40 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const variant = h % 6;
  const rot = (h >>> 3) % 4;
  const palette = ["var(--accent)", "var(--ink-2)", "var(--good)"];
  const fg = palette[(h >>> 5) % palette.length];
  const bg = "var(--surface-2)";

  const shapes = [
    <circle cx="20" cy="20" r="9" />,
    <rect x="11" y="11" width="18" height="18" rx="4" />,
    <path d="M20 9 L31 30 L9 30 Z" />,
    <path d="M9 20 a11 11 0 0 1 22 0" strokeWidth="4" fill="none" stroke={fg} />,
    <g>
      <circle cx="14" cy="14" r="4" />
      <circle cx="26" cy="26" r="4" />
      <circle cx="26" cy="14" r="2.5" />
    </g>,
    <g>
      <rect x="10" y="10" width="20" height="5" rx="2.5" />
      <rect x="10" y="18" width="13" height="5" rx="2.5" />
      <rect x="10" y="26" width="20" height="5" rx="2.5" />
    </g>,
  ];

  return (
    <svg
      className="sigil"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      style={{ background: bg }}
    >
      <g
        transform={`rotate(${rot * 90} 20 20)`}
        fill={fg}
        stroke={fg}
        strokeWidth={0}
      >
        {shapes[variant]}
      </g>
    </svg>
  );
}