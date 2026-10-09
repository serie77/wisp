import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ApiError, type AgentRow } from "./api";
import { decryptSecret, newId } from "./crypto";
import { now, run } from "./db";
import { connection } from "./solana/connection";
import { type BuiltTx, explorer, sendAndConfirm, serializeTx } from "./solana/tx";
import { append } from "./ledger";
import { ring } from "./doorbell";

export function agentKeypair(agent: AgentRow): Keypair | null {
  if (agent.custody !== "wisp" || !agent.secret_enc) return null;
  return Keypair.fromSecretKey(decryptSecret(agent.secret_enc));
}

export function parsePubkey(s: string, what = "address"): PublicKey {
  try {
    return new PublicKey(s);
  } catch {
    throw new ApiError(400, "invalid_pubkey", `${what} is not a valid Solana public key`);
  }
}

export type ExecResult =
  | { executed: true; signature: string; explorer: string }
  | { executed: false; transaction: string; blockhash: string; last_valid_block_height: number; signers: string[]; note: string };

/**
 * Either signs + sends with the agent's wisp-custodied key, or returns the unsigned
 * base64 transaction for self-custody agents (or when execute=false).
 */
export async function executeOrReturn(p: { agent: AgentRow; built: BuiltTx; extraSigners?: Keypair[]; execute: boolean }): Promise<ExecResult> {
  const kp = agentKeypair(p.agent);
  if (p.execute && kp) {
    const signature = await sendAndConfirm(connection(), p.built, [kp, ...(p.extraSigners ?? [])]);
    return { executed: true, signature, explorer: explorer(signature) };
  }
  // Partially sign with any ephemeral signers (e.g. a new mint keypair) so the agent only adds its own signature.
  if (p.extraSigners?.length) p.built.tx.sign(p.extraSigners);
  return {
    executed: false,
    transaction: serializeTx(p.built.tx),
    blockhash: p.built.blockhash,
    last_valid_block_height: p.built.lastValidBlockHeight,
    signers: [p.agent.pubkey],
    note: kp ? "execute=false: sign with your wallet and POST /api/v1/tx/submit" : "Self-custody agent: sign with your wallet and POST /api/v1/tx/submit",
  };
}

export async function logAction(p: { agent: AgentRow; type: "deploy" | "buy" | "sell" | "burn" | "transfer" | "swap" | "claim"; mint?: string | null; venue?: string | null; amount?: string | null; result: ExecResult; detail?: Record<string, unknown> }) {
  const id = newId("act");
  await run("INSERT INTO actions (id, agent_id, type, mint, venue, amount, signature, status, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [
    id,
    p.agent.id,
    p.type,
    p.mint ?? null,
    p.venue ?? null,
    p.amount ?? null,
    p.result.executed ? p.result.signature : null,
    p.result.executed ? "confirmed" : "built",
    JSON.stringify(p.detail ?? {}),
    now(),
  ]);
  if (p.result.executed) {
    await append(p.type, id, p.agent.id, { mint: p.mint ?? null, venue: p.venue ?? null, amount: p.amount ?? null, signature: p.result.signature });
    ring("action", { id, type: p.type, agent: p.agent.handle, mint: p.mint ?? null, venue: p.venue ?? null, amount: p.amount ?? null, signature: p.result.signature });
  }
  return id;
}

export function secretToBase58(kp: Keypair): string {
  return bs58.encode(kp.secretKey);
}
