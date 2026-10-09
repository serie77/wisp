/**
 * Wisp mark: a flame within a flame. One colour, evenodd cut, curled tip.
 * Reads at 16px (favicon) and at 240px (hero lockups).
 */
export const MARK_PATH = "M30 3c6 2 8 7 7 12-1 5-5 9-9 14-4 5-6 9-6 15a14 14 0 0 0 28 0c0-6-2-10-6-15-4-5-6-8-5-13 2-5 0-10-9-13zM33 25c1 5-3 8-6 12-3 4-4 7-4 10a8 8 0 0 0 16 0c0-3-1-6-4-10-3-4-3-7-2-12z";

export function WispMark({ size = 28, className = "", color = "currentColor", style }: { size?: number; className?: string; color?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={style} aria-hidden="true">
      <path fillRule="evenodd" fill={color} d={MARK_PATH} />
    </svg>
  );
}

/** Wordmark: "wisp" set in the display face, with the mark standing in for the dot of the i. */
export function Wordmark({ className = "", size = 1.4 }: { className?: string; size?: number }) {
  return (
    <span className={`display inline-flex items-baseline leading-none tracking-[-0.05em] ${className}`} style={{ fontSize: `${size}rem` }} aria-label="wisp">
      <span aria-hidden>w</span>
      <span aria-hidden className="relative inline-block">
        ı
        <WispMark size={size * 11.5} className="absolute left-1/2 -translate-x-1/2" style={{ top: `${-size * 0.62}rem` }} />
      </span>
      <span aria-hidden>sp</span>
    </span>
  );
}
