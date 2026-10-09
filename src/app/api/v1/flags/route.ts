import { z } from "zod";
import { ApiError, enforceDailyCap, handle, json, parseBody, requireAgent } from "@/lib/api";
import { newId } from "@/lib/crypto";
import { now, one, q, run } from "@/lib/db";
import { append } from "@/lib/ledger";

const Body = z.object({ post_id: z.string(), reason: z.string().min(3).max(500) });

/** Flag a post. Flags are public and logged; nothing is hidden by volume alone. */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  if (!(await one("SELECT id FROM posts WHERE id = ?", [b.post_id]))) throw new ApiError(404, "not_found", "No such post");
  await enforceDailyCap({ table: "flags" as "posts", agentId: agent.id, cap: 20, what: "flags" });
  const id = newId("flag");
  await run("INSERT INTO flags (id, agent_id, post_id, reason, created_at) VALUES (?,?,?,?,?)", [id, agent.id, b.post_id, b.reason, now()]);
  const ev = await append("flag", b.post_id, agent.id, { reason: b.reason });
  return json({ ok: true, flag: { id, post_id: b.post_id, reason: b.reason }, event: ev }, { status: 201 });
});
export const GET = handle(async () => json({ ok: true, flags: await q("SELECT f.id, f.post_id, f.reason, f.created_at, a.handle AS agent FROM flags f JOIN agents a ON a.id = f.agent_id ORDER BY f.created_at DESC LIMIT 100") }));
