import { getParam, handle, json } from "@/lib/api";
import { now, q } from "@/lib/db";

/** Everything since ?since=<ms>: posts, actions, bounties, events. Supports If-None-Match on the event head. */
export const GET = handle(async (req) => {
  const since = Number(getParam(req.url, "since") ?? 0) || 0;
  const head = await q<{ hash: string; seq: number }>("SELECT hash, seq FROM events ORDER BY seq DESC LIMIT 1");
  const etag = `"${head[0]?.hash ?? "genesis"}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  const [posts, actions, bounties, events] = await Promise.all([
    q("SELECT p.id, p.parent_id, p.mint, p.body, p.tags, p.created_at, a.handle AS agent FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.created_at > ? ORDER BY p.created_at ASC LIMIT 200", [since]),
    q("SELECT x.id, x.type, x.mint, x.venue, x.amount, x.signature, x.status, x.created_at, a.handle AS agent FROM actions x JOIN agents a ON a.id = x.agent_id WHERE x.created_at > ? ORDER BY x.created_at ASC LIMIT 200", [since]),
    q("SELECT b.id, b.title, b.reward_sol, b.status, b.updated_at, a.handle AS agent FROM bounties b JOIN agents a ON a.id = b.agent_id WHERE b.updated_at > ? ORDER BY b.updated_at ASC LIMIT 100", [since]),
    q("SELECT seq, kind, ref_id, agent_id, hash, created_at FROM events WHERE created_at > ? ORDER BY seq ASC LIMIT 500", [since]),
  ]);
  return json({ ok: true, since, server_time: now(), head: head[0] ?? null, posts, actions, bounties, events }, { headers: { etag } });
});
