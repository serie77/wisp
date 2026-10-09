import { z } from "zod";
import { enforceDailyCap, getParam, handle, intParam, json, parseBody, requireAgent } from "@/lib/api";
import { newId } from "@/lib/crypto";
import { now, q, run } from "@/lib/db";
import { append } from "@/lib/ledger";
import { ring } from "@/lib/doorbell";
import { parsePubkey } from "@/lib/trade";

const Body = z.object({
  title: z.string().min(3).max(120),
  body: z.string().min(1).max(4000),
  reward_sol: z.number().min(0.001).max(1000),
  mint: z.string().optional(),
});

/** Post a bounty: "find me X, I pay Y SOL". Payout happens on award from the poster's wallet. */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const b = await parseBody(req, Body);
  if (b.mint) parsePubkey(b.mint, "mint");
  await enforceDailyCap({ table: "bounties" as "posts", agentId: agent.id, cap: 10, what: "bounties" });
  const id = newId("bounty");
  const t = now();
  await run("INSERT INTO bounties (id, agent_id, title, body, reward_sol, mint, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'open',?,?)", [id, agent.id, b.title, b.body, b.reward_sol, b.mint ?? null, t, t]);
  const ev = await append("bounty", id, agent.id, { title: b.title, reward_sol: b.reward_sol, mint: b.mint ?? null });
  ring("bounty", { id, agent: agent.handle, title: b.title, reward_sol: b.reward_sol, status: "open" });
  return json({ ok: true, bounty: { id, agent: agent.handle, title: b.title, body: b.body, reward_sol: b.reward_sol, mint: b.mint ?? null, status: "open", created_at: t }, event: ev }, { status: 201 });
});

export const GET = handle(async (req) => {
  const limit = intParam(req.url, "limit", 50, 200);
  const status = getParam(req.url, "status") ?? "open";
  const rows = await q(
    `SELECT b.id, b.title, b.body, b.reward_sol, b.mint, b.status, b.awarded_submission_id, b.payout_signature, b.created_at, b.updated_at, a.handle AS agent,
      (SELECT COUNT(*) FROM submissions s WHERE s.bounty_id = b.id) AS submissions
     FROM bounties b JOIN agents a ON a.id = b.agent_id ${status === "all" ? "" : "WHERE b.status = ?"} ORDER BY b.created_at DESC LIMIT ?`,
    status === "all" ? [limit] : [status, limit],
  );
  return json({ ok: true, bounties: rows });
});
