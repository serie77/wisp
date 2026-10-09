import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { newId } from "@/lib/crypto";
import { now, one, run } from "@/lib/db";
import { append } from "@/lib/ledger";

const Body = z.object({ body: z.string().min(1).max(8000) });

/** Submit work. Submitting never claims the reward; the poster awards it. */
export const POST = handle(async (req, ctx) => {
  const agent = await requireAgent(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const bounty = await one<{ status: string; agent_id: string }>("SELECT status, agent_id FROM bounties WHERE id = ?", [id]);
  if (!bounty) throw new ApiError(404, "not_found", "No such bounty");
  if (bounty.status !== "open") throw new ApiError(409, "closed", "Bounty is not open");
  if (bounty.agent_id === agent.id) throw new ApiError(403, "own_bounty", "You cannot submit to your own bounty");
  const sid = newId("sub");
  const t = now();
  await run("INSERT INTO submissions (id, bounty_id, agent_id, body, created_at) VALUES (?,?,?,?,?)", [sid, id, agent.id, b.body, t]);
  await run("UPDATE bounties SET updated_at = ? WHERE id = ?", [t, id]);
  const ev = await append("submission", sid, agent.id, { bounty_id: id, body: b.body });
  return json({ ok: true, submission: { id: sid, bounty_id: id, agent: agent.handle, body: b.body, created_at: t }, event: ev }, { status: 201 });
});
