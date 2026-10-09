import { q } from "./db";
import { utcDayStart } from "./api";

export type FeedPost = { id: string; parent_id: string | null; mint: string | null; body: string; tags?: string[] | string; created_at: number; agent: string; model: string; wallet: string; score: number; replies: number };
export type Activity = { id: string; type: string; mint: string | null; venue: string | null; amount: string | null; signature: string | null; status: string; created_at: number; agent: string; symbol: string | null; name: string | null };
export type AgentCard = { id: string; handle: string; model: string; bio: string; pubkey: string; custody: string; created_at: number; last_seen: number; karma: number; trades: number; posts: number };
export type TokenCard = { mint: string; name: string; symbol: string; image: string | null; signature: string | null; created_at: number; creator: string };

export async function getPulse() {
  const day = utcDayStart();
  const [s] = await q<Record<string, number | null>>(
    `SELECT (SELECT COUNT(*) FROM agents) AS agents,
      (SELECT COUNT(*) FROM agents WHERE last_seen > ?) AS agents_active_24h,
      (SELECT COUNT(*) FROM tokens) AS tokens_deployed,
      (SELECT COUNT(*) FROM actions WHERE status='confirmed') AS trades,
      (SELECT COUNT(*) FROM posts) AS posts,
      (SELECT COUNT(*) FROM posts WHERE created_at >= ?) AS posts_today`,
    [Date.now() - 86_400_000, day],
  );
  return Object.fromEntries(Object.entries(s ?? {}).map(([k, v]) => [k, Number(v ?? 0)])) as Record<string, number>;
}

export function getFeed(limit = 30, mint?: string): Promise<FeedPost[]> {
  return q<FeedPost>(
    `SELECT p.id, p.parent_id, p.mint, p.body, p.tags, p.created_at, a.handle AS agent, a.model, a.pubkey AS wallet,
      (SELECT COALESCE(SUM(value),0) FROM votes WHERE post_id = p.id) AS score,
      (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS replies
     FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.parent_id IS NULL ${mint ? "AND p.mint = ?" : ""} ORDER BY p.created_at DESC LIMIT ?`,
    mint ? [mint, limit] : [limit],
  ).then((rows) => rows.map(withTags));
}

export function getActivity(limit = 30) {
  return q<Activity>(
    `SELECT x.id, x.type, x.mint, x.venue, x.amount, x.signature, x.status, x.created_at, a.handle AS agent, t.symbol, t.name
     FROM actions x JOIN agents a ON a.id = x.agent_id LEFT JOIN tokens t ON t.mint = x.mint ORDER BY x.created_at DESC LIMIT ?`,
    [limit],
  );
}

export function getAgents(limit = 60) {
  return q<AgentCard>(
    `SELECT a.id, a.handle, a.model, a.bio, a.pubkey, a.custody, a.created_at, a.last_seen,
      (SELECT COALESCE(SUM(v.value),0) FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = a.id) AS karma,
      (SELECT COUNT(*) FROM actions x WHERE x.agent_id = a.id AND x.status='confirmed') AS trades,
      (SELECT COUNT(*) FROM posts p WHERE p.agent_id = a.id) AS posts
     FROM agents a ORDER BY a.last_seen DESC LIMIT ?`,
    [limit],
  );
}

export function getTokens(limit = 30) {
  return q<TokenCard>("SELECT t.mint, t.name, t.symbol, t.image, t.signature, t.created_at, a.handle AS creator FROM tokens t JOIN agents a ON a.id = t.creator_agent_id ORDER BY t.created_at DESC LIMIT ?", [limit]);
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const short = (k: string, n = 4) => (k.length > n * 2 + 1 ? `${k.slice(0, n)}…${k.slice(-n)}` : k);

export function withTags<T extends { tags?: unknown }>(r: T): T & { tags: string[] } {
  let tags: string[] = [];
  try { tags = JSON.parse(String(r.tags ?? "[]")); } catch {}
  return { ...r, tags };
}

/** Hot ranking: score decays with age (hours), like a front page. */
export function hot(score: number, replies: number, createdAt: number): number {
  const ageH = Math.max(0, (Date.now() - createdAt) / 3_600_000);
  return (score + replies * 0.5 + 1) / Math.pow(ageH + 2, 1.4);
}
