import { type Connection, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createBurnInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants";

export type MintInfo = { mint: PublicKey; tokenProgram: PublicKey; decimals: number; supply: bigint; isToken2022: boolean };

export async function getMintInfo(conn: Connection, mint: PublicKey): Promise<MintInfo | null> {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) return null;
  const isToken2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!isToken2022 && !info.owner.equals(TOKEN_PROGRAM_ID)) return null;
  if (info.data.length < 82) return null;
  const d = Buffer.from(info.data);
  return { mint, tokenProgram: info.owner, decimals: d[44], supply: d.readBigUInt64LE(36), isToken2022 };
}

export async function getTokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): Promise<{ amount: bigint; decimals: number; ata: PublicKey }> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  try {
    const bal = await conn.getTokenAccountBalance(ata, "confirmed");
    return { amount: BigInt(bal.value.amount), decimals: bal.value.decimals, ata };
  } catch {
    return { amount: 0n, decimals: 0, ata };
  }
}

export type Holding = { mint: string; amount: string; decimals: number; ui_amount: number; token_program: string };

export async function getHoldings(conn: Connection, owner: PublicKey): Promise<Holding[]> {
  const out: Holding[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const { account } of res.value) {
      const parsed = (account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmount: number | null } } } }).parsed;
      const t = parsed.info.tokenAmount;
      if (t.amount === "0") continue;
      out.push({ mint: parsed.info.mint, amount: t.amount, decimals: t.decimals, ui_amount: t.uiAmount ?? 0, token_program: programId.toBase58() });
    }
  }
  return out;
}

export function buildBurnIxs(p: { owner: PublicKey; mint: PublicKey; amount: bigint; tokenProgram: PublicKey; closeAfter?: boolean }): TransactionInstruction[] {
  const ata = getAssociatedTokenAddressSync(p.mint, p.owner, false, p.tokenProgram);
  const ixs = [createBurnInstruction(ata, p.mint, p.owner, p.amount, [], p.tokenProgram)];
  if (p.closeAfter) ixs.push(createCloseAccountInstruction(ata, p.owner, p.owner, [], p.tokenProgram));
  return ixs;
}

export function buildTransferSolIx(from: PublicKey, to: PublicKey, lamports: bigint): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
}

export function buildTransferTokenIxs(p: { from: PublicKey; to: PublicKey; mint: PublicKey; amount: bigint; decimals: number; tokenProgram: PublicKey }): TransactionInstruction[] {
  const fromAta = getAssociatedTokenAddressSync(p.mint, p.from, false, p.tokenProgram);
  const toAta = getAssociatedTokenAddressSync(p.mint, p.to, true, p.tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.from, toAta, p.to, p.mint, p.tokenProgram),
    createTransferCheckedInstruction(fromAta, p.mint, toAta, p.from, p.amount, p.decimals, [], p.tokenProgram),
  ];
}

export function toBaseUnits(ui: number | string, decimals: number): bigint {
  const s = typeof ui === "number" ? ui.toFixed(decimals) : ui;
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function fromBaseUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1e9));
}
