import { ApiError, getParam, handle, json } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { WSOL_MINT } from "@/lib/solana/constants";
import { jupQuote, routeLabels } from "@/lib/solana/jupiter";
import * as pump from "@/lib/solana/pumpfun";
import * as pumpswap from "@/lib/solana/pumpswap";
import { solToLamports, toBaseUnits } from "@/lib/solana/tokens";
import { detectVenue } from "@/lib/solana/venue";
import { parsePubkey } from "@/lib/trade";

/** GET /api/v1/quote?mint=&side=buy|sell&amount=  (buy: amount in SOL; sell: amount in whole tokens) */
export const GET = handle(async (req) => {
  const mint = parsePubkey(getParam(req.url, "mint") ?? "", "mint");
  const side = getParam(req.url, "side") === "sell" ? "sell" : "buy";
  const amount = Number(getParam(req.url, "amount"));
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "invalid_amount", "amount must be > 0");
  const venue = await detectVenue(connection(), mint);
  if (!venue) throw new ApiError(404, "unknown_mint", "No SPL mint at that address");
  const dec = venue.mintInfo.decimals;

  if (venue.kind === "pump") {
    const out = side === "buy" ? pump.quoteBuy(venue.curve, solToLamports(amount)) : pump.quoteSell(venue.curve, toBaseUnits(amount, dec));
    return json({ ok: true, venue: "pump", side, in: amount, out: side === "buy" ? Number(out) / 10 ** dec : Number(out) / 1e9, price_sol: pump.curvePriceSol(venue.curve), fee_bps: 125 });
  }
  if (venue.kind === "pumpswap") {
    const out = side === "buy" ? pumpswap.quoteBuy(venue.pool, solToLamports(amount)) : pumpswap.quoteSell(venue.pool, toBaseUnits(amount, dec));
    return json({ ok: true, venue: "pumpswap", side, in: amount, out: side === "buy" ? Number(out) / 10 ** dec : Number(out) / 1e9, price_sol: pumpswap.poolPriceSol(venue.pool, dec), fee_bps: 125 });
  }
  const q = side === "buy"
    ? await jupQuote({ inputMint: WSOL_MINT.toBase58(), outputMint: mint.toBase58(), amount: solToLamports(amount), slippageBps: 50 })
    : await jupQuote({ inputMint: mint.toBase58(), outputMint: WSOL_MINT.toBase58(), amount: toBaseUnits(amount, dec), slippageBps: 50 });
  return json({ ok: true, venue: "jupiter", side, in: amount, out: side === "buy" ? Number(q.outAmount) / 10 ** dec : Number(q.outAmount) / 1e9, price_impact_pct: Number(q.priceImpactPct), route: routeLabels(q) });
});
