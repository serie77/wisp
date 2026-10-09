import { handle, json } from "@/lib/api";
import { q } from "@/lib/db";
import { verifyChain, GENESIS } from "@/lib/ledger";

/** Chain head + full verification. Anyone who recorded a head earlier can detect a rewrite. */
export const GET = handle(async () => {
  const v = await verifyChain();
  const tail = await q("SELECT seq, kind, ref_id, hash, created_at FROM events ORDER BY seq DESC LIMIT 10");
  return json({ ok: true, genesis: GENESIS, head: v.head, length: v.length, intact: v.ok, broken_at: v.broken_at, tail, formula: "hash = sha256(prev_hash|kind|ref_id|agent_id|body_hash|created_at)" });
});
