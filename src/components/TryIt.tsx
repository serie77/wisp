"use client";
import { useState } from "react";
import { highlight } from "./CodeBlock";

type Field = { key: string; label: string; placeholder?: string };
type Demo = { id: string; label: string; method: "GET"; path: (v: Record<string, string>) => string; fields: Field[] };

const DEMOS: Demo[] = [
  { id: "pulse", label: "Pulse", method: "GET", path: () => "/api/v1/pulse", fields: [] },
  { id: "token", label: "Token intel", method: "GET", path: (v) => `/api/v1/tokens/${encodeURIComponent(v.mint)}`, fields: [{ key: "mint", label: "mint" }] },
  { id: "quote", label: "Quote", method: "GET", path: (v) => `/api/v1/quote?mint=${encodeURIComponent(v.mint)}&side=${v.side || "buy"}&amount=${encodeURIComponent(v.amount || "0.1")}`, fields: [{ key: "mint", label: "mint" }, { key: "amount", label: "amount (SOL)" }] },
  { id: "front", label: "Front page", method: "GET", path: () => "/api/v1/front?limit=5", fields: [] },
  { id: "search", label: "Search", method: "GET", path: (v) => `/api/v1/search?q=${encodeURIComponent(v.q || "wisp")}`, fields: [{ key: "q", label: "q" }] },
  { id: "attest", label: "Attest", method: "GET", path: () => "/api/v1/attest", fields: [] },
];

export function TryIt({ site, defaultMint }: { site: string; defaultMint: string }) {
  const [active, setActive] = useState(DEMOS[0]);
  const [values, setValues] = useState<Record<string, string>>({ mint: defaultMint, amount: "0.1", q: "wisp", side: "buy" });
  const [out, setOut] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const path = active.path(values);
  const curl = `curl -s ${site}${path}`;

  const run = async () => {
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(path, { headers: { accept: "application/json" } });
      const text = await res.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      const lines = body.split("\n");
      setOut({ status: res.status, ms: Math.round(performance.now() - t0), body: lines.length > 80 ? lines.slice(0, 80).join("\n") + `\n… ${lines.length - 80} more lines` : body });
    } catch (e) {
      setOut({ status: 0, ms: Math.round(performance.now() - t0), body: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="tool">
        <div className="tool-head"><span>Endpoint</span><span className="mono text-[0.65rem] text-muted">public · no key</span></div>
        <div className="flex flex-wrap gap-2 p-3">
          {DEMOS.map((d) => <button key={d.id} onClick={() => { setActive(d); setOut(null); }} aria-pressed={active.id === d.id} className={`rounded-full border px-3 py-1.5 text-sm transition ${active.id === d.id ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}>{d.label}</button>)}
        </div>
        {active.fields.map((f) => (
          <label key={f.key} className="ctl !grid-cols-[88px_1fr]">
            <span className="mono text-[0.72rem]">{f.label}</span>
            <input value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="mono w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-ink" />
          </label>
        ))}
        <div className="p-3"><button onClick={run} disabled={busy} className="btn btn-ink w-full justify-center disabled:opacity-60">{busy ? "Running…" : `Run ${active.method}`}</button></div>
      </div>
      <div className="min-w-0">
        <pre className="code scrollbar-thin !rounded-b-none"><code dangerouslySetInnerHTML={{ __html: highlight(curl) }} /></pre>
        <div className="term-bar !rounded-none border-t border-white/10"><span>response</span><span className="ml-auto normal-case tracking-normal">{out ? `${out.status} · ${out.ms} ms` : "—"}</span></div>
        <pre className="code scrollbar-thin max-h-[420px] min-h-[160px] !rounded-t-none overflow-auto"><code dangerouslySetInnerHTML={{ __html: out ? highlight(out.body) : '<span class="c"># press Run</span>' }} /></pre>
      </div>
    </div>
  );
}
