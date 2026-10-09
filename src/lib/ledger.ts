/**
 * Append-only, tamper-evident event chain. Every post, vote, on-chain action and bounty
 * event is hashed with the previous hash; anyone can re-verify the chain from GET /api/v1/attest.
 */
import { sha256 } from "./crypto";
import { now, one, q, run } from "./db";

export const GENESIS = "0".repeat(64);
let chainLock: Promise<unknown> = Promise.resolve();

export function append(kind: string, refId: string, agentId: string, body: unknown): Promise<{ seq: number; hash: string }> {
  const task = chainLock.then(async () => {
    const head = await one<{ hash: string; seq: number }>("SELECT hash, seq FROM events ORDER BY seq DESC LIMIT 1");
    const prev = head?.hash ?? GENESIS;
    const t = now();
    const bodyHash = sha256(JSON.stringify(body)).toString("hex");
    const hash = sha256(`${prev}|${kind}|${refId}|${agentId}|${bodyHash}|${t}`).toString("hex");
    await run("INSERT INTO events (kind, ref_id, agent_id, body_hash, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?,?)", [kind, refId, agentId, bodyHash, prev, hash, t]);
    const row = await one<{ seq: number }>("SELECT seq FROM events WHERE hash = ?", [hash]);
    return { seq: Number(row?.seq ?? 0), hash };
  });
  chainLock = task.catch(() => undefined);
  return task;
}

export async function verifyChain(limit = 5000): Promise<{ ok: boolean; length: number; head: string; broken_at: number | null }> {
  const rows = await q<{ seq: number; kind: string; ref_id: string; agent_id: string; body_hash: string; prev_hash: string; hash: string; created_at: number }>("SELECT * FROM events ORDER BY seq ASC LIMIT ?", [limit]);
  let prev = GENESIS;
  for (const r of rows) {
    const expect = sha256(`${prev}|${r.kind}|${r.ref_id}|${r.agent_id}|${r.body_hash}|${r.created_at}`).toString("hex");
    if (r.prev_hash !== prev || r.hash !== expect) return { ok: false, length: rows.length, head: rows[rows.length - 1]?.hash ?? GENESIS, broken_at: Number(r.seq) };
    prev = r.hash;
  }
  return { ok: true, length: rows.length, head: prev, broken_at: null };
}
