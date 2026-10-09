import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { WSOL_MINT } from "@/lib/solana/constants";
import { jupQuote, jupSwapTx, routeLabels } from "@/lib/solana/jupiter";
import * as pump from "@/lib/solana/pumpfun";
import * as pumpswap from "@/lib/solana/pumpswap";
import { solToLamports } from "@/lib/solana/tokens";
import { buildTx, serializeTx, explorer, sendAndConfirm } from "@/lib/solana/tx";
import { detectVenue } from "@/lib/solana/venue";
import { agentKeypair, executeOrReturn, logAction, parsePubkey, type ExecResult } from "@/lib/trade";

const Body = z.object({
  mint: z.string(),
  amount_sol: z.number().positive().max(1000),
  slippage_bps: z.number().int().min(0).max(10_000).optional().default(500),
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0002),
  execute: z.boolean().optional().default(true),
});

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const conn = connection();
  const user = new PublicKey(agent.pubkey);
  const mint = parsePubkey(b.mint, "mint");
  const lamports = solToLamports(b.amount_sol);
  const venue = await detectVenue(conn, mint);
  if (!venue) throw new ApiError(404, "unknown_mint", "No SPL mint at that address");

  const keep = BigInt(10_000 - b.slippage_bps);
  let result: ExecResult;
  let quotedTokens: bigint;
  let route: string;

  if (venue.kind === "pump") {
    if (!pump.isSolQuoted(venue.curve)) throw new ApiError(400, "unsupported_quote", "Only SOL-quoted pump.fun coins are supported");
    quotedTokens = pump.quoteBuy(venue.curve, lamports);
    const ixs = pump.buildBuyIxs({ user, mint, lamports, minTokensOut: (quotedTokens * keep) / 10_000n, creator: venue.curve.creator, tokenProgram: venue.mintInfo.tokenProgram, isMayhem: venue.curve.isMayhem });
    const built = await buildTx(conn, { payer: user, ixs, computeUnits: 200_000, priorityFeeSol: b.priority_fee_sol, lookupTables: await pump.getPumpLookupTables(conn) });
    result = await executeOrReturn({ agent, built, execute: b.execute });
    route = "pump.fun bonding curve";
  } else if (venue.kind === "pumpswap") {
    quotedTokens = pumpswap.quoteBuy(venue.pool, lamports);
    const ixs = pumpswap.buildBuyIxs({ user, pool: venue.pool, lamports, minBaseOut: (quotedTokens * keep) / 10_000n, baseTokenProgram: venue.mintInfo.tokenProgram });
    const built = await buildTx(conn, { payer: user, ixs, computeUnits: 250_000, priorityFeeSol: b.priority_fee_sol, lookupTables: await pump.getPumpLookupTables(conn) });
    result = await executeOrReturn({ agent, built, execute: b.execute });
    route = "PumpSwap AMM";
  } else {
    const quote = await jupQuote({ inputMint: WSOL_MINT.toBase58(), outputMint: mint.toBase58(), amount: lamports, slippageBps: b.slippage_bps });
    quotedTokens = BigInt(quote.outAmount);
    const tx = await jupSwapTx(quote, agent.pubkey, Math.round(b.priority_fee_sol * 1e9));
    route = `Jupiter → ${routeLabels(quote).join(" → ")}`;
    const kp = agentKeypair(agent);
    if (b.execute && kp) {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const signature = await sendAndConfirm(conn, { tx, blockhash, lastValidBlockHeight }, [kp]);
      result = { executed: true, signature, explorer: explorer(signature) };
    } else {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      result = { executed: false, transaction: serializeTx(tx), blockhash, last_valid_block_height: lastValidBlockHeight, signers: [agent.pubkey], note: "Sign and POST /api/v1/tx/submit" };
    }
  }

  await logAction({ agent, type: "buy", mint: mint.toBase58(), venue: venue.kind, amount: String(b.amount_sol), result, detail: { route, quoted_tokens: quotedTokens.toString() } });
  return json({
    ok: true,
    mint: mint.toBase58(),
    venue: venue.kind,
    route,
    spent_sol: b.amount_sol,
    quoted_tokens: Number(quotedTokens) / 10 ** venue.mintInfo.decimals,
    slippage_bps: b.slippage_bps,
    ...result,
  });
});
