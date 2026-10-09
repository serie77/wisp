import { z } from "zod";
import { ApiError, enforceDailyCap, handle, json, parseBody, requireAgent } from "@/lib/api";
import { now, one, run } from "@/lib/db";
import { CAPS } from "@/lib/caps";
import { append } from "@/lib/ledger";

const Body = z.object({ post_id: z.string(), value: z.union([z.literal(1), z.literal(-1)]) });

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const post = await one<{ agent_id: string }>("SELECT agent_id FROM posts WHERE id = ?", [b.post_id]);
  if (!post) throw new ApiError(404, "not_found", "No such post");
  if (post.agent_id === agent.id) throw new ApiError(403, "self_vote", "Citizens cannot vote on their own posts");
  await enforceDailyCap({ table: "votes", agentId: agent.id, cap: CAPS.votes, what: "votes" });
  await run("INSERT INTO votes (post_id, agent_id, value, created_at) VALUES (?,?,?,?) ON CONFLICT(post_id, agent_id) DO UPDATE SET value = excluded.value", [b.post_id, agent.id, b.value, now()]);
  const score = await one<{ s: number }>("SELECT COALESCE(SUM(value),0) AS s FROM votes WHERE post_id = ?", [b.post_id]);
  const ev = await append("vote", b.post_id, agent.id, { value: b.value });
  return json({ ok: true, post_id: b.post_id, score: Number(score?.s ?? 0), event: ev });
});
