import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { jupQuote, jupSwapTx, routeLabels } from "@/lib/solana/jupiter";
import { getMintInfo, toBaseUnits } from "@/lib/solana/tokens";
import { explorer, sendAndConfirm, serializeTx } from "@/lib/solana/tx";
import { agentKeypair, logAction, parsePubkey, type ExecResult } from "@/lib/trade";

/** Generic swap through Jupiter: any pair, any Solana venue. */
const Body = z.object({
  input_mint: z.string(),
  output_mint: z.string(),
  amount: z.number().positive(),
  slippage_bps: z.number().int().min(0).max(10_000).optional().default(100),
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0002),
  execute: z.boolean().optional().default(true),
});

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const conn = connection();
  const inMint = parsePubkey(b.input_mint, "input_mint");
  const outMint = parsePubkey(b.output_mint, "output_mint");
  const inInfo = await getMintInfo(conn, inMint);
  const outInfo = await getMintInfo(conn, outMint);
  if (!inInfo || !outInfo) throw new ApiError(404, "unknown_mint", "input_mint or output_mint is not an SPL mint");
  const amount = toBaseUnits(b.amount, inInfo.decimals);
  const quote = await jupQuote({ inputMint: inMint.toBase58(), outputMint: outMint.toBase58(), amount, slippageBps: b.slippage_bps });
  const tx = await jupSwapTx(quote, agent.pubkey, Math.round(b.priority_fee_sol * 1e9));
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const kp = agentKeypair(agent);
  let result: ExecResult;
  if (b.execute && kp) {
    const signature = await sendAndConfirm(conn, { tx, blockhash, lastValidBlockHeight }, [kp]);
    result = { executed: true, signature, explorer: explorer(signature) };
  } else {
    result = { executed: false, transaction: serializeTx(tx), blockhash, last_valid_block_height: lastValidBlockHeight, signers: [agent.pubkey], note: "Sign and POST /api/v1/tx/submit" };
  }
  const route = routeLabels(quote);
  await logAction({ agent, type: "swap", mint: outMint.toBase58(), venue: route.join("+").toLowerCase() || "jupiter", amount: String(b.amount), result, detail: { input_mint: b.input_mint, route } });
  return json({ ok: true, input_mint: b.input_mint, output_mint: b.output_mint, in_amount: b.amount, out_amount: Number(quote.outAmount) / 10 ** outInfo.decimals, price_impact_pct: Number(quote.priceImpactPct), route, ...result });
});
