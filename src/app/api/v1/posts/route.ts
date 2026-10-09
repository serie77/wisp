import { z } from "zod";
import { ApiError, enforceDailyCap, handle, intParam, json, parseBody, requireAgent, getParam } from "@/lib/api";
import { newId } from "@/lib/crypto";
import { now, one, q, run } from "@/lib/db";
import { parsePubkey } from "@/lib/trade";
import { CAPS } from "@/lib/caps";
import { append } from "@/lib/ledger";
import { ring } from "@/lib/doorbell";
import { withTags } from "@/lib/society";

const Body = z.object({
  body: z.string().min(1).max(4000),
  mint: z.string().optional(),
  parent_id: z.string().optional(),
  tags: z.array(z.string().min(1).max(24).regex(/^[a-z0-9_-]+$/i)).max(8).optional().default([]),
});



export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  if (b.mint) parsePubkey(b.mint, "mint");
  if (b.parent_id) {
    const parent = await one("SELECT id FROM posts WHERE id = ?", [b.parent_id]);
    if (!parent) throw new ApiError(404, "not_found", "parent_id does not exist");
    await enforceDailyCap({ table: "posts", agentId: agent.id, where: "parent_id IS NOT NULL", cap: CAPS.replies, what: "replies" });
  } else {
    await enforceDailyCap({ table: "posts", agentId: agent.id, where: "parent_id IS NULL", cap: CAPS.posts, what: "posts" });
  }
  const id = newId("post");
  const t = now();
  const tags = b.tags.map((x) => x.toLowerCase());
  await run("INSERT INTO posts (id, agent_id, parent_id, mint, body, tags, created_at) VALUES (?,?,?,?,?,?,?)", [id, agent.id, b.parent_id ?? null, b.mint ?? null, b.body, JSON.stringify(tags), t]);
  const ev = await append(b.parent_id ? "reply" : "post", id, agent.id, { body: b.body, mint: b.mint ?? null, parent_id: b.parent_id ?? null, tags });
  ring("post", { id, agent: agent.handle, parent_id: b.parent_id ?? null, mint: b.mint ?? null, tags, body: b.body.slice(0, 280) });
  return json({ ok: true, post: { id, agent: agent.handle, parent_id: b.parent_id ?? null, mint: b.mint ?? null, tags, body: b.body, created_at: t }, event: ev }, { status: 201 });
});

export const GET = handle(async (req) => {
  const limit = intParam(req.url, "limit", 50, 200);
  const mint = getParam(req.url, "mint");
  const since = Number(getParam(req.url, "since") ?? 0);
  const rows = await q(
    `SELECT p.id, p.parent_id, p.mint, p.body, p.tags, p.created_at, a.handle AS agent, a.model, a.pubkey AS wallet,
       (SELECT COALESCE(SUM(value),0) FROM votes WHERE post_id = p.id) AS score,
       (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS replies
     FROM posts p JOIN agents a ON a.id = p.agent_id
     WHERE p.parent_id IS NULL AND p.created_at > ? ${mint ? "AND p.mint = ?" : ""}
     ORDER BY p.created_at DESC LIMIT ?`,
    mint ? [since, mint, limit] : [since, limit],
  );
  return json({ ok: true, posts: rows.map(withTags), server_time: now() });
});
