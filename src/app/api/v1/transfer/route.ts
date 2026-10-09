import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent, type AgentRow } from "@/lib/api";
import { one } from "@/lib/db";
import { connection } from "@/lib/solana/connection";
import { buildTransferSolIx, buildTransferTokenIxs, getMintInfo, getTokenBalance, solToLamports, toBaseUnits } from "@/lib/solana/tokens";
import { buildTx } from "@/lib/solana/tx";
import { executeOrReturn, logAction, parsePubkey } from "@/lib/trade";

const Body = z.object({
  to: z.string().min(1),
  amount: z.number().positive(),
  mint: z.string().optional(),
  memo: z.string().max(200).optional(),
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0001),
  execute: z.boolean().optional().default(true),
});

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const conn = connection();
  const from = new PublicKey(agent.pubkey);
  const target = await one<AgentRow>("SELECT * FROM agents WHERE handle = ? OR id = ?", [b.to, b.to]);
  const to = target ? new PublicKey(target.pubkey) : parsePubkey(b.to, "to");
  if (to.equals(from)) throw new ApiError(400, "self_transfer", "Cannot pay yourself");

  let ixs;
  let amountStr: string;
  if (b.mint) {
    const mint = parsePubkey(b.mint, "mint");
    const info = await getMintInfo(conn, mint);
    if (!info) throw new ApiError(404, "unknown_mint", "No SPL mint at that address");
    const amount = toBaseUnits(b.amount, info.decimals);
    const bal = await getTokenBalance(conn, from, mint, info.tokenProgram);
    if (bal.amount < amount) throw new ApiError(400, "insufficient", `Balance ${Number(bal.amount) / 10 ** info.decimals} < ${b.amount}`);
    ixs = buildTransferTokenIxs({ from, to, mint, amount, decimals: info.decimals, tokenProgram: info.tokenProgram });
    amountStr = `${b.amount} ${b.mint.slice(0, 4)}…`;
  } else {
    const lamports = solToLamports(b.amount);
    const bal = await conn.getBalance(from, "confirmed");
    if (BigInt(bal) < lamports + 10_000n) throw new ApiError(400, "insufficient", `Balance ${bal / 1e9} SOL < ${b.amount} SOL + fees`);
    ixs = [buildTransferSolIx(from, to, lamports)];
    amountStr = `${b.amount} SOL`;
  }
  const built = await buildTx(conn, { payer: from, ixs, computeUnits: 50_000, priorityFeeSol: b.priority_fee_sol });
  const result = await executeOrReturn({ agent, built, execute: b.execute });
  await logAction({ agent, type: "transfer", mint: b.mint ?? null, venue: "system", amount: amountStr, result, detail: { to: to.toBase58(), to_agent: target?.handle ?? null, memo: b.memo ?? null } });
  return json({ ok: true, from: agent.handle, to: target ? { agent: target.handle, wallet: target.pubkey } : { wallet: to.toBase58() }, amount: b.amount, mint: b.mint ?? "SOL", memo: b.memo ?? null, ...result });
});
