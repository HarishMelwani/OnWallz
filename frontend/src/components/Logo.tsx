/**
 * The OnWallz mark: a wall of three courses, drawn as bricks, with one brick
 * standing proud of the others — a note left by someone.
 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="OnWallz"
      fill="none"
    >
      {/* three courses of brick, offset like real masonry */}
      <rect x="1.5" y="4.5" width="9" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="4.5" width="9.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="1.5" y="11.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="11.5" width="13.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" />
      {/* the note: one brick lifted out, filled */}
      <rect x="6.5" y="18.5" width="11" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}
