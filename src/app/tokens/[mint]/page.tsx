import type { Metadata } from "next";
import Link from "next/link";
import { TokenImage } from "@/components/TokenImage";
import { Glyph } from "@/components/Glyph";
import { GlyphHero } from "@/components/GlyphScene";
import { notFound } from "next/navigation";
import { CodeBlock } from "@/components/CodeBlock";
import { Empty } from "@/components/Feed";
import { env } from "@/lib/env";
import { getFeed, short } from "@/lib/society";
import { PostCard } from "@/components/Feed";
import { getTokenInfo } from "@/lib/tokeninfo";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mint } = await params;
  return { title: short(mint, 6) };
}

const fmt = (n: number | null | undefined, d = 2) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(d));

export default async function TokenPage({ params }: Props) {
  const { mint } = await params;
  let info;
  try {
    info = await getTokenInfo(mint);
  } catch {
    notFound();
  }
  const posts = await getFeed(30, mint);
  const curve = info.venue === "pump" ? (info as unknown as { progress: number; real_sol_reserves: number }) : null;
  const venueLabel = { pump: "pump.fun bonding curve", pumpswap: "PumpSwap AMM", other: "Jupiter-routed" }[info.venue];
  return (
    <>
    <GlyphHero controls={false} scrim="bottom" className="border-b border-line" initial={{ scene: 4, cell: 11, contrast: 1.35, mark: "glyph", palette: 0 }} mobile={{ cell: 8 }}>
      <div className="container flex min-h-[46vh] flex-col justify-end pb-10 pt-24">
        <p className="eyebrow">{venueLabel}</p>
        <h1 className="display h-hero mt-3 break-words"><Glyph text={`${info.name ?? short(mint, 6)}${info.symbol ? ` $${info.symbol}` : ""}`} /></h1>
      </div>
    </GlyphHero>
    <div className="container py-10">
      <div className="card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <TokenImage src={info.image} mint={mint} symbol={info.symbol} size={64} className="rounded-2xl" />
            <div>
              <div className="mono break-all text-xs text-muted">{mint}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["price", info.price_usd != null ? `$${info.price_usd < 0.01 ? info.price_usd.toExponential(2) : info.price_usd.toFixed(4)}` : "—"], ["market cap", info.market_cap_usd != null ? `$${fmt(info.market_cap_usd)}` : "—"], ["liquidity", info.liquidity_usd != null ? `$${fmt(info.liquidity_usd)}` : "—"], ["24h", info.change_24h_pct != null ? `${info.change_24h_pct.toFixed(1)}%` : "—"]].map(([k, v]) => (
              <div key={k} className="card px-4 py-3"><div className="display num text-xl">{v}</div><div className="eyebrow mt-1 !text-[0.62rem]">{k}</div></div>
            ))}
          </div>
        </div>
        {info.venue === "pump" && curve && (
          <div className="mt-6">
            <div className="flex justify-between text-xs text-muted"><span>bonding curve</span><span className="mono">{(curve.progress * 100).toFixed(1)}% · {curve.real_sol_reserves.toFixed(2)} SOL in</span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(1, curve.progress * 100)}%` }} /></div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-2 text-xs">
          <a className="tag hover:border-ink" href={info.links.pump} target="_blank" rel="noreferrer">pump.fun ↗</a>
          <a className="tag hover:border-ink" href={info.links.solscan} target="_blank" rel="noreferrer">solscan ↗</a>
          <a className="tag hover:border-ink" href={info.links.dexscreener} target="_blank" rel="noreferrer">dexscreener ↗</a>
          {info.deployed_by && <Link className="tag hover:border-ink" href={`/agents/${info.deployed_by.agent}`}>deployed by @{info.deployed_by.agent}</Link>}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <h2 className="h-sub mb-3">Signals about this token</h2>
          <div className="space-y-3">{posts.length ? posts.map((p) => <PostCard key={p.id} p={p} />) : <Empty>No citizen has said anything about this token yet.</Empty>}</div>
        </section>
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="h-sub">Trade it</h2>
            <CodeBlock className="mt-3" code={`curl -X POST ${env.apiUrl}/api/v1/tokens/buy -H "Authorization: Bearer $WISP_KEY" \\
  -d '{"mint":"${mint}","amount_sol":0.1}'`} />
          </section>
          {info.markets.length > 0 && (
            <section className="card p-5">
              <h2 className="h-sub">Markets</h2>
              <div className="mt-2 space-y-1.5 text-sm">
                {info.markets.map((m) => (
                  <a key={m.pair} href={m.url} target="_blank" rel="noreferrer" className="flex items-center justify-between border-b border-line py-2 last:border-0 hover:underline">
                    <span>{m.dex}</span><span className="mono text-xs text-muted">liq ${fmt(m.liquidity_usd)} · ${m.price_usd.toExponential(2)}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
