import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent } from "@/lib/api";
import { now, one, run } from "@/lib/db";
import { env } from "@/lib/env";
import { connection } from "@/lib/solana/connection";
import { fetchSharingConfig } from "@/lib/solana/feeshare";
import { fetchBondingCurve } from "@/lib/solana/pumpfun";
import { buildFeeShareTx, feeShareEnabled } from "@/lib/treasury";
import { executeOrReturn, logAction, parsePubkey } from "@/lib/trade";

const Body = z.object({ execute: z.boolean().optional().default(true) });

/** Opt a coin you created into creator-fee sharing (you keep most of it, the treasury takes WISP_FEE_SHARE_BPS). Idempotent. */
export const POST = handle(async (req, ctx) => {
  const agent = await requireAgent(req);
  const { mint: mintStr } = await ctx.params;
  const b = await parseBody(req, Body);
  if (!feeShareEnabled()) throw new ApiError(503, "treasury_disabled", "Fee sharing is not configured on this Wisp");
  const mint = parsePubkey(mintStr, "mint");
  const conn = connection();
  const existing = await fetchSharingConfig(conn, mint);
  if (existing?.adminRevoked) {
    await run("UPDATE tokens SET fee_share_status = 'active', fee_share_bps = ? WHERE mint = ?", [existing.shareholders.find((s) => s.address.toBase58() !== agent.pubkey)?.shareBps ?? 0, mintStr]);
    return json({ ok: true, mint: mintStr, status: "active", shares: existing.shareholders.map((s) => ({ address: s.address.toBase58(), share_bps: s.shareBps })), note: "Already opted in" });
  }
  const curve = await fetchBondingCurve(conn, mint);
  if (!curve) throw new ApiError(404, "not_pump", "No pump.fun bonding curve for that mint");
  if (!curve.creator.equals(new PublicKey(agent.pubkey))) throw new ApiError(403, "not_creator", "Only the coin's creator can set fee sharing");
  const { built, shares } = await buildFeeShareTx(curve.creator, mint);
  const result = await executeOrReturn({ agent, built, execute: b.execute });
  if (result.executed) {
    await run("UPDATE tokens SET fee_share_status = 'active', fee_share_signature = ?, fee_share_bps = ? WHERE mint = ?", [result.signature, env.feeShareBps, mintStr]);
    await logAction({ agent, type: "deploy", mint: mintStr, venue: "pump-fees", amount: `${env.feeShareBps} bps`, result, detail: { fee_share: shares } });
  } else if (!(await one("SELECT mint FROM tokens WHERE mint = ?", [mintStr]))) {
    // coin deployed elsewhere; nothing to update
  } else await run("UPDATE tokens SET fee_share_status = 'pending', updated_at = ? WHERE mint = ?", [now(), mintStr]).catch(() => undefined);
  return json({ ok: true, mint: mintStr, status: result.executed ? "active" : "pending", shares, ...result });
});
