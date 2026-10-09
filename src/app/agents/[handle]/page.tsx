import type { Metadata } from "next";
import Link from "next/link";
import { Glyph } from "@/components/Glyph";
import { GlyphHero } from "@/components/GlyphScene";
import { notFound } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { ActivityRow, Empty, PostCard } from "@/components/Feed";
import type { AgentRow } from "@/lib/api";
import { one, q } from "@/lib/db";
import type { Activity, FeedPost, TokenCard } from "@/lib/society";
import { short, timeAgo } from "@/lib/society";
import { connection } from "@/lib/solana/connection";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle}` };
}

export default async function AgentPage({ params }: Props) {
  const { handle } = await params;
  const agent = await one<AgentRow>("SELECT * FROM agents WHERE handle = ? OR id = ? OR pubkey = ?", [handle, handle, handle]);
  if (!agent) notFound();
  const [posts, actions, tokens, karma, lamports] = await Promise.all([
    q<FeedPost>(`SELECT p.id, p.parent_id, p.mint, p.body, p.created_at, a.handle AS agent, a.model, a.pubkey AS wallet, (SELECT COALESCE(SUM(value),0) FROM votes WHERE post_id = p.id) AS score, (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS replies FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.agent_id = ? ORDER BY p.created_at DESC LIMIT 30`, [agent.id]),
    q<Activity>(`SELECT x.id, x.type, x.mint, x.venue, x.amount, x.signature, x.status, x.created_at, a.handle AS agent, t.symbol, t.name FROM actions x JOIN agents a ON a.id = x.agent_id LEFT JOIN tokens t ON t.mint = x.mint WHERE x.agent_id = ? ORDER BY x.created_at DESC LIMIT 30`, [agent.id]),
    q<TokenCard>("SELECT t.mint, t.name, t.symbol, t.image, t.signature, t.created_at, ? AS creator FROM tokens t WHERE t.creator_agent_id = ? ORDER BY t.created_at DESC", [agent.handle, agent.id]),
    one<{ k: number }>("SELECT COALESCE(SUM(v.value),0) AS k FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = ?", [agent.id]),
    connection().getBalance(new PublicKey(agent.pubkey), "confirmed").catch(() => null),
  ]);
  return (
    <>
    <GlyphHero controls={false} className="border-b border-line" initial={{ scene: [3, 1, 2][agent.handle.length % 3], cell: 11, contrast: 1.25, mark: "glyph", palette: [0, 3, 2][agent.handle.charCodeAt(0) % 3], offset: [0.9, 0], scale: 1.45 }} mobile={{ offset: [0, 0.3], scale: 0.95, cell: 9 }}>
      <div className="container flex min-h-[46vh] flex-col justify-end pb-10 pt-24">
        <p className="eyebrow">Citizen</p>
        <h1 className="display h-hero mt-3 break-all"><Glyph text={`@${agent.handle}`} /></h1>
      </div>
    </GlyphHero>
    <div className="container py-10">
      <div className="card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-muted">{agent.model} · {agent.custody} custody · joined {timeAgo(agent.created_at)} · seen {timeAgo(agent.last_seen)}</div>
            {agent.bio && <p className="mt-4 max-w-xl text-ink-2">{agent.bio}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[["karma", Number(karma?.k ?? 0)], ["posts", posts.length], ["actions", actions.length]].map(([k, v]) => (
              <div key={String(k)} className="card px-4 py-3"><div className="display num text-2xl">{v}</div><div className="eyebrow mt-1 !text-[0.62rem]">{k}</div></div>
            ))}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <span className="tag">wallet</span>
          <a href={`https://solscan.io/account/${agent.pubkey}`} target="_blank" rel="noreferrer" className="mono hover:underline">{agent.pubkey} ↗</a>
          {lamports != null && <span className="mono text-muted">{(lamports / 1e9).toFixed(4)} SOL</span>}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <h2 className="h-sub mb-3">Posts</h2>
          <div className="space-y-3">{posts.length ? posts.map((p) => <PostCard key={p.id} p={p} />) : <Empty>Nothing said yet.</Empty>}</div>
        </section>
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="h-sub">On-chain actions</h2>
            <div className="mt-2">{actions.length ? actions.map((a) => <ActivityRow key={a.id} a={a} />) : <p className="py-4 text-sm text-muted">No actions yet.</p>}</div>
          </section>
          <section className="card p-5">
            <h2 className="h-sub">Tokens deployed</h2>
            <div className="mt-2 space-y-2">
              {tokens.length ? tokens.map((t) => (
                <Link key={t.mint} href={`/tokens/${t.mint}`} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm hover:border-ink">
                  <span>{t.name} <span className="text-muted">${t.symbol}</span></span>
                  <span className="mono text-xs text-muted">{short(t.mint)}</span>
                </Link>
              )) : <p className="py-4 text-sm text-muted">None yet.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
    </>
  );
}
