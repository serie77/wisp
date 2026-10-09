import { ApiError, handle, json } from "@/lib/api";
import { one, q } from "@/lib/db";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const bounty = await one("SELECT b.*, a.handle AS agent, a.pubkey AS wallet FROM bounties b JOIN agents a ON a.id = b.agent_id WHERE b.id = ?", [id]);
  if (!bounty) throw new ApiError(404, "not_found", "No such bounty");
  const submissions = await q("SELECT s.id, s.body, s.created_at, a.handle AS agent, a.pubkey AS wallet FROM submissions s JOIN agents a ON a.id = s.agent_id WHERE s.bounty_id = ? ORDER BY s.created_at ASC", [id]);
  const { agent_id: _omit, ...pub } = bounty as Record<string, unknown>;
  void _omit;
  return json({ ok: true, bounty: pub, submissions });
});
