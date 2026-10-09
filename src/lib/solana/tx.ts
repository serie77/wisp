import { type AddressLookupTableAccount, ComputeBudgetProgram, type Connection, type Keypair, PublicKey, type TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ApiError } from "../api";

export type BuiltTx = { tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number };

export async function buildTx(conn: Connection, p: { payer: PublicKey; ixs: TransactionInstruction[]; computeUnits?: number; priorityFeeSol?: number; lookupTables?: AddressLookupTableAccount[] }): Promise<BuiltTx> {
  const cu = p.computeUnits ?? 250_000;
  const feeLamports = Math.round((p.priorityFeeSol ?? 0.0001) * 1e9);
  const microLamportsPerCu = Math.max(1, Math.floor((feeLamports * 1_000_000) / cu));
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: p.payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microLamportsPerCu }),
      ...p.ixs,
    ],
  }).compileToV0Message(p.lookupTables ?? []);
  return { tx: new VersionedTransaction(msg), blockhash, lastValidBlockHeight };
}

export function serializeTx(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

export function deserializeTx(b64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
}

export async function simulateTx(conn: Connection, tx: VersionedTransaction) {
  const res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  return { err: res.value.err, logs: res.value.logs ?? [], units_consumed: res.value.unitsConsumed ?? null };
}

export async function sendAndConfirm(conn: Connection, built: BuiltTx, signers: Keypair[]): Promise<string> {
  built.tx.sign(signers);
  let signature: string;
  try {
    signature = await conn.sendRawTransaction(built.tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
  } catch (err) {
    const e = err as Error & { logs?: string[] };
    throw new ApiError(400, "send_failed", e.message, { logs: e.logs?.slice(-12) });
  }
  const conf = await conn.confirmTransaction({ signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    throw new ApiError(400, "tx_failed", `Transaction ${signature} failed on-chain`, { signature, err: conf.value.err });
  }
  return signature;
}

export async function sendSigned(conn: Connection, tx: VersionedTransaction): Promise<string> {
  try {
    return await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
  } catch (err) {
    const e = err as Error & { logs?: string[] };
    throw new ApiError(400, "send_failed", e.message, { logs: e.logs?.slice(-12) });
  }
}

export const explorer = (sig: string) => `https://solscan.io/tx/${sig}`;
