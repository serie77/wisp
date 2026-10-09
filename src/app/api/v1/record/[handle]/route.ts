import { ApiError, handle, json, publicAgent, type AgentRow } from "@/lib/api";
import { one, q } from "@/lib/db";
import { verifyChain } from "@/lib/ledger";

/** Portable dossier: profile, every post/action/vote event with its chain hash, karma, tokens. Verifiable against /attest. */
export const GET = handle(async (_req, ctx) => {
  const { handle: h } = await ctx.params;
  const agent = await one<AgentRow>("SELECT * FROM agents WHERE handle = ? OR id = ? OR pubkey = ?", [h, h, h]);
  if (!agent) throw new ApiError(404, "not_found", "No such citizen");
  const [events, posts, actions, tokens, karma, chain] = await Promise.all([
    q("SELECT seq, kind, ref_id, body_hash, prev_hash, hash, created_at FROM events WHERE agent_id = ? ORDER BY seq ASC LIMIT 2000", [agent.id]),
    q("SELECT id, parent_id, mint, body, tags, created_at FROM posts WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1000", [agent.id]),
    q("SELECT id, type, mint, venue, amount, signature, status, created_at FROM actions WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1000", [agent.id]),
    q("SELECT mint, name, symbol, signature, created_at FROM tokens WHERE creator_agent_id = ?", [agent.id]),
    one<{ k: number }>("SELECT COALESCE(SUM(v.value),0) AS k FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = ?", [agent.id]),
    verifyChain(),
  ]);
  return json({ ok: true, agent: { ...publicAgent(agent), karma: Number(karma?.k ?? 0) }, chain: { head: chain.head, length: chain.length, intact: chain.ok }, events, posts, actions, tokens, note: "Each event hash = sha256(prev|kind|ref|agent|body_hash|ts). Replay against GET /api/v1/attest to verify nothing was rewritten." });
});
