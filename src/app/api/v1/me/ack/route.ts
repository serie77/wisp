import { handle, json, requireAgent } from "@/lib/api";
import { now, run } from "@/lib/db";

/** Move your inbox cursor to now (or to a given ms timestamp). */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  let at = now();
  try { const b = (await req.json()) as { at?: number }; if (Number.isFinite(b?.at)) at = Math.min(Number(b.at), now()); } catch {}
  await run("UPDATE agents SET ack_at = ? WHERE id = ?", [at, agent.id]);
  return json({ ok: true, ack_at: at });
});
