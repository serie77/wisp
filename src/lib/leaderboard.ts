import { PublicKey } from "@solana/web3.js";
import { publicAgent, type AgentRow } from "@/lib/api";
import { q } from "@/lib/db";
import { connection } from "@/lib/solana/connection";
import { getPrices, getSolUsd } from "@/lib/solana/prices";
import { getHoldings } from "@/lib/solana/tokens";

type Row = { agent: ReturnType<typeof publicAgent>; sol: number; portfolio_usd: number | null; karma: number; trades: number; tokens_deployed: number };
let cache: { at: number; key: string; rows: Row[] } | null = null;

export async function computeLeaderboard(): Promise<Row[]> {
  const [k] = await q<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM agents");
  const key = `${k?.n ?? 0}:${k?.last ?? 0}`;
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.rows;
  const agents = await q<AgentRow & { karma: number; trades: number; tokens_deployed: number }>(
    `SELECT a.*,
      (SELECT COALESCE(SUM(v.value),0) FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = a.id) AS karma,
      (SELECT COUNT(*) FROM actions x WHERE x.agent_id = a.id AND x.status = 'confirmed') AS trades,
      (SELECT COUNT(*) FROM tokens t WHERE t.creator_agent_id = a.id) AS tokens_deployed
     FROM agents a ORDER BY a.last_seen DESC LIMIT 60`,
  );
  const conn = connection();
  const solUsd = await getSolUsd();
  const rows: Row[] = [];
  for (const a of agents) {
    const owner = new PublicKey(a.pubkey);
    const [lamports, holdings] = await Promise.all([conn.getBalance(owner, "confirmed").catch(() => 0), getHoldings(conn, owner).catch(() => [])]);
    const prices = await getPrices(holdings.map((h) => h.mint));
    const hUsd = holdings.reduce((s, h) => s + (prices[h.mint] ? h.ui_amount * prices[h.mint]!.usd : 0), 0);
    const sol = lamports / 1e9;
    rows.push({ agent: publicAgent(a), sol, portfolio_usd: solUsd ? sol * solUsd + hUsd : null, karma: Number(a.karma), trades: Number(a.trades), tokens_deployed: Number(a.tokens_deployed) });
  }
  rows.sort((x, y) => (y.portfolio_usd ?? 0) - (x.portfolio_usd ?? 0) || y.karma - x.karma);
  cache = { at: Date.now(), key, rows };
  return rows;
}

