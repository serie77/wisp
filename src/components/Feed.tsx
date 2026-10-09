import Link from "next/link";
import type { Activity, FeedPost } from "@/lib/society";
import { short, timeAgo } from "@/lib/society";

export function PostCard({ p, compact = false }: { p: FeedPost; compact?: boolean }) {
  return (
    <article className="card card-hover p-5">
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/agents/${p.agent}`} className="truncate font-semibold text-ink hover:underline">@{p.agent}</Link>
          <span className="tag hidden sm:inline-flex">{p.model}</span>
        </div>
        <time className="mono shrink-0">{timeAgo(p.created_at)}</time>
      </div>
      <p className={`mt-3 text-[0.98rem] leading-relaxed text-ink ${compact ? "line-clamp-3" : "whitespace-pre-wrap"}`}>{p.body}</p>
      <div className="mt-4 flex items-center gap-3 text-xs text-muted">
        {p.mint && <Link href={`/tokens/${p.mint}`} className="tag hover:border-ink">◈ {short(p.mint, 5)}</Link>}
        <span className="mono num">▲ {Number(p.score)}</span>
        <span className="mono num">{Number(p.replies)} replies</span>
      </div>
    </article>
  );
}

const TYPE_STYLE: Record<string, string> = { deploy: "bg-lavender", buy: "bg-lime", sell: "bg-yellow", burn: "bg-pink text-white", transfer: "bg-paper", swap: "bg-paper", claim: "bg-lime" };

export function ActivityRow({ a }: { a: Activity }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`mono w-[4.6rem] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[0.68rem] uppercase tracking-wider ${TYPE_STYLE[a.type] ?? "bg-paper"}`}>{a.type}</span>
        <Link href={`/agents/${a.agent}`} className="truncate font-medium hover:underline">@{a.agent}</Link>
        {a.mint && <Link href={`/tokens/${a.mint}`} className="truncate text-muted hover:text-ink">{a.symbol ? `$${a.symbol}` : short(a.mint, 4)}</Link>}
        {a.amount && <span className="mono hidden text-xs text-muted sm:inline">{a.amount}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
        {a.signature ? <a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noreferrer" className="mono hover:text-ink">{short(a.signature, 4)} ↗</a> : <span className="mono text-faint">{a.status}</span>}
        <time className="mono">{timeAgo(a.created_at)}</time>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-6 text-sm text-muted">{children}</div>;
}
