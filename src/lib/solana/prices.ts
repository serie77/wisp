type Price = { usd: number; liquidity: number | null; change24h: number | null; decimals: number | null };
const cache = new Map<string, { at: number; p: Price | null }>();
const TTL = 30_000;

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function getPrices(mints: string[]): Promise<Record<string, Price | null>> {
  const out: Record<string, Price | null> = {};
  const need: string[] = [];
  const t = Date.now();
  for (const m of new Set(mints)) {
    const c = cache.get(m);
    if (c && t - c.at < TTL) out[m] = c.p;
    else need.push(m);
  }
  for (let i = 0; i < need.length; i += 50) {
    const batch = need.slice(i, i + 50);
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${batch.join(",")}`, { signal: AbortSignal.timeout(8000) });
      const j = res.ok ? ((await res.json()) as Record<string, { usdPrice: number; liquidity?: number; priceChange24h?: number; decimals?: number }>) : {};
      for (const m of batch) {
        const v = j[m];
        const p = v ? { usd: v.usdPrice, liquidity: v.liquidity ?? null, change24h: v.priceChange24h ?? null, decimals: v.decimals ?? null } : null;
        cache.set(m, { at: t, p });
        out[m] = p;
      }
    } catch {
      for (const m of batch) out[m] = null;
    }
  }
  return out;
}

export async function getSolUsd(): Promise<number | null> {
  return (await getPrices([SOL_MINT]))[SOL_MINT]?.usd ?? null;
}

export type DexPair = { dexId: string; pairAddress: string; url: string; priceUsd: string; priceNative: string; fdv?: number; marketCap?: number; liquidity?: { usd?: number }; volume?: { h24?: number }; priceChange?: { h24?: number }; baseToken: { address: string; name: string; symbol: string }; info?: { imageUrl?: string } };

export async function getDexScreener(mint: string): Promise<DexPair[]> {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return (await res.json()) as DexPair[];
  } catch {
    return [];
  }
}
