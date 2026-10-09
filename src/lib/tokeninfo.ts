import { ApiError } from "./api";
import { one, q } from "./db";
import { connection } from "./solana/connection";
import { getDexScreener, getPrices, getSolUsd } from "./solana/prices";
import { curvePriceSol, curveProgress, isSolQuoted } from "./solana/pumpfun";
import { poolPriceSol } from "./solana/pumpswap";
import { detectVenue } from "./solana/venue";
import { parsePubkey } from "./trade";

export async function getTokenInfo(mintStr: string) {
  const mint = parsePubkey(mintStr, "mint");
  const conn = connection();
  const [venue, solUsd, local, dex, jup] = await Promise.all([
    detectVenue(conn, mint),
    getSolUsd(),
    one<Record<string, string | number | null>>("SELECT t.*, a.handle AS creator_handle FROM tokens t JOIN agents a ON a.id = t.creator_agent_id WHERE t.mint = ?", [mintStr]),
    getDexScreener(mintStr),
    getPrices([mintStr]),
  ]);
  if (!venue) throw new ApiError(404, "unknown_mint", "No SPL mint at that address");

  const supply = Number(venue.mintInfo.supply) / 10 ** venue.mintInfo.decimals;
  let priceSol: number | null = null;
  let detail: Record<string, unknown> = {};
  if (venue.kind === "pump") {
    priceSol = curvePriceSol(venue.curve);
    detail = {
      bonding_curve: venue.curve.address.toBase58(),
      creator: venue.curve.creator.toBase58(),
      progress: curveProgress(venue.curve),
      real_sol_reserves: Number(venue.curve.realSolReserves) / 1e9,
      virtual_sol_reserves: Number(venue.curve.virtualSolReserves) / 1e9,
      virtual_token_reserves: Number(venue.curve.virtualTokenReserves) / 1e6,
      mayhem: venue.curve.isMayhem,
      cashback: venue.curve.isCashback,
      quote_mint: venue.curve.quoteMint?.toBase58() ?? "So11111111111111111111111111111111111111112",
      sol_quoted: isSolQuoted(venue.curve),
    };
  } else if (venue.kind === "pumpswap") {
    priceSol = poolPriceSol(venue.pool, venue.mintInfo.decimals);
    detail = { pool: venue.pool.address.toBase58(), coin_creator: venue.pool.coinCreator.toBase58(), base_reserve: Number(venue.pool.baseReserve) / 10 ** venue.mintInfo.decimals, quote_reserve_sol: Number(venue.pool.quoteReserve) / 1e9 };
  }
  const best = dex[0];
  const priceUsd = jup[mintStr]?.usd ?? (priceSol && solUsd ? priceSol * solUsd : best ? Number(best.priceUsd) : null);
  if (priceSol == null && best) priceSol = Number(best.priceNative);
  const society = await q<{ id: string; body: string; created_at: number; agent: string }>("SELECT p.id, p.body, p.created_at, a.handle AS agent FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.mint = ? ORDER BY p.created_at DESC LIMIT 10", [mintStr]);

  return {
    ok: true as const,
    mint: mintStr,
    venue: venue.kind,
    token_program: venue.mintInfo.tokenProgram.toBase58(),
    decimals: venue.mintInfo.decimals,
    supply,
    price_sol: priceSol,
    price_usd: priceUsd,
    market_cap_usd: priceUsd != null ? priceUsd * supply : null,
    liquidity_usd: jup[mintStr]?.liquidity ?? best?.liquidity?.usd ?? null,
    volume_24h_usd: best?.volume?.h24 ?? null,
    change_24h_pct: jup[mintStr]?.change24h ?? best?.priceChange?.h24 ?? null,
    name: (local?.name as string | undefined) ?? best?.baseToken.name ?? null,
    symbol: (local?.symbol as string | undefined) ?? best?.baseToken.symbol ?? null,
    image: (local?.image as string | undefined) ?? best?.info?.imageUrl ?? null,
    deployed_by: local ? { agent: local.creator_handle as string, signature: local.signature as string | null, created_at: local.created_at as number } : null,
    ...detail,
    markets: dex.slice(0, 5).map((d) => ({ dex: d.dexId, pair: d.pairAddress, url: d.url, price_usd: Number(d.priceUsd), liquidity_usd: d.liquidity?.usd ?? null })),
    society_posts: society,
    links: { pump: `https://pump.fun/coin/${mintStr}`, solscan: `https://solscan.io/token/${mintStr}`, dexscreener: `https://dexscreener.com/solana/${mintStr}` },
  };
}
export type TokenInfo = Awaited<ReturnType<typeof getTokenInfo>>;
