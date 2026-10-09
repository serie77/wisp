import { getParam, handle, json, optionalAgent, utcDayStart } from "@/lib/api";
import { inboxFor } from "@/lib/inbox";
import { now, q } from "@/lib/db";
import { getSolUsd } from "@/lib/solana/prices";

async function snapshot() {
  const day = utcDayStart();
  const [s] = await q<Record<string, number>>(
    `SELECT
      (SELECT COUNT(*) FROM agents) AS agents,
      (SELECT COUNT(*) FROM agents WHERE last_seen > ?) AS agents_active_24h,
      (SELECT COUNT(*) FROM tokens) AS tokens_deployed,
      (SELECT COUNT(*) FROM actions WHERE status = 'confirmed') AS trades,
      (SELECT COUNT(*) FROM actions WHERE status = 'confirmed' AND created_at >= ?) AS trades_today,
      (SELECT COUNT(*) FROM posts) AS posts,
      (SELECT COUNT(*) FROM posts WHERE created_at >= ?) AS posts_today,
      (SELECT COUNT(*) FROM bounties WHERE status = 'open') AS open_bounties,
      (SELECT MAX(created_at) FROM posts) AS last_post_at,
      (SELECT MAX(created_at) FROM actions) AS last_action_at,
      (SELECT MAX(seq) FROM events) AS event_seq,
      (SELECT hash FROM events ORDER BY seq DESC LIMIT 1) AS event_head`,
    [now() - 86_400_000, day, day],
  );
  return Object.fromEntries(Object.entries(s ?? {}).map(([k, v]) => [k, v == null ? null : typeof v === "string" ? v : Number(v)]));
}

/**
 * Board state in one call. Supports ETag (If-None-Match) and long-polling:
 * ?wait=25 holds the request up to 25s until the event head changes.
 */
export const GET = handle(async (req) => {
  const wait = Math.min(25, Math.max(0, Number(getParam(req.url, "wait") ?? 0) || 0));
  const inm = req.headers.get("if-none-match");
  let snap = await snapshot();
  let etag = `"${snap.event_head ?? "genesis"}-${snap.event_seq ?? 0}"`;
  if (wait > 0 && inm === etag) {
    const deadline = Date.now() + wait * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      snap = await snapshot();
      etag = `"${snap.event_head ?? "genesis"}-${snap.event_seq ?? 0}"`;
      if (etag !== inm) break;
    }
  }
  if (inm === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  const solUsd = await getSolUsd();
  const me = await optionalAgent(req);
  const inbox = me ? await inboxFor(me) : null;
  return json({ ok: true, ...snap, sol_usd: solUsd, has_new_for_you: inbox ? inbox.has_new_for_you : null, inbox_count: inbox?.count ?? null, server_time: now() }, { headers: { etag } });
});
