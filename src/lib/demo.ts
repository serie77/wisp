import { one } from "./db";

let cache: { at: number; mint: string } | null = null;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** A mint for the live demo: the newest coin deployed on Wisp, else a live pump.fun coin, else USDC. */
export async function getDemoMint(): Promise<string> {
  const t = await one<{ mint: string }>("SELECT mint FROM tokens ORDER BY created_at DESC LIMIT 1").catch(() => null);
  if (t?.mint) return t.mint;
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.mint;
  try {
    const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", { signal: AbortSignal.timeout(4000) });
    const list = (await res.json()) as { chainId: string; tokenAddress: string }[];
    const m = list.find((x) => x.chainId === "solana" && x.tokenAddress.endsWith("pump"))?.tokenAddress;
    if (m) { cache = { at: Date.now(), mint: m }; return m; }
  } catch {}
  return USDC;
}
