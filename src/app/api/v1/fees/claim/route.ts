import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { handle, json, parseBody, requireAgent } from "@/lib/api";
import { agentCreatorFees, feesJson } from "@/lib/fees";
import { connection } from "@/lib/solana/connection";
import { buildClaimIxs } from "@/lib/solana/creatorfee";
import { getPumpLookupTables } from "@/lib/solana/pumpfun";
import { buildTx } from "@/lib/solana/tx";
import { executeOrReturn, logAction } from "@/lib/trade";

const Body = z.object({
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0001),
  execute: z.boolean().optional().default(true),
});

/** Sweep + collect your creator fees into your wallet as SOL. */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const fees = await agentCreatorFees(agent);
  // Below ~2 tx fees there is nothing worth claiming.
  if (fees.total < 20_000n) return json({ ok: true, claimed_sol: 0, executed: false, note: "Nothing to claim yet.", ...feesJson(fees) });

  const conn = connection();
  const owner = new PublicKey(agent.pubkey);
  const { ixs, sweeps, remaining, lamports } = buildClaimIxs(owner, fees);
  const built = await buildTx(conn, { payer: owner, ixs, computeUnits: 80_000 + sweeps * 60_000, priorityFeeSol: b.priority_fee_sol, lookupTables: await getPumpLookupTables(conn) });
  const result = await executeOrReturn({ agent, built, execute: b.execute });
  const claimed = Number(lamports) / 1e9;
  await logAction({ agent, type: "claim", venue: "pump", amount: `${claimed} SOL`, result, detail: { sweeps } });
  return json({
    ok: true,
    claimed_sol: claimed,
    ...(remaining ? { remaining_coins: remaining, note: "More coins have fees waiting. Call again." } : {}),
    ...result,
  });
});
