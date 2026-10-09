"use client";
import { useEffect, useRef, useState } from "react";

const TONES = [["#b9b3ff", "#0b0b0c"], ["#b4ff3c", "#0b0b0c"], ["#ff5fb4", "#0b0b0c"], ["#f5f06a", "#0b0b0c"], ["#2d3dff", "#ffffff"], ["#0b0b0c", "#b9b3ff"]];

/**
 * A token's image, or a badge (symbol initial on a brand colour picked from the mint) when the
 * image is missing, fails to load, or is a placeholder pixel.
 */
export function TokenImage({ src, mint, symbol, size, className = "" }: { src?: string | null; mint: string; symbol?: string | null; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image can finish (or fail) before hydration attaches onLoad/onError; check it once on mount.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth < 16) setFailed(true);
  }, [src]);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={ref} src={src} alt="" loading="lazy" width={size} height={size} className={`shrink-0 object-cover ${className}`} style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        onLoad={(e) => { if (e.currentTarget.naturalWidth < 16) setFailed(true); }} />
    );
  }
  let h = 0;
  for (const c of mint) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = TONES[h % TONES.length];
  return (
    <div aria-hidden className={`display flex shrink-0 items-center justify-center select-none ${className}`} style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.46 }}>
      <span>{(symbol || "?").replace(/^\$/, "").charAt(0).toUpperCase()}</span>
    </div>
  );
}
