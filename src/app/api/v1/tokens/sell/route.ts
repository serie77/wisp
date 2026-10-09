import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { WSOL_MINT } from "@/lib/solana/constants";
import { jupQuote, jupSwapTx, routeLabels } from "@/lib/solana/jupiter";
import * as pump from "@/lib/solana/pumpfun";
import * as pumpswap from "@/lib/solana/pumpswap";
import { getTokenBalance, toBaseUnits } from "@/lib/solana/tokens";
import { buildTx, explorer, sendAndConfirm, serializeTx } from "@/lib/solana/tx";
import { detectVenue } from "@/lib/solana/venue";
import { agentKeypair, executeOrReturn, logAction, parsePubkey, type ExecResult } from "@/lib/trade";

const Body = z.object({
  mint: z.string(),
  percent: z.number().min(0.01).max(100).optional(),
  amount: z.number().positive().optional(),
  slippage_bps: z.number().int().min(0).max(10_000).optional().default(500),
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0002),
  close_token_account: z.boolean().optional().default(true),
  execute: z.boolean().optional().default(true),
});

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  if (!b.percent && !b.amount) throw new ApiError(400, "amount_required", "Provide percent (0-100) or amount (whole tokens)");
  const conn = connection();
  const user = new PublicKey(agent.pubkey);
  const mint = parsePubkey(b.mint, "mint");
  const venue = await detectVenue(conn, mint);
  if (!venue) throw new ApiError(404, "unknown_mint", "No SPL mint at that address");

  const bal = await getTokenBalance(conn, user, mint, venue.mintInfo.tokenProgram);
  if (bal.amount === 0n) throw new ApiError(400, "no_balance", "This wallet holds none of that token");
  let tokens = b.amount ? toBaseUnits(b.amount, venue.mintInfo.decimals) : (bal.amount * BigInt(Math.round(b.percent! * 100))) / 10_000n;
  if (tokens > bal.amount) tokens = bal.amount;
  if (tokens <= 0n) throw new ApiError(400, "amount_too_small", "Sell amount rounds to zero");
  const sellingAll = tokens === bal.amount;
  const keep = BigInt(10_000 - b.slippage_bps);

  let result: ExecResult;
  let quotedLamports: bigint;
  let route: string;
  if (venue.kind === "pump") {
    if (!pump.isSolQuoted(venue.curve)) throw new ApiError(400, "unsupported_quote", "Only SOL-quoted pump.fun coins are supported");
    quotedLamports = pump.quoteSell(venue.curve, tokens);
    const ixs = pump.buildSellIxs({ user, mint, tokens, minSolOut: (quotedLamports * keep) / 10_000n, creator: venue.curve.creator, tokenProgram: venue.mintInfo.tokenProgram, isMayhem: venue.curve.isMayhem, isCashback: venue.curve.isCashback, closeAccount: sellingAll && b.close_token_account });
    const built = await buildTx(conn, { payer: user, ixs, computeUnits: 200_000, priorityFeeSol: b.priority_fee_sol, lookupTables: await pump.getPumpLookupTables(conn) });
    result = await executeOrReturn({ agent, built, execute: b.execute });
    route = "pump.fun bonding curve";
  } else if (venue.kind === "pumpswap") {
    quotedLamports = pumpswap.quoteSell(venue.pool, tokens);
    const ixs = pumpswap.buildSellIxs({ user, pool: venue.pool, tokens, minSolOut: (quotedLamports * keep) / 10_000n, baseTokenProgram: venue.mintInfo.tokenProgram, closeAccount: sellingAll && b.close_token_account });
    const built = await buildTx(conn, { payer: user, ixs, computeUnits: 250_000, priorityFeeSol: b.priority_fee_sol, lookupTables: await pump.getPumpLookupTables(conn) });
    result = await executeOrReturn({ agent, built, execute: b.execute });
    route = "PumpSwap AMM";
  } else {
    const quote = await jupQuote({ inputMint: mint.toBase58(), outputMint: WSOL_MINT.toBase58(), amount: tokens, slippageBps: b.slippage_bps });
    quotedLamports = BigInt(quote.outAmount);
    const tx = await jupSwapTx(quote, agent.pubkey, Math.round(b.priority_fee_sol * 1e9));
    route = `Jupiter → ${routeLabels(quote).join(" → ")}`;
    const kp = agentKeypair(agent);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    if (b.execute && kp) {
      const signature = await sendAndConfirm(conn, { tx, blockhash, lastValidBlockHeight }, [kp]);
      result = { executed: true, signature, explorer: explorer(signature) };
    } else {
      result = { executed: false, transaction: serializeTx(tx), blockhash, last_valid_block_height: lastValidBlockHeight, signers: [agent.pubkey], note: "Sign and POST /api/v1/tx/submit" };
    }
  }

  const sold = Number(tokens) / 10 ** venue.mintInfo.decimals;
  await logAction({ agent, type: "sell", mint: mint.toBase58(), venue: venue.kind, amount: String(sold), result, detail: { route, quoted_sol: Number(quotedLamports) / 1e9 } });
  return json({ ok: true, mint: mint.toBase58(), venue: venue.kind, route, sold_tokens: sold, quoted_sol: Number(quotedLamports) / 1e9, slippage_bps: b.slippage_bps, ...result });
});
