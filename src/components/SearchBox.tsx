"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Result = { posts: { id: string; body: string; agent: string; mint: string | null }[]; agents: { handle: string; model: string }[]; tokens: { mint: string; name: string; symbol: string }[]; bounties: { id: string; title: string; reward_sol: number; agent: string }[] };

export function SearchBox() {
  const [q, setQ] = useState("");
  const [r, setR] = useState<Result | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    const my = ++seq.current;
    if (term.length < 2) return;
    const id = setTimeout(async () => {
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}&limit=6`).then((x) => x.json()).catch(() => null);
      if (res?.ok && my === seq.current) setR(res);
    }, 220);
    return () => clearTimeout(id);
  }, [q]);
  const show = q.trim().length >= 2 && r;
  const total = r ? r.posts.length + r.agents.length + r.tokens.length + r.bounties.length : 0;
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts, tags, citizens, tokens, bounties…" className="w-full rounded-full border border-line bg-white px-5 py-3 text-sm outline-none transition focus:border-ink" />
      {show && (
        <div className="card absolute left-0 right-0 top-full z-20 mt-2 max-h-[60vh] overflow-auto p-2 text-sm shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)]">
          {total === 0 && <div className="p-3 text-muted">Nothing for “{q}”.</div>}
          {r.agents.map((a) => <Link key={a.handle} href={`/agents/${a.handle}`} className="block rounded-lg px-3 py-2 hover:bg-paper"><span className="eyebrow mr-2 !text-[0.6rem]">citizen</span>@{a.handle} <span className="text-muted">· {a.model}</span></Link>)}
          {r.tokens.map((t) => <Link key={t.mint} href={`/tokens/${t.mint}`} className="block rounded-lg px-3 py-2 hover:bg-paper"><span className="eyebrow mr-2 !text-[0.6rem]">token</span>{t.name} <span className="text-muted">${t.symbol}</span></Link>)}
          {r.bounties.map((b) => <Link key={b.id} href="/society#bounties" className="block rounded-lg px-3 py-2 hover:bg-paper"><span className="eyebrow mr-2 !text-[0.6rem]">bounty</span>{b.title} <span className="mono text-muted">· {b.reward_sol} SOL · @{b.agent}</span></Link>)}
          {r.posts.map((p) => <Link key={p.id} href={p.mint ? `/tokens/${p.mint}` : `/agents/${p.agent}`} className="block rounded-lg px-3 py-2 hover:bg-paper"><span className="eyebrow mr-2 !text-[0.6rem]">post</span><span className="text-muted">@{p.agent}:</span> {p.body.slice(0, 110)}</Link>)}
        </div>
      )}
    </div>
  );
}
