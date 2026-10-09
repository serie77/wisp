import { Keypair, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { now, run } from "@/lib/db";
import { env } from "@/lib/env";
import { connection } from "@/lib/solana/connection";
import { CURVE, TOKEN_2022_PROGRAM_ID } from "@/lib/solana/constants";
import { prepareTokenMetadata } from "@/lib/solana/metadata";
import { bondingCurvePda, buildBuyIxs, buildCreateIx, freshCurve, getPumpLookupTables, quoteBuy } from "@/lib/solana/pumpfun";
import { solToLamports } from "@/lib/solana/tokens";
import { buildTx } from "@/lib/solana/tx";
import { executeOrReturn, logAction, parsePubkey, type ExecResult } from "@/lib/trade";
import { buildFeeShareTx, feeShareEnabled } from "@/lib/treasury";

const Body = z.object({
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(10),
  description: z.string().max(1000).optional().default(""),
  image: z.string().min(1),
  twitter: z.string().max(200).optional(),
  telegram: z.string().max(200).optional(),
  website: z.string().max(200).optional(),
  metadata_uri: z.string().url().optional(),
  dev_buy_sol: z.number().min(0).max(85).optional().default(0),
  slippage_bps: z.number().int().min(0).max(10_000).optional().default(1000),
  mayhem: z.boolean().optional().default(false),
  cashback: z.boolean().optional().default(false),
  holder_reward: z.boolean().optional().default(false),
  fee_share: z.boolean().optional().default(true),
  creator: z.string().optional(),
  priority_fee_sol: z.number().min(0).max(0.05).optional().default(0.0005),
  execute: z.boolean().optional().default(true),
});

export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  const conn = connection();
  const payer = new PublicKey(agent.pubkey);
  const creator = b.creator ? parsePubkey(b.creator, "creator") : payer;

  let meta;
  try {
    meta = await prepareTokenMetadata(b);
  } catch (e) {
    throw new ApiError(400, "bad_metadata", (e as Error).message);
  }

  const mintKp = Keypair.generate();
  if (b.cashback) throw new ApiError(400, "cashback_deprecated", "pump.fun no longer allows new cashback coins; use holder_reward instead");
  const ixs = [buildCreateIx({ mint: mintKp.publicKey, payer, creator, name: b.name, symbol: b.symbol, uri: meta.uri, mayhem: b.mayhem, holderReward: b.holder_reward })];
  let quoted: bigint | null = null;
  if (b.dev_buy_sol > 0) {
    const lamports = solToLamports(b.dev_buy_sol);
    quoted = quoteBuy(freshCurve(), lamports);
    const minOut = (quoted * BigInt(10_000 - b.slippage_bps)) / 10_000n;
    ixs.push(...buildBuyIxs({ user: payer, mint: mintKp.publicKey, lamports, minTokensOut: minOut, creator, tokenProgram: TOKEN_2022_PROGRAM_ID, isMayhem: b.mayhem }));
  }

  const built = await buildTx(conn, { payer, ixs, computeUnits: 400_000, priorityFeeSol: b.priority_fee_sol, lookupTables: await getPumpLookupTables(conn) });
  const result = await executeOrReturn({ agent, built, extraSigners: [mintKp], execute: b.execute });
  const mint = mintKp.publicKey.toBase58();

  if (result.executed) {
    await run("INSERT OR REPLACE INTO tokens (mint, name, symbol, uri, image, description, creator_agent_id, signature, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      mint, b.name, b.symbol, meta.uri, meta.imageUrl, b.description, agent.id, result.signature, now(),
    ]);
  }
  // Creator-fee sharing: the creator keeps (10000 - WISP_FEE_SHARE_BPS) bps, the treasury takes the rest.
  // It needs its own transaction (create_v2 + dev buy + opt-in exceeds 1232 bytes). Custodial agents: sent now. Self-custody: returned unsigned.
  let feeShare: Record<string, unknown> = { status: "skipped", reason: !feeShareEnabled() ? "treasury not configured" : b.holder_reward ? "holder-rewards coins route the creator fee to holders" : !b.fee_share ? "fee_share=false" : !creator.equals(payer) ? "creator override" : "deploy not executed" };
  if (feeShareEnabled() && b.fee_share && !b.holder_reward && creator.equals(payer) && (result.executed || !b.execute)) {
    try {
      const { built: shareTx, shares } = await buildFeeShareTx(creator, mintKp.publicKey);
      const shareResult: ExecResult = await executeOrReturn({ agent, built: shareTx, execute: b.execute && result.executed });
      if (shareResult.executed) await run("UPDATE tokens SET fee_share_status = 'active', fee_share_signature = ?, fee_share_bps = ? WHERE mint = ?", [shareResult.signature, env.feeShareBps, mint]);
      feeShare = { status: shareResult.executed ? "active" : "pending", shares, ...shareResult, ...(shareResult.executed ? {} : { note: "Sign after the deploy lands and POST /api/v1/tx/submit, or POST /api/v1/tokens/{mint}/share later." }) };
    } catch (e) {
      feeShare = { status: "failed", error: (e as Error).message, retry: `POST /api/v1/tokens/${mint}/share` };
    }
  }
  await logAction({ agent, type: "deploy", mint, venue: "pump", amount: b.dev_buy_sol ? String(b.dev_buy_sol) : null, result, detail: { name: b.name, symbol: b.symbol, uri: meta.uri } });

  return json({
    ok: true,
    mint,
    bonding_curve: bondingCurvePda(mintKp.publicKey).toBase58(),
    metadata_uri: meta.uri,
    image: meta.imageUrl,
    token_program: TOKEN_2022_PROGRAM_ID.toBase58(),
    dev_buy: b.dev_buy_sol ? { sol: b.dev_buy_sol, quoted_tokens: Number(quoted) / 10 ** CURVE.tokenDecimals } : null,
    pump_url: `https://pump.fun/coin/${mint}`,
    holder_reward: b.holder_reward,
    fee_share: feeShare,
    ...result,
    ...(result.executed ? {} : { mint_secret_key_note: "The mint keypair has already signed this transaction. Add your wallet signature and submit." }),
  }, { status: result.executed ? 201 : 200 });
});
