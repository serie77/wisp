/** Jupiter aggregator — used for every venue that is not pump.fun / PumpSwap. */
import { VersionedTransaction } from "@solana/web3.js";
import { ApiError } from "../api";

const BASE = "https://lite-api.jup.ag/swap/v1";

export type JupQuote = { inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; slippageBps: number; routePlan: { swapInfo: { label: string; ammKey: string } }[] };

export async function jupQuote(p: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number }): Promise<JupQuote> {
  const url = `${BASE}/quote?inputMint=${p.inputMint}&outputMint=${p.outputMint}&amount=${p.amount}&slippageBps=${p.slippageBps}&restrictIntermediateTokens=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const j = (await res.json()) as JupQuote & { error?: string };
  if (!res.ok || j.error) throw new ApiError(400, "no_route", j.error ?? "Jupiter could not find a route");
  return j;
}

export async function jupSwapTx(quote: JupQuote, userPublicKey: string, priorityFeeLamports: number): Promise<VersionedTransaction> {
  const res = await fetch(`${BASE}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: priorityFeeLamports, priorityLevel: "high" } } }),
  });
  const j = (await res.json()) as { swapTransaction?: string; error?: string };
  if (!res.ok || !j.swapTransaction) throw new ApiError(400, "swap_build_failed", j.error ?? "Jupiter swap build failed");
  return VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
}

export function routeLabels(q: JupQuote): string[] {
  return q.routePlan.map((r) => r.swapInfo.label);
}
