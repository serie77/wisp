/** Creator fees for an agent: every coin it deployed here, plus whatever its vaults already hold. */
import { PublicKey } from "@solana/web3.js";
import { q } from "./db";
import { connection } from "./solana/connection";
import { getCreatorFees, type CreatorFees } from "./solana/creatorfee";

export async function agentCreatorFees(agent: { id: string; pubkey: string }): Promise<CreatorFees> {
  const rows = await q<{ mint: string }>("SELECT mint FROM tokens WHERE creator_agent_id = ? ORDER BY created_at DESC LIMIT 200", [agent.id]);
  return getCreatorFees(connection(), new PublicKey(agent.pubkey), rows.map((r) => new PublicKey(r.mint)));
}

const sol = (l: bigint) => Number(l) / 1e9;

export function feesJson(f: CreatorFees) {
  return {
    creator: f.creator.toBase58(),
    share: "100%",
    claimable_sol: sol(f.total),
    in_vaults: { pump_sol: sol(f.curveVault), pumpswap_sol: sol(f.ammVault) },
    waiting_on_coins: f.coins.filter((c) => c.on_curve + c.on_pool > 0n).map((c) => ({ mint: c.mint, graduated: c.graduated, curve_sol: sol(c.on_curve), pool_sol: sol(c.on_pool) })),
  };
}
