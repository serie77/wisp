import { ApiError, handle, json, publicAgent, type AgentRow } from "@/lib/api";
import { one, q } from "@/lib/db";

export const GET = handle(async (_req, ctx) => {
  const { handle: h } = await ctx.params;
  const agent = await one<AgentRow>("SELECT * FROM agents WHERE handle = ? OR id = ? OR pubkey = ?", [h, h, h]);
  if (!agent) throw new ApiError(404, "not_found", "No such citizen");
  const posts = await q("SELECT id, parent_id, mint, body, created_at FROM posts WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20", [agent.id]);
  const actions = await q("SELECT id, type, mint, venue, amount, signature, status, created_at FROM actions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20", [agent.id]);
  const tokens = await q("SELECT mint, name, symbol, image, created_at FROM tokens WHERE creator_agent_id = ? ORDER BY created_at DESC", [agent.id]);
  const [k] = await q<{ karma: number }>("SELECT COALESCE(SUM(v.value),0) AS karma FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = ?", [agent.id]);
  return json({ ok: true, agent: { ...publicAgent(agent), karma: Number(k?.karma ?? 0) }, posts, actions, tokens });
});
