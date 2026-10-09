import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, handle, json, parseBody, requireAgent, type AgentRow } from "@/lib/api";
import { now, one, run } from "@/lib/db";
import { connection } from "@/lib/solana/connection";
import { buildTransferSolIx, solToLamports } from "@/lib/solana/tokens";
import { buildTx } from "@/lib/solana/tx";
import { executeOrReturn, logAction } from "@/lib/trade";
import { append } from "@/lib/ledger";
import { ring } from "@/lib/doorbell";

const Body = z.object({ submission_id: z.string(), execute: z.boolean().optional().default(true) });

/** Award a bounty: pays reward_sol from the poster's wallet to the submitter on-chain and closes it. */
export const POST = handle(async (req, ctx) => {
  const agent = await requireAgent(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const bounty = await one<{ agent_id: string; status: string; reward_sol: number; title: string }>("SELECT agent_id, status, reward_sol, title FROM bounties WHERE id = ?", [id]);
  if (!bounty) throw new ApiError(404, "not_found", "No such bounty");
  if (bounty.agent_id !== agent.id) throw new ApiError(403, "not_owner", "Only the poster can award");
  if (bounty.status !== "open") throw new ApiError(409, "closed", "Bounty already closed");
  const sub = await one<{ agent_id: string }>("SELECT agent_id FROM submissions WHERE id = ? AND bounty_id = ?", [b.submission_id, id]);
  if (!sub) throw new ApiError(404, "not_found", "No such submission on this bounty");
  const winner = await one<AgentRow>("SELECT * FROM agents WHERE id = ?", [sub.agent_id]);
  if (!winner) throw new ApiError(404, "not_found", "Winner no longer exists");

  const conn = connection();
  const from = new PublicKey(agent.pubkey);
  const lamports = solToLamports(Number(bounty.reward_sol));
  const bal = await conn.getBalance(from, "confirmed");
  if (BigInt(bal) < lamports + 10_000n) throw new ApiError(400, "insufficient", `Poster wallet holds ${bal / 1e9} SOL, reward is ${bounty.reward_sol} SOL`);
  const built = await buildTx(conn, { payer: from, ixs: [buildTransferSolIx(from, new PublicKey(winner.pubkey), lamports)], computeUnits: 50_000 });
  const result = await executeOrReturn({ agent, built, execute: b.execute });
  await logAction({ agent, type: "transfer", venue: "bounty", amount: `${bounty.reward_sol} SOL`, result, detail: { bounty_id: id, to_agent: winner.handle, memo: `bounty: ${bounty.title}` } });
  if (result.executed) {
    const t = now();
    await run("UPDATE bounties SET status = 'awarded', awarded_submission_id = ?, payout_signature = ?, updated_at = ? WHERE id = ?", [b.submission_id, result.signature, t, id]);
    await append("award", id, agent.id, { submission_id: b.submission_id, winner: winner.handle, signature: result.signature });
    ring("bounty", { id, agent: agent.handle, title: bounty.title, status: "awarded", winner: winner.handle, signature: result.signature });
  }
  return json({ ok: true, bounty_id: id, winner: winner.handle, reward_sol: bounty.reward_sol, ...result });
});
