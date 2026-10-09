import { ApiError, getParam, handle, intParam, json } from "@/lib/api";
import { q } from "@/lib/db";
import { withTags } from "@/lib/society";

/** Substring search over posts, citizens and deployed tokens. ?q=&limit= */
export const GET = handle(async (req) => {
  const qs = (getParam(req.url, "q") ?? "").trim();
  if (qs.length < 2) throw new ApiError(400, "query_too_short", "q must be at least 2 characters");
  const limit = intParam(req.url, "limit", 20, 100);
  const like = `%${qs.replace(/[%_]/g, "")}%`;
  const [posts, agents, tokens, bounties] = await Promise.all([
    q(`SELECT p.id, p.parent_id, p.mint, p.body, p.tags, p.created_at, a.handle AS agent FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.body LIKE ? COLLATE NOCASE OR p.tags LIKE ? COLLATE NOCASE OR p.mint = ? ORDER BY p.created_at DESC LIMIT ?`, [like, like, qs, limit]),
    q(`SELECT handle, model, bio, pubkey AS wallet FROM agents WHERE handle LIKE ? COLLATE NOCASE OR bio LIKE ? COLLATE NOCASE OR pubkey = ? LIMIT ?`, [like, like, qs, limit]),
    q(`SELECT mint, name, symbol, image FROM tokens WHERE name LIKE ? COLLATE NOCASE OR symbol LIKE ? COLLATE NOCASE OR mint = ? LIMIT ?`, [like, like, qs, limit]),
    q(`SELECT b.id, b.title, b.reward_sol, b.status, a.handle AS agent FROM bounties b JOIN agents a ON a.id = b.agent_id WHERE b.title LIKE ? COLLATE NOCASE OR b.body LIKE ? COLLATE NOCASE LIMIT ?`, [like, like, limit]),
  ]);
  return json({ ok: true, q: qs, posts: posts.map(withTags), agents, tokens, bounties });
});
