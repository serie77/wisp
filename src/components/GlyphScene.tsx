"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * GlyphScene — large glyph renders of raymarched 3D sculptures.
 * Pass 1 raymarches the scene at glyph-grid resolution into a tiny data texture
 * (density, hit, tone band). Pass 2 draws one character per cell from a glyph atlas
 * built at the exact on-screen cell size, coloured by tone band. The whole canvas is
 * glyphs: the sculpture, and a faint drifting field behind it.
 */
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const SCENE_FRAG = `
precision highp float;
uniform vec2 u_grid; uniform float u_time; uniform vec2 u_mouse; uniform float u_scene;
uniform float u_contrast; uniform float u_aspect; uniform vec2 u_offset; uniform float u_invert; uniform float u_scale; uniform vec2 u_glow;

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
float sdTorus(vec3 p, vec2 t){ vec2 q=vec2(length(p.xz)-t.x,p.y); return length(q)-t.y; }
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y); }

float map(vec3 p){
  float t = u_time;
  if (u_scene < 0.5) {            // plume: a twisting flame with orbiting rings
    p.y -= sin(t*0.9)*0.04;
    vec3 w = p; w.xz *= rot(w.y*0.9 + t*0.35);
    w.x += sin(w.y*2.2 + t*0.8)*0.10*smoothstep(-0.8,1.3,w.y);
    float d = length(w-vec3(0.,-0.38,0.))-0.60;
    d = smin(d, length(w-vec3(0.05,0.18,0.))-0.44, 0.35);
    d = smin(d, length(w-vec3(-0.04,0.66,0.))-0.27, 0.30);
    d = smin(d, length(w-vec3(0.06,1.00,0.))-0.15, 0.24);
    d = smin(d, length(w-vec3(0.17,1.25,0.))-0.07, 0.18);
    float ang = atan(w.z, w.x);
    d += sin(ang*5.0 + w.y*6.0)*0.04*smoothstep(1.25,-0.8,w.y);
    vec3 r1 = p - vec3(0.,0.05,0.); r1.xy *= rot(0.5); r1.yz *= rot(1.15); r1.xz *= rot(t*0.5);
    float o = sdTorus(r1, vec2(1.18,0.035));
    vec3 r2 = p - vec3(0.,0.1,0.); r2.xy *= rot(-0.7); r2.yz *= rot(0.6); r2.xz *= rot(-t*0.35);
    o = min(o, sdTorus(r2, vec2(0.95,0.028)));
    for (int i=0;i<4;i++){ float fi=float(i); float a=t*(0.5+fi*0.13)+fi*1.7; vec3 c=vec3(cos(a)*1.45, sin(a*1.3+fi)*0.5+0.1, sin(a)*1.45); o=min(o,length(p-c)-0.07); }
    return min(d*0.7, o);
  }
  if (u_scene < 1.5) {            // knot: interlocked tori
    vec3 a=p; a.xy*=rot(t*0.4); a.yz*=rot(t*0.3); float d=sdTorus(a,vec2(0.95,0.17));
    vec3 b=p; b.yz*=rot(1.5708+t*0.25); b.xy*=rot(t*0.35); d=min(d,sdTorus(b,vec2(0.95,0.17)));
    vec3 c=p; c.xz*=rot(t*0.5); c.xy*=rot(1.5708); d=smin(d,sdTorus(c,vec2(0.55,0.13)),0.12);
    return smin(d, length(p)-0.28, 0.2);
  }
  if (u_scene < 2.5) {            // swarm: metaballs
    float d=10.;
    for (int i=0;i<10;i++){ float fi=float(i); float a=t*(0.3+fi*0.04)+fi*2.4; vec3 c=vec3(cos(a)*(0.3+0.07*fi), sin(a*1.3+fi)*0.6, sin(a*0.9+fi*1.3)*(0.3+0.07*fi)); d=smin(d,length(p-c)-(0.27+0.04*sin(fi*3.1+t)),0.5); }
    return d;
  }
  if (u_scene < 3.5) {            // gyroid: a lattice sphere
    vec3 q=p; q.xz*=rot(t*0.25); q.xy*=rot(t*0.15);
    float s=length(q)-1.1; vec3 g=q*3.4; float gy=abs(dot(sin(g+vec3(t*0.4)),cos(g.zxy)))/3.4-0.07;
    return max(s,gy)*0.75;
  }
  // terrain: a rolling field that climbs to the right
  float h = 0.42*sin(p.x*1.3+t*0.4)*cos(p.z*1.1-t*0.3) + 0.2*sin(p.x*3.1-t*0.7)*sin(p.z*2.6+t*0.5) + 0.9*smoothstep(-3.,3.,p.x);
  return (p.y + 0.9 - h)*0.45;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc / u_grid - 0.5) * 2.0; uv.x *= u_aspect; uv -= u_offset; uv /= u_scale;
  vec2 m = u_mouse - 0.5;
  vec3 ro = vec3(0., 0.25, 3.6); vec3 rd = normalize(vec3(uv*0.62, -1.));
  float yaw = m.x*1.4 + (u_scene < 0.5 ? sin(u_time*0.2)*0.35 : u_time*0.12);
  float pitch = -m.y*0.6;
  bool terrain = u_scene > 3.5;
  if (terrain) { ro = vec3(0., 1.15, 4.2); rd = normalize(vec3(uv.x*0.75, uv.y*0.75 - 0.38, -1.)); yaw = m.x*0.6; pitch = -m.y*0.15; }
  ro.yz *= rot(pitch); rd.yz *= rot(pitch); ro.xz *= rot(yaw); rd.xz *= rot(yaw);
  float dist = 0.; bool hit = false; vec3 p = ro;
  for (int i=0;i<76;i++){ p = ro + rd*dist; float d = map(p); if (d < 0.004) { hit = true; break; } dist += d; if (dist > 11.) break; }
  float md = length((fc/u_grid - u_glow) * vec2(u_aspect, 1.));
  if (!hit) {
    vec2 ac = fc * vec2(0.6, 1.0); ac = vec2(ac.x*0.866 - ac.y*0.5, ac.x*0.5 + ac.y*0.866);
    float nz = vnoise(ac*0.035 + vec2(u_time*0.03, -u_time*0.02)) + 0.5*vnoise(ac*0.08 - u_time*0.025);
    float line = 1. - smoothstep(0.0, 0.07, abs(fract(nz*5.0) - 0.5));
    gl_FragColor = vec4(line*0.26 + smoothstep(0.2, 0., md)*0.34, 0., 0., 1.);
    return;
  }
  vec2 e = vec2(0.003, 0.);
  vec3 n = normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx)));
  vec3 L = terrain ? normalize(vec3(-0.8, 0.45, 0.25)) : normalize(vec3(-0.55, 0.8, 0.6)); L.yz *= rot(pitch); L.xz *= rot(yaw);
  vec3 F = normalize(vec3(0.7, -0.2, 0.5)); F.yz *= rot(pitch); F.xz *= rot(yaw);
  float diff = max(dot(n, L), 0.); float fill = max(dot(n, F), 0.);
  float rim = pow(1. - max(dot(n, -rd), 0.), 2.5);
  float ao = terrain ? 1. : clamp(map(p + n*0.15)/0.15, 0., 1.);
  float v = (diff*0.85 + fill*0.18 + rim*0.25) * (0.55 + 0.45*ao);
  v = clamp((v - 0.5)*u_contrast + 0.5, 0., 1.);
  if (terrain) v = mix(v, u_invert > 0.5 ? 1. : 0., smoothstep(4.5, 10.5, dist));
  v = clamp(v + (hash(fc) - 0.5)*0.08, 0., 1.);
  float band = v < 0.32 ? 0. : (v < 0.72 ? 0.5 : 1.);
  float dens = u_invert > 0.5 ? mix(1.0, 0.36, v) : mix(0.36, 1.0, v);
  gl_FragColor = vec4(dens, 1., band, 1.);
}`;

const DRAW_FRAG = `
precision highp float;
uniform sampler2D u_data; uniform sampler2D u_atlas;
uniform vec2 u_cell; uniform vec2 u_grid;
uniform vec3 u_c0; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_bg; uniform vec3 u_amb;
void main(){
  vec2 id = floor(gl_FragCoord.xy / u_cell);
  vec2 inCell = fract(gl_FragCoord.xy / u_cell);
  vec4 d = texture2D(u_data, (id + 0.5) / u_grid);
  float gi = floor(clamp(d.r, 0., 0.999) * 16.);
  float a = texture2D(u_atlas, vec2((gi + inCell.x) / 16., 1.0 - inCell.y)).a;
  vec3 col = d.g > 0.5 ? (d.b < 0.25 ? u_c0 : (d.b < 0.75 ? u_c1 : u_c2)) : u_amb;
  gl_FragColor = vec4(mix(u_bg, col, a), 1.);
}`;

export const GLYPH_SET = [" ", ".", "·", ":", "-", "~", "=", "+", "*", "x", "≡", "#", "%", "&", "@", "▮"];
export type Mark = "glyph" | "block" | "dot";
export type ScenePalette = { name: string; c: [string, string, string]; bg: string; amb: string; invert: boolean; dark: boolean };
export const SCENE_PALETTES: ScenePalette[] = [
  { name: "Paper", c: ["#ff5fb4", "#a9a2ff", "#34c873"], bg: "#ffffff", amb: "#dcdaf0", invert: true, dark: false },
  { name: "Ink", c: ["#6a63e6", "#b9b3ff", "#ffffff"], bg: "#0b0b0c", amb: "#2b2b36", invert: false, dark: true },
  { name: "Sun", c: ["#0b0b0c", "#2d3dff", "#ff5fb4"], bg: "#f5f06a", amb: "#e0d94a", invert: true, dark: false },
  { name: "Mono", c: ["#0b0b0c", "#3a3a3f", "#8a8a93"], bg: "#f5f4f0", amb: "#d6d4cc", invert: true, dark: false },
];
export const SCENES = ["Plume", "Knot", "Swarm", "Gyroid", "Terrain"] as const;
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export type SceneParams = { scene: number; cell: number; contrast: number; mark: Mark; palette: number; offset?: [number, number]; scale?: number; speed?: number };

function buildAtlas(cw: number, ch: number, mark: Mark): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = cw * 16; c.height = ch;
  const x = c.getContext("2d")!; x.clearRect(0, 0, c.width, c.height); x.fillStyle = "#fff";
  if (mark === "glyph") {
    x.font = `700 ${Math.round(ch * 0.88)}px Menlo, ui-monospace, "SF Mono", Consolas, monospace`; x.textAlign = "center"; x.textBaseline = "middle";
    GLYPH_SET.forEach((g, i) => x.fillText(g, i * cw + cw / 2, ch / 2 + ch * 0.04));
  } else {
    for (let i = 1; i < 16; i++) {
      const k = i / 15, m = Math.min(cw, ch);
      if (mark === "block") { const s = Math.max(1, Math.round(m * (0.22 + 0.7 * k))); x.fillRect(Math.round(i * cw + (cw - s) / 2), Math.round((ch - s) / 2), s, s); }
      else { x.beginPath(); x.arc(i * cw + cw / 2, ch / 2, m * 0.5 * (0.18 + 0.78 * k), 0, Math.PI * 2); x.fill(); }
    }
  }
  return c;
}

export function GlyphScene({ params, className = "" }: { params: SceneParams; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const p = useRef(params);
  useEffect(() => { p.current = params; }, [params]);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) return;
    const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const program = (frag: string) => { const pr = gl.createProgram()!; gl.attachShader(pr, compile(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, frag)); gl.bindAttribLocation(pr, 0, "a"); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) ?? "link"); return pr; };
    let sceneProg: WebGLProgram, drawProg: WebGLProgram;
    try { sceneProg = program(SCENE_FRAG); drawProg = program(DRAW_FRAG); } catch (e) { console.error("[GlyphScene]", e); return; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const us = (pr: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(pr, n)])) as Record<string, WebGLUniformLocation | null>;
    const su = us(sceneProg, ["u_grid", "u_time", "u_mouse", "u_scene", "u_contrast", "u_aspect", "u_offset", "u_invert", "u_scale", "u_glow"]);
    const du = us(drawProg, ["u_data", "u_atlas", "u_cell", "u_grid", "u_c0", "u_c1", "u_c2", "u_bg", "u_amb"]);

    const dataTex = gl.createTexture(), atlasTex = gl.createTexture(), fbo = gl.createFramebuffer();
    const texParams = (filter: number) => { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
    let cols = 1, rows = 1, cw = 8, ch = 13, key = "";
    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(2, Math.floor(canvas.clientWidth * dpr)), H = Math.max(2, Math.floor(canvas.clientHeight * dpr));
      const q = p.current; const k = `${W}x${H}:${q.cell}:${q.mark}`;
      if (k === key) return; key = k;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      ch = Math.max(5, Math.round(q.cell * dpr)); cw = q.mark === "glyph" ? Math.max(3, Math.round(ch * 0.6)) : ch;
      cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
      gl.bindTexture(gl.TEXTURE_2D, dataTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); texParams(gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dataTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas(cw, ch, q.mark)); texParams(gl.LINEAR);
    };
    let mouse = [0.5, 0.5], target = [0.5, 0.5], glow = [-9, -9];
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = 1 - (e.clientY - r.top) / r.height;
      const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      target = inside ? [x, y] : [0.5, 0.5];
      glow = inside ? [x, y] : [-9, -9]; // no cursor over the canvas → no glow
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    let raf = 0, visible = true; const io = new IntersectionObserver((es) => (visible = es[0]?.isIntersecting ?? true)); io.observe(canvas);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now(); let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || now - last < 1000 / 30) return; last = now;
      layout();
      const q = p.current, pal = SCENE_PALETTES[q.palette] ?? SCENE_PALETTES[0];
      mouse = [mouse[0] + (target[0] - mouse[0]) * 0.07, mouse[1] + (target[1] - mouse[1]) * 0.07];
      // pass 1 — scene → data texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, cols, rows); gl.useProgram(sceneProg);
      gl.uniform2f(su.u_grid, cols, rows); gl.uniform1f(su.u_time, reduced ? 6 : ((now - start) / 1000) * (q.speed ?? 1));
      gl.uniform2f(su.u_mouse, mouse[0], mouse[1]); gl.uniform1f(su.u_scene, q.scene); gl.uniform1f(su.u_contrast, q.contrast);
      gl.uniform1f(su.u_aspect, (cols * cw) / (rows * ch)); gl.uniform2f(su.u_offset, q.offset?.[0] ?? 0, q.offset?.[1] ?? 0);
      gl.uniform1f(su.u_invert, pal.invert ? 1 : 0); gl.uniform1f(su.u_scale, q.scale ?? 1); gl.uniform2f(su.u_glow, glow[0], glow[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // pass 2 — glyphs
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(drawProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dataTex); gl.uniform1i(du.u_data, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(du.u_atlas, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(du.u_cell, cw, ch); gl.uniform2f(du.u_grid, cols, rows);
      gl.uniform3f(du.u_c0, ...hex(pal.c[0])); gl.uniform3f(du.u_c1, ...hex(pal.c[1])); gl.uniform3f(du.u_c2, ...hex(pal.c[2])); gl.uniform3f(du.u_bg, ...hex(pal.bg)); gl.uniform3f(du.u_amb, ...hex(pal.amb));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("pointermove", onMove); };
  }, []);
  return <canvas ref={ref} className={`block h-full w-full ${className}`} aria-hidden="true" />;
}

function Slider({ label, value, min, max, step, onChange, fmt = (v: number) => String(v) }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="ctl"><span>{label}</span><input type="range" className="slider" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><output>{fmt(value)}</output></label>
  );
}

/**
 * Full-bleed hero: the scene fills the section, children (headline, buttons) sit on top,
 * and a small tool panel exposes the render parameters.
 */
const NARROW = "(max-width: 900px)";
const subscribeNarrow = (cb: () => void) => { const mq = window.matchMedia(NARROW); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); };

export function GlyphHero({ children, initial, mobile, controls = true, className = "", scrim = "left" }: { children?: ReactNode; initial: SceneParams; mobile?: Partial<SceneParams>; controls?: boolean; className?: string; scrim?: "left" | "bottom" | "none" }) {
  const [base, setQ] = useState<SceneParams>(initial);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const q: SceneParams = narrow && mobile ? { ...base, ...mobile } : base;
  if (narrow && scrim === "left") scrim = "bottom";
  const pal = SCENE_PALETTES[q.palette] ?? SCENE_PALETTES[0];
  const set = <K extends keyof SceneParams>(k: K) => (v: SceneParams[K]) => setQ((s) => ({ ...s, [k]: v }));
  const scrimBg = scrim === "none" ? undefined : scrim === "left"
    ? `linear-gradient(90deg, ${pal.bg} 0%, ${pal.bg}e6 22%, ${pal.bg}00 58%)`
    : `linear-gradient(0deg, ${pal.bg} 0%, ${pal.bg}e6 38%, ${pal.bg}00 78%)`;
  return (
    <section className={`glyph-hero relative overflow-hidden ${className}`} data-dark={pal.dark} style={{ background: pal.bg, color: pal.dark ? "#ffffff" : "#0b0b0c" }}>
      <div className="absolute inset-0"><GlyphScene params={q} /></div>
      {scrimBg && <div className="pointer-events-none absolute inset-0" style={{ background: scrimBg }} />}
      <div className="relative">{children}</div>
      {controls && (
        <div className="tool absolute bottom-5 right-5 z-10 hidden w-[340px] text-ink shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)] md:block">
          <Slider label="Glyph size" value={q.cell} min={7} max={28} step={1} onChange={set("cell")} />
          <Slider label="Contrast" value={q.contrast} min={0.6} max={2.2} step={0.05} onChange={set("contrast")} fmt={(v) => v.toFixed(2)} />
          <div className="ctl !grid-cols-1 !gap-2"><span>Scene</span><div className="seg flex w-full">{SCENES.map((s, i) => <button key={s} className="flex-1 !px-1" aria-pressed={q.scene === i} onClick={() => set("scene")(i)}>{s}</button>)}</div></div>
          <div className="ctl !grid-cols-[1fr_auto]"><span>Mark</span><div className="seg">{(["glyph", "block", "dot"] as Mark[]).map((m) => <button key={m} aria-pressed={q.mark === m} onClick={() => set("mark")(m)}>{m}</button>)}</div></div>
          <div className="ctl !grid-cols-[1fr_auto]"><span>Palette</span><div className="flex gap-2">{SCENE_PALETTES.map((pp, i) => (
            <button key={pp.name} title={pp.name} aria-pressed={q.palette === i} onClick={() => set("palette")(i)} className={`flex rounded-full border p-0.5 ${q.palette === i ? "border-ink" : "border-line"}`} style={{ background: pp.bg }}>
              {pp.c.map((c) => <span key={c} className="swatch -ml-1 first:ml-0" style={{ background: c }} />)}
            </button>
          ))}</div></div>
        </div>
      )}
    </section>
  );
}
