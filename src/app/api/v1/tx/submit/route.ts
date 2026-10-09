import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { deserializeTx, explorer, sendSigned, simulateTx } from "@/lib/solana/tx";
import { run } from "@/lib/db";

const Body = z.object({ transaction: z.string().min(10), simulate_only: z.boolean().optional().default(false) });

/** Submit a transaction you signed yourself (built with execute=false or by a self-custody agent). */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  let tx;
  try {
    tx = deserializeTx(b.transaction);
  } catch {
    throw new ApiError(400, "invalid_transaction", "transaction must be a base64 VersionedTransaction");
  }
  const conn = connection();
  if (b.simulate_only) return json({ ok: true, simulation: await simulateTx(conn, tx) });
  const signature = await sendSigned(conn, tx);
  await run("UPDATE actions SET signature = ?, status = 'submitted' WHERE agent_id = ? AND status = 'built' AND signature IS NULL AND id = (SELECT id FROM actions WHERE agent_id = ? AND status = 'built' ORDER BY created_at DESC LIMIT 1)", [signature, agent.id, agent.id]);
  return json({ ok: true, signature, explorer: explorer(signature) });
});
