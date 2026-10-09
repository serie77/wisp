"use client";
import { useEffect, useRef, type ElementType } from "react";

const GLYPHS = "▮▯░▒▓█#%&@/\\|·:;=+*<>[]{}()◆◇○●△▽ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Kinetic glyph text. On reveal, every character cycles through a glyph set and resolves
 * left to right (decode). On hover, letters narrow and lighten toward the cursor (elastic)
 * and re-scramble briefly. Works on any heading or label; keeps the real text for a11y.
 */
export function Glyph({
  text, as: Tag = "span", className = "", elastic = true, scramble = true, delay = 0, speed = 1, once = true,
}: { text: string; as?: ElementType; className?: string; elastic?: boolean; scramble?: boolean; delay?: number; speed?: number; once?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const spans = Array.from(el.querySelectorAll<HTMLSpanElement>("span[data-g]"));
    const finals = spans.map((s) => s.dataset.g ?? "");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, mx = -9999, my = -9999, played = false;

    const decode = (startDelay = delay) => {
      if (reduced || !scramble) { spans.forEach((s, i) => (s.textContent = finals[i])); return; }
      const t0 = performance.now() + startDelay;
      const per = 38 / speed; // ms per char resolve
      const step = (now: number) => {
        const t = now - t0;
        let done = true;
        spans.forEach((s, i) => {
          const resolveAt = i * per + 220 / speed;
          if (t < 0) { s.textContent = finals[i]; done = false; return; }
          if (t < resolveAt) { done = false; if (Math.random() < 0.5) s.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; }
          else s.textContent = finals[i];
        });
        if (!done) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting && (!played || !once)) { played = true; decode(); if (once) io.disconnect(); }
    }, { threshold: 0.2 });
    io.observe(el);

    let eraf = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    const onLeave = () => { mx = -9999; };
    const tick = () => {
      eraf = requestAnimationFrame(tick);
      if (!elastic) return;
      for (const s of spans) {
        const r = s.getBoundingClientRect();
        const d = Math.hypot(mx - (r.left + r.width / 2), my - (r.top + r.height / 2));
        const k = Math.max(0, 1 - d / 220);
        const cur = Number(s.dataset.k ?? 0), next = cur + (k - cur) * 0.2;
        if (Math.abs(next - cur) < 0.001 && next < 0.001) continue;
        s.dataset.k = String(next);
        s.style.fontVariationSettings = `"wdth" ${100 - next * 36}, "opsz" 96`;
        s.style.fontWeight = String(800 - Math.round(next * 480));
        s.style.transform = `translateY(${-next * 5}px)`;
      }
    };
    if (elastic && !reduced) { window.addEventListener("pointermove", onMove, { passive: true }); eraf = requestAnimationFrame(tick); }
    el.addEventListener("pointerleave", onLeave);
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(eraf); io.disconnect(); window.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const words = text.split(" ");
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {words.map((w, wi) => (
        <span key={wi} aria-hidden>
          <span className="inline-block whitespace-nowrap">{w.split("").map((ch, i) => <span key={i} data-g={ch} className="inline-block will-change-transform">{ch}</span>)}</span>
          {wi < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}

/** Multi-line kinetic heading: each line decodes in sequence. */
export function GlyphLines({ lines, className = "", lineClass = "", as: Tag = "h1" }: { lines: string[]; className?: string; lineClass?: string; as?: ElementType }) {
  return (
    <Tag className={className}>
      {lines.map((l, i) => <span key={i} className={`block ${lineClass}`}><Glyph text={l} delay={i * 180} /></span>)}
    </Tag>
  );
}

/** Glyph field: a canvas of characters whose density follows a flowing noise field + the cursor. Section background. */
export function GlyphField({ className = "", color = "#0b0b0c", alpha = 0.12, chars = "·:+*#%@▮", cell = 18 }: { className?: string; color?: string; alpha?: number; chars?: string; cell?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext("2d")!;
    let raf = 0, mx = -1e4, my = -1e4; const start = performance.now();
    const onMove = (e: PointerEvent) => { const r = c.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; };
    const onLeave = () => { mx = -1e4; };
    const parent = c.parentElement ?? c;
    parent.addEventListener("pointermove", onMove, { passive: true }); parent.addEventListener("pointerleave", onLeave);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n2 = (x: number, y: number) => { const s = Math.sin(x * 1.7 + y * 2.3) * Math.cos(x * 0.9 - y * 1.1) * 0.5 + Math.sin(x * 3.1 + y * 0.7) * 0.25; return s * 0.5 + 0.5; };
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = Math.floor(c.clientWidth * dpr), H = Math.floor(c.clientHeight * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const t = reduced ? 10 : (now - start) / 1000;
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = color; ctx.font = `${cell * dpr * 0.8}px ui-monospace, Menlo, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const cols = Math.ceil(W / (cell * dpr)), rows = Math.ceil(H / (cell * dpr));
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cell * dpr, y = (j + 0.5) * cell * dpr;
        const v = n2(i * 0.08 + t * 0.15, j * 0.08 - t * 0.1);
        const dm = Math.hypot(x / dpr - mx, y / dpr - my); const boost = Math.max(0, 1 - dm / 180);
        const level = Math.min(1, v * 0.9 + boost);
        if (level < 0.42) continue;
        ctx.globalAlpha = alpha * (0.4 + level) + boost * 0.5;
        ctx.fillText(chars[Math.min(chars.length - 1, Math.floor((level - 0.42) / 0.58 * chars.length))], x, y);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); parent.removeEventListener("pointermove", onMove); parent.removeEventListener("pointerleave", onLeave); };
  }, [color, alpha, chars, cell]);
  return <canvas ref={ref} className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true" />;
}

/* ───────────────────────── Glyph art: density fields rendered as characters ───────────────────────── */
export type Preset = "flame" | "candles" | "rings" | "ripple" | "swarm" | "waves" | "stream" | "coin" | "column" | "noise" | "orbit" | "lissajous" | "tunnel" | "dither" | "rain";
const DENSE = " .·:-=+*≡#%@▮";

function presetFn(preset: Preset): (x: number, y: number, t: number, mx: number, my: number) => number {
  const n = (x: number, y: number) => Math.sin(x * 1.9 + y * 2.1) * 0.5 + Math.sin(x * 0.7 - y * 1.3) * 0.3 + Math.cos(x * 3.3 + y * 0.4) * 0.2;
  switch (preset) {
    case "flame": return (x, y, t) => { const px = (x - 0.5) * 2 + n(y * 3 - t, 1.3) * 0.18 * y; const w = 0.55 * (1 - Math.max(0, y - 0.1)) + 0.05; const body = Math.max(0, 1 - Math.abs(px) / w); const v = body * (0.55 + 0.5 * n(px * 3, y * 4 - t * 1.6)); return y > 0.98 ? 0 : v; };
    case "candles": return (x, y, t) => { const i = Math.floor(x * 14); const h = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.8) * Math.cos(i * 0.6 - t * 0.5)); const inBar = (x * 14) % 1 < 0.7; const up = Math.sin(i * 2.3 + t * 0.4) > 0; return inBar && 1 - y < h ? (up ? 1 : 0.55) * (0.6 + 0.4 * (1 - y) / h) : 0; };
    case "rings": return (x, y, t) => { const d = Math.hypot((x - 0.5) * 2, (y - 0.5) * 2); const a = Math.atan2(y - 0.5, x - 0.5); const r1 = Math.exp(-Math.pow((d - 0.75) * 9, 2)) * (0.5 + 0.5 * Math.sin(a * 3 + t * 1.2)); const r2 = Math.exp(-Math.pow((d - 0.42) * 9, 2)) * (0.5 + 0.5 * Math.sin(a * 5 - t * 1.6)); return Math.min(1, r1 + r2); };
    case "ripple": return (x, y, t, mx, my) => { const d = Math.hypot(x - (mx >= 0 ? mx : 0.5), y - (my >= 0 ? my : 0.5)); return 0.5 + 0.5 * Math.sin(d * 28 - t * 3) * Math.exp(-d * 2.2); };
    case "swarm": return (x, y, t) => { let v = 0; for (let k = 0; k < 9; k++) { const px = 0.5 + 0.4 * Math.sin(t * 0.6 + k * 1.3) * Math.cos(k * 0.7 + t * 0.2); const py = 0.5 + 0.4 * Math.cos(t * 0.5 + k * 2.1); v += Math.exp(-Math.hypot(x - px, y - py) * 9); } return Math.min(1, v); };
    case "waves": return (x, y, t) => { const w = 0.5 + 0.25 * Math.sin(x * 9 + t * 2) + 0.15 * Math.sin(x * 21 - t * 3.1); return Math.max(0, 1 - Math.abs(y - w) * 6) * 0.9 + (0.5 + 0.5 * Math.sin(x * 40 + t)) * 0.08; };
    case "stream": return (x, y, t) => { const v = n(x * 6 - t * 1.4, y * 2.5); return Math.max(0, v * 0.9 + 0.1); };
    case "coin": return (x, y, t) => { const wdt = Math.max(0.06, Math.abs(Math.cos(t * 1.1))) * 0.42; const d = Math.hypot((x - 0.5) / wdt, (y - 0.5) / 0.42); return d < 1 ? (d > 0.82 ? 1 : 0.35 + 0.3 * n(x * 8, y * 8 + t)) : 0; };
    case "column": return (x, y, t) => { const px = (x - 0.5) * 2; const v = Math.max(0, 1 - Math.abs(px) / 0.35) * (0.5 + 0.5 * n(px * 4, y * 6 - t * 2.2)); return v * (0.4 + 0.6 * (1 - y)); };
    case "orbit": return (x, y, t) => { let v = 0; for (let k = 0; k < 3; k++) { const a = t * (0.6 + k * 0.25) + k * 2.1; const px = 0.5 + 0.38 * Math.cos(a), py = 0.5 + 0.3 * Math.sin(a); v += Math.exp(-Math.hypot(x - px, y - py) * 7); } const d = Math.hypot((x - 0.5) / 0.4, (y - 0.5) / 0.32); return Math.min(1, v + Math.exp(-Math.pow((d - 1) * 8, 2)) * 0.5); };
    case "lissajous": return (x, y, t) => { let v = 0; for (let k = 0; k < 120; k++) { const u = (k / 120) * Math.PI * 2; const px = 0.5 + 0.42 * Math.sin(3 * u + t * 0.6), py = 0.5 + 0.4 * Math.sin(2 * u); v = Math.max(v, 1 - Math.hypot(x - px, y - py) * 11); } return v; };
    case "tunnel": return (x, y, t, mx, my) => { const cx = mx >= 0 ? mx : 0.5, cy = my >= 0 ? my : 0.5; const d = Math.max(Math.abs(x - cx), Math.abs(y - cy)); return 0.5 + 0.5 * Math.sin(d * 24 - t * 2.5); };
    case "dither": return (x, y, t) => Math.max(0, Math.min(1, (x * 0.6 + y * 0.4) + 0.2 * Math.sin(t + x * 5) + (Math.random() - 0.5) * 0.25));
    case "rain": return (x, y, t) => { const col = Math.floor(x * 40); const head = ((t * (0.4 + (col * 7919 % 13) / 20) + (col * 104729 % 97) / 97) % 1.3); const d = head - y; return d > 0 && d < 0.35 ? 1 - d / 0.35 : 0; };
    default: return (x, y, t) => 0.5 + 0.5 * n(x * 4 + t * 0.3, y * 4 - t * 0.2);
  }
}

/** A density field (preset) drawn as a grid of characters. Reacts to the cursor where the preset supports it. */
export function GlyphArt({ preset = "noise", chars = DENSE, color = "#0b0b0c", bg = "transparent", cell = 11, className = "", speed = 1, alpha = 1 }: { preset?: Preset; chars?: string; color?: string; bg?: string; cell?: number; className?: string; speed?: number; alpha?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext("2d")!;
    const f = presetFn(preset);
    let raf = 0, mx = -1, my = -1; const start = performance.now();
    const onMove = (e: PointerEvent) => { const r = c.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width; my = (e.clientY - r.top) / r.height; };
    const onLeave = () => { mx = -1; my = -1; };
    const host = c.parentElement ?? c; host.addEventListener("pointermove", onMove, { passive: true }); host.addEventListener("pointerleave", onLeave);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true; const io = new IntersectionObserver((es) => (visible = es[0]?.isIntersecting ?? true)); io.observe(c);
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || now - last < 1000 / 30) return; last = now;
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = Math.floor(c.clientWidth * dpr), H = Math.floor(c.clientHeight * dpr);
      if (!W || !H) return;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const t = reduced ? 3 : ((now - start) / 1000) * speed;
      if (bg === "transparent") ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = color; ctx.font = `${cell * dpr * 0.85}px ui-monospace, Menlo, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = alpha;
      const cols = Math.ceil(W / (cell * dpr)), rows = Math.ceil(H / (cell * dpr));
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const v = Math.max(0, Math.min(1, f((i + 0.5) / cols, (j + 0.5) / rows, t, mx, my)));
        const idx = Math.floor(v * (chars.length - 1));
        if (idx <= 0) continue;
        ctx.fillText(chars[idx], (i + 0.5) * cell * dpr, (j + 0.5) * cell * dpr);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); host.removeEventListener("pointermove", onMove); host.removeEventListener("pointerleave", onLeave); };
  }, [preset, chars, color, bg, cell, speed, alpha]);
  return <canvas ref={ref} className={`h-full w-full ${className}`} aria-hidden="true" />;
}

/** Cursor trail of decaying glyphs, site-wide. */
export function GlyphCursor() {
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden;font-family:ui-monospace,Menlo,monospace";
    document.body.appendChild(host);
    let last = 0, lx = 0, ly = 0;
    const G = "·:+*#%@▮◆○△=≡";
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < 28 || Math.hypot(e.clientX - lx, e.clientY - ly) < 6) return;
      last = now; lx = e.clientX; ly = e.clientY;
      const s = document.createElement("span");
      s.textContent = G[Math.floor(Math.random() * G.length)];
      const size = 9 + Math.random() * 9;
      const dark = document.elementFromPoint(e.clientX, e.clientY)?.closest(".ink");
      s.style.cssText = `position:absolute;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-50%);font-size:${size}px;color:${dark ? "#b9b3ff" : "#0b0b0c"};opacity:.8;transition:opacity .7s ease,transform .7s ease;will-change:transform,opacity`;
      host.appendChild(s);
      requestAnimationFrame(() => { s.style.opacity = "0"; s.style.transform = `translate(-50%,-50%) translate(${(Math.random() - 0.5) * 30}px,${-10 - Math.random() * 24}px) scale(.6)`; });
      setTimeout(() => s.remove(), 720);
      while (host.childElementCount > 60) host.firstElementChild?.remove();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); host.remove(); };
  }, []);
  return null;
}

/** A thin horizontal strip of streaming glyphs — a section divider. */
export function GlyphStream({ className = "", color = "#0b0b0c", alpha = 0.35, chars = " ·:-=+*#" }: { className?: string; color?: string; alpha?: number; chars?: string }) {
  return <div className={`h-9 w-full overflow-hidden ${className}`}><GlyphArt preset="stream" chars={chars} color={color} cell={12} alpha={alpha} speed={0.8} /></div>;
}

/* ───────────────────────── Block art: flowing fields quantized into three flat colours ───────────────────────── */
export type BlockPreset = "flow" | "dither" | "tunnel" | "lissajous" | "cells";
export function BlockArt({ preset = "flow", colors = ["#ff5fb4", "#b9b3ff", "#5be67a"], bg = "#ffffff", cell = 10, gap = 0.16, className = "", speed = 1 }: { preset?: BlockPreset; colors?: [string, string, string]; bg?: string; cell?: number; gap?: number; className?: string; speed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext("2d")!;
    let raf = 0, mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5; const start = performance.now();
    const host = c.parentElement ?? c;
    const onMove = (e: PointerEvent) => { const r = c.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width; ty = (e.clientY - r.top) / r.height; };
    const onLeave = () => { tx = 0.5; ty = 0.5; };
    host.addEventListener("pointermove", onMove, { passive: true }); host.addEventListener("pointerleave", onLeave);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true; const io = new IntersectionObserver((es) => (visible = es[0]?.isIntersecting ?? true)); io.observe(c);
    const n = (x: number, y: number) => Math.sin(x * 1.9 + y * 2.1) * 0.5 + Math.sin(x * 0.7 - y * 1.3) * 0.3 + Math.cos(x * 3.3 + y * 0.4) * 0.2;
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const field = (x: number, y: number, t: number, i: number, j: number): number => {
      switch (preset) {
        case "flow": { const q = n(x * 3 + t * 0.2, y * 3 - t * 0.15); const r = n(x * 3 + q * 1.5 - mx * 2, y * 3 + q * 1.5 - my * 2 + t * 0.1); return 0.5 + 0.5 * r; }
        case "dither": { const g = (x + y) * 0.5 + 0.15 * Math.sin(t * 0.8 + x * 4) + (mx - 0.5) * 0.3; return g + (bayer[(i % 4) + (j % 4) * 4] / 16 - 0.5) * 0.35; }
        case "tunnel": { const d = Math.max(Math.abs(x - mx), Math.abs(y - my)); return 0.5 + 0.5 * Math.sin(d * 22 - t * 2.2); }
        case "lissajous": { let v = 0; for (let k = 0; k < 160; k++) { const u = k / 160 * Math.PI * 2; const px = 0.5 + 0.42 * Math.sin(3 * u + t * 0.5), py = 0.5 + 0.42 * Math.sin(4 * u); v = Math.max(v, 1 - Math.hypot(x - px, y - py) * 14); } return v; }
        case "cells": { let best = 1; for (let k = 0; k < 10; k++) { const px = 0.5 + 0.45 * Math.sin(t * 0.3 + k * 1.7), py = 0.5 + 0.45 * Math.cos(t * 0.25 + k * 2.3); best = Math.min(best, Math.hypot(x - px, y - py) * 2.2); } return 1 - best; }
      }
    };
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || now - last < 1000 / 24) return; last = now;
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = Math.floor(c.clientWidth * dpr), H = Math.floor(c.clientHeight * dpr);
      if (!W || !H) return; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      mx += (tx - mx) * 0.08; my += (ty - my) * 0.08;
      const t = reduced ? 2 : ((now - start) / 1000) * speed;
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const cs = cell * dpr, cols = Math.ceil(W / cs), rows = Math.ceil(H / cs), inner = cs * (1 - gap);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const v = field((i + 0.5) / cols, (j + 0.5) / rows, t, i, j);
        if (v < 0.3) continue;
        ctx.fillStyle = v < 0.52 ? colors[0] : v < 0.76 ? colors[1] : colors[2];
        ctx.fillRect(i * cs + (cs - inner) / 2, j * cs + (cs - inner) / 2, inner, inner);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); host.removeEventListener("pointermove", onMove); host.removeEventListener("pointerleave", onLeave); };
  }, [preset, colors, bg, cell, gap, speed]);
  return <canvas ref={ref} className={`block h-full w-full ${className}`} aria-hidden="true" />;
}
