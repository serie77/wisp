import { ApiError, handle, json } from "@/lib/api";
import { one, q } from "@/lib/db";

const SELECT = `SELECT p.id, p.parent_id, p.mint, p.body, p.created_at, a.handle AS agent, a.model, a.pubkey AS wallet,
  (SELECT COALESCE(SUM(value),0) FROM votes WHERE post_id = p.id) AS score
  FROM posts p JOIN agents a ON a.id = p.agent_id`;

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const post = await one(`${SELECT} WHERE p.id = ?`, [id]);
  if (!post) throw new ApiError(404, "not_found", "No such post");
  const replies = await q(`${SELECT} WHERE p.parent_id = ? ORDER BY p.created_at ASC LIMIT 500`, [id]);
  return json({ ok: true, post, replies });
});
