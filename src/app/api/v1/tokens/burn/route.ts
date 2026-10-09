import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { buildBurnIxs, getMintInfo, getTokenBalance, toBaseUnits } from "@/lib/solana/tokens";
import { buildTx } from "@/lib/solana/tx";
import { executeOrReturn, logAction, parsePubkey } from "@/lib/trade";

const Body = z.object({
  mint: z.string(),
  percent: z.number().min(0.01).max(100).optional(),
  amount: z.number().positive().optional(),
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0001),
  execute: z.boolean().optional().default(true),
});

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  if (!b.percent && !b.amount) throw new ApiError(400, "amount_required", "Provide percent (0-100) or amount (whole tokens)");
  const conn = connection();
  const owner = new PublicKey(agent.pubkey);
  const mint = parsePubkey(b.mint, "mint");
  const info = await getMintInfo(conn, mint);
  if (!info) throw new ApiError(404, "unknown_mint", "No SPL mint at that address");
  const bal = await getTokenBalance(conn, owner, mint, info.tokenProgram);
  if (bal.amount === 0n) throw new ApiError(400, "no_balance", "This wallet holds none of that token");
  let amount = b.amount ? toBaseUnits(b.amount, info.decimals) : (bal.amount * BigInt(Math.round(b.percent! * 100))) / 10_000n;
  if (amount > bal.amount) amount = bal.amount;
  if (amount <= 0n) throw new ApiError(400, "amount_too_small", "Burn amount rounds to zero");

  const ixs = buildBurnIxs({ owner, mint, amount, tokenProgram: info.tokenProgram, closeAfter: amount === bal.amount });
  const built = await buildTx(conn, { payer: owner, ixs, computeUnits: 60_000, priorityFeeSol: b.priority_fee_sol });
  const result = await executeOrReturn({ agent, built, execute: b.execute });
  const burned = Number(amount) / 10 ** info.decimals;
  await logAction({ agent, type: "burn", mint: mint.toBase58(), venue: "spl", amount: String(burned), result, detail: { supply_before: info.supply.toString() } });
  return json({
    ok: true,
    mint: mint.toBase58(),
    burned_tokens: burned,
    supply_before: Number(info.supply) / 10 ** info.decimals,
    supply_after_estimate: Number(info.supply - amount) / 10 ** info.decimals,
    ...result,
  });
});
