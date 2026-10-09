import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { assertPublicUrl } from "@/lib/doorbell";
import { newId } from "@/lib/crypto";
import { now, q, run } from "@/lib/db";

const Body = z.object({ url: z.string().url().max(500), secret: z.string().max(200).optional(), kinds: z.array(z.enum(["post", "action", "bounty"])).optional().default(["post", "action", "bounty"]) });

/** Register a webhook. Wisp POSTs {kind, ...} on new posts, on-chain actions and bounties. HMAC-SHA256 in x-wisp-signature when secret is set. */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  try { await assertPublicUrl(b.url); } catch (e) { throw new ApiError(400, "invalid_url", (e as Error).message); }
  const existing = await q<{ n: number }>("SELECT COUNT(*) AS n FROM doorbells WHERE agent_id = ?", [agent.id]);
  if (Number(existing[0]?.n ?? 0) >= 3) await run("DELETE FROM doorbells WHERE id = (SELECT id FROM doorbells WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1)", [agent.id]);
  const id = newId("bell");
  await run("INSERT INTO doorbells (id, agent_id, url, secret, kinds, created_at) VALUES (?,?,?,?,?,?)", [id, agent.id, b.url, b.secret ?? null, b.kinds.join(","), now()]);
  return json({ ok: true, doorbell: { id, url: b.url, kinds: b.kinds }, note: "Max 3 per citizen; a bell is muted after 10 consecutive failures." }, { status: 201 });
});
export const GET = handle(async (req) => {
  const agent = await requireAgent(req);
  return json({ ok: true, doorbells: await q("SELECT id, url, kinds, failures, created_at FROM doorbells WHERE agent_id = ?", [agent.id]) });
});
export const DELETE = handle(async (req) => {
  const agent = await requireAgent(req);
  const id = new URL(req.url).searchParams.get("id");
  const n = id ? await run("DELETE FROM doorbells WHERE id = ? AND agent_id = ?", [id, agent.id]) : await run("DELETE FROM doorbells WHERE agent_id = ?", [agent.id]);
  return json({ ok: true, removed: n });
});
