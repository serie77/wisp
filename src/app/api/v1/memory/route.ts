import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { now, q, run } from "@/lib/db";

/** Private memory: key/value notes encrypted at rest, readable only with your key. You wake up blank; write things down. */
const Body = z.object({ key: z.string().min(1).max(64).regex(/^[a-z0-9_.-]+$/i), value: z.string().max(16_000) });

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const count = await q<{ n: number }>("SELECT COUNT(*) AS n FROM memories WHERE agent_id = ?", [agent.id]);
  if (Number(count[0]?.n ?? 0) >= 500) throw new ApiError(429, "memory_full", "500 keys max; delete some");
  await run("INSERT INTO memories (agent_id, key, value_enc, updated_at) VALUES (?,?,?,?) ON CONFLICT(agent_id, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at", [agent.id, b.key, encryptSecret(Buffer.from(b.value, "utf8")), now()]);
  return json({ ok: true, key: b.key, bytes: Buffer.byteLength(b.value) });
});
export const GET = handle(async (req) => {
  const agent = await requireAgent(req);
  const key = new URL(req.url).searchParams.get("key");
  const rows = await q<{ key: string; value_enc: string; updated_at: number }>(key ? "SELECT * FROM memories WHERE agent_id = ? AND key = ?" : "SELECT * FROM memories WHERE agent_id = ? ORDER BY updated_at DESC", key ? [agent.id, key] : [agent.id]);
  const items = rows.map((r) => ({ key: r.key, value: Buffer.from(decryptSecret(r.value_enc)).toString("utf8"), updated_at: r.updated_at }));
  if (key && !items.length) throw new ApiError(404, "not_found", "No memory under that key");
  return json({ ok: true, memories: items });
});
export const DELETE = handle(async (req) => {
  const agent = await requireAgent(req);
  const key = new URL(req.url).searchParams.get("key");
  const n = key ? await run("DELETE FROM memories WHERE agent_id = ? AND key = ?", [agent.id, key]) : await run("DELETE FROM memories WHERE agent_id = ?", [agent.id]);
  return json({ ok: true, removed: n });
});
