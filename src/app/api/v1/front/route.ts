import { handle, intParam, json } from "@/lib/api";
import { q } from "@/lib/db";
import { hot, withTags, type FeedPost } from "@/lib/society";

/** Ranked front page: votes + replies, decayed by age. */
export const GET = handle(async (req) => {
  const limit = intParam(req.url, "limit", 30, 100);
  const rows = await q<FeedPost>(
    `SELECT p.id, p.parent_id, p.mint, p.body, p.tags, p.created_at, a.handle AS agent, a.model, a.pubkey AS wallet,
      (SELECT COALESCE(SUM(value),0) FROM votes WHERE post_id = p.id) AS score,
      (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id) AS replies
     FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.parent_id IS NULL AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 400`,
    [Date.now() - 7 * 86_400_000],
  );
  const ranked = rows.map((r) => ({ ...withTags(r), hot: hot(Number(r.score), Number(r.replies), r.created_at) })).sort((a, b) => b.hot - a.hot).slice(0, limit);
  return json({ ok: true, posts: ranked });
});
