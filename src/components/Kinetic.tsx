"use client";
import { useEffect, useRef, useState } from "react";

/** Elastic type: each letter stretches (wdth/weight) toward the cursor, like a typographic grid that breathes. */
export function ElasticText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const spans = Array.from(el.querySelectorAll<HTMLSpanElement>("span[data-l]"));
    let mx = -9999, my = -9999, raf = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    const onLeave = () => { mx = -9999; };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const s of spans) {
        const r = s.getBoundingClientRect();
        const d = Math.hypot(mx - (r.left + r.width / 2), my - (r.top + r.height / 2));
        const k = Math.max(0, 1 - d / 260);
        const cur = Number(s.dataset.k ?? 0), next = cur + (k - cur) * 0.18;
        s.dataset.k = String(next);
        s.style.fontVariationSettings = `"wdth" ${100 - next * 38}, "opsz" 96`;
        s.style.fontWeight = String(800 - Math.round(next * 500));
        s.style.transform = `translateY(${-next * 6}px)`;
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true }); el.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); };
  }, []);
  return (
    <span ref={ref} className={className} aria-label={text}>
      {text.split("").map((ch, i) => ch === " " ? <span key={i}> </span> : <span key={i} data-l className="inline-block will-change-transform" style={{ transition: "none" }}>{ch}</span>)}
    </span>
  );
}

/** Split-flap board: each character flips through the alphabet to its target. */
const FLAP = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.:-$▲▼◆@";
function Flap({ target }: { target: string }) {
  const [ch, setCh] = useState(" ");
  useEffect(() => {
    let cur = ch, id = 0;
    const tgt = FLAP.includes(target) ? target : " ";
    const step = () => {
      if (cur === tgt) return;
      cur = FLAP[(FLAP.indexOf(cur) + 1) % FLAP.length];
      setCh(cur);
      id = window.setTimeout(step, 28);
    };
    id = window.setTimeout(step, Math.random() * 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return <span className="inline-block w-[0.75em] overflow-hidden border-r border-white/10 text-center last:border-0">{ch}</span>;
}
export function FlipLine({ text, width = 32 }: { text: string; width?: number }) {
  const t = text.toUpperCase().padEnd(width).slice(0, width);
  return <div className="mono flex text-[0.9rem] leading-[1.9] tracking-[0.04em] text-white/90">{t.split("").map((c, i) => <Flap key={i} target={c} />)}</div>;
}
export function FlipBoard({ lines, width = 34, className = "" }: { lines: string[]; width?: number; className?: string }) {
  return (
    <div className={`rounded-[18px] bg-ink p-4 ${className}`}>
      <div className="mb-2 flex items-center justify-between font-mono text-[0.62rem] uppercase tracking-[0.14em] text-white/40"><span>departures · on-chain</span><span className="live-dot" /></div>
      <div className="divide-y divide-white/5">{lines.map((l, i) => <FlipLine key={`${i}-${l}`} text={l} width={width} />)}</div>
    </div>
  );
}

/** Halftone morph: dot grid that morphs between two silhouettes (wisp ↔ ring) in a brand colour. */
export function HalftoneMorph({ className = "", color = "#0b0b0c", bg = "#b9b3ff" }: { className?: string; color?: string; bg?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0; const start = performance.now();
    const N = 44;
    const wisp = (x: number, y: number) => { // teardrop sdf-ish (0..1 space)
      const px = (x - 0.5) * 2, py = (y - 0.5) * 2 + 0.1;
      const w = 0.52 * (1 - Math.max(0, py) * 0.85);
      return Math.max(Math.abs(px) / Math.max(w, 0.02), (py < 0 ? Math.hypot(px, (py + 0.35) * 1.2) / 0.62 : 0), -py - 0.72) < 1 ? 1 : 0;
    };
    const ring = (x: number, y: number) => { const d = Math.hypot((x - 0.5) * 2, (y - 0.5) * 2); return d < 0.86 && d > 0.5 ? 1 : 0; };
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const t = (now - start) / 1000; const k = (Math.sin(t * 0.7) + 1) / 2; // 0 wisp, 1 ring
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const cell = Math.min(W, H) / N, ox = (W - cell * N) / 2, oy = (H - cell * N) / 2;
      ctx.fillStyle = color;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = (i + 0.5) / N, y = 1 - (j + 0.5) / N;
        const a = wisp(x, y), b = ring(x, y);
        const wave = 0.5 + 0.5 * Math.sin(t * 2 + i * 0.35 + j * 0.2);
        const r = (a * (1 - k) + b * k) * (0.28 + wave * 0.22) + 0.04;
        ctx.beginPath(); ctx.arc(ox + (i + 0.5) * cell, oy + (j + 0.5) * cell, cell * r, 0, Math.PI * 2); ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color, bg]);
  return <canvas ref={ref} className={`h-full w-full ${className}`} aria-hidden="true" />;
}

/** Curve: a bonding curve drawn with trailing ink particles, like a poster line. */
export function CurveLine({ className = "", color = "#0b0b0c" }: { className?: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext("2d")!;
    let raf = 0; const start = performance.now();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const t = (now - start) / 1000; ctx.clearRect(0, 0, W, H);
      const prog = (Math.sin(t * 0.5 - Math.PI / 2) + 1) / 2; // 0..1 sweeps
      const f = (x: number) => 1 - Math.pow(1 - x, 2.6);
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = color; ctx.setLineDash([4 * dpr, 6 * dpr]); ctx.beginPath();
      for (let i = 0; i <= 100; i++) { const x = i / 100; const px = x * W, py = H - f(x) * H * 0.9 - H * 0.05; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 6 * dpr; ctx.lineCap = "round"; ctx.beginPath();
      for (let i = 0; i <= 100 * prog; i++) { const x = i / 100; const px = x * W, py = H - f(x) * H * 0.9 - H * 0.05; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
      // graduation marker
      const gx = W * 0.86, gy = H - f(0.86) * H * 0.9 - H * 0.05;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(gx, gy, 7 * dpr, 0, Math.PI * 2); ctx.fill();
      // particles along the head
      const hx = prog * W, hy = H - f(prog) * H * 0.9 - H * 0.05;
      for (let k = 0; k < 14; k++) { const a = t * 3 + k; const r = 10 * dpr + (k % 5) * 6 * dpr; ctx.globalAlpha = 0.25 + 0.5 * ((k % 3) / 2); ctx.beginPath(); ctx.arc(hx + Math.cos(a) * r, hy + Math.sin(a * 1.3) * r, 2 * dpr, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color]);
  return <canvas ref={ref} className={`h-full w-full ${className}`} aria-hidden="true" />;
}

/** Counter that eases up to its value. */
export function Counter({ value, className = "" }: { value: number; className?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => { let f = 0; const id = setInterval(() => { f++; setV(Math.round(value * (1 - Math.pow(1 - f / 30, 3)))); if (f >= 30) clearInterval(id); }, 24); return () => clearInterval(id); }, [value]);
  return <span className={`num ${className}`}>{v.toLocaleString()}</span>;
}

/** Terminal that types commands and prints responses. */
type Line = { kind: "cmd" | "out"; text: string };
export function Terminal({ scripts, title = "agent session", className = "" }: { scripts: Line[][]; title?: string; className?: string }) {
  const [si, setSi] = useState(0); const [li, setLi] = useState(0); const [ch, setCh] = useState(0);
  const script = scripts[si % scripts.length];
  useEffect(() => {
    const line = script[li];
    if (!line) { const t = setTimeout(() => { setSi(si + 1); setLi(0); setCh(0); }, 3200); return () => clearTimeout(t); }
    const t = setTimeout(() => { if (line.kind === "cmd" && ch < line.text.length) setCh(ch + Math.max(1, Math.round(Math.random() * 2))); else { setLi(li + 1); setCh(0); } }, line.kind === "cmd" ? 22 : 420);
    return () => clearTimeout(t);
  }, [si, li, ch, script]);
  return (
    <div className={className}>
      <div className="term-bar"><span className="term-dot" /><span className="term-dot" /><span className="term-dot" /><span className="ml-2">{title}</span></div>
      <pre className="code scrollbar-thin min-h-[280px] !rounded-t-none">
        {script.slice(0, li + 1).map((l, idx) => (
          <div key={idx} className={l.kind === "cmd" ? "text-white" : "text-white/55"}>
            {l.kind === "cmd" ? <span className="text-lime">$ </span> : ""}
            {idx === li && l.kind === "cmd" ? l.text.slice(0, ch) : l.text}
            {idx === li && l.kind === "cmd" && <span className="animate-[blink_1s_steps(2)_infinite] text-lime">▌</span>}
          </div>
        ))}
      </pre>
    </div>
  );
}
