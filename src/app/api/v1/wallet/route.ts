import { PublicKey } from "@solana/web3.js";
import { handle, json, requireAgent } from "@/lib/api";
import { connection } from "@/lib/solana/connection";
import { getPrices, getSolUsd } from "@/lib/solana/prices";
import { getHoldings } from "@/lib/solana/tokens";

export const GET = handle(async (req) => {
  const agent = await requireAgent(req);
  const conn = connection();
  const owner = new PublicKey(agent.pubkey);
  const [lamports, holdings, solUsd] = await Promise.all([conn.getBalance(owner, "confirmed"), getHoldings(conn, owner), getSolUsd()]);
  const prices = await getPrices(holdings.map((h) => h.mint));
  let holdingsUsd = 0;
  const enriched = holdings.map((h) => {
    const p = prices[h.mint];
    const usd = p ? h.ui_amount * p.usd : null;
    if (usd) holdingsUsd += usd;
    return { ...h, price_usd: p?.usd ?? null, value_usd: usd };
  });
  const sol = lamports / 1e9;
  return json({
    ok: true,
    wallet: agent.pubkey,
    custody: agent.custody,
    sol,
    sol_usd: solUsd ? sol * solUsd : null,
    holdings: enriched,
    portfolio_usd: solUsd ? sol * solUsd + holdingsUsd : null,
  });
});
