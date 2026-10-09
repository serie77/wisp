/**
 * Single-creator fee claims: the creator of a coin keeps 100% of its pump.fun creator fee.
 * Fees wait in up to four places (pump-public-docs SWEEP_FEES.md + COLLECT_CREATOR_FEE.md):
 *   curve:  BondingCurve.creator_fee (v3 trades) → sweep_creator_fee → creator vault → collect_creator_fee_v2 → creator
 *   pool:   Pool.creator_fees (v2 AMM trades)    → sweep_creator_fee → coin-creator vault ATA → collect_coin_creator_fee → creator
 * Not for coins with a sharing config (their fees go through distribute_creator_fees_v2 instead).
 */
import { type Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ASSOCIATED_TOKEN_PROGRAM_ID, PUMP_EVENT_AUTHORITY_PDA, PUMP_PROGRAM, PUMPSWAP_EVENT_AUTHORITY, PUMPSWAP_PROGRAM, TOKEN_PROGRAM_ID, WSOL_MINT } from "./constants";
import { buildPoolSweepCreatorFeeIx, buildSweepCreatorFeeIx } from "./feeshare";
import { bondingCurvePda, creatorVaultPda, decodeBondingCurve, isSolQuoted } from "./pumpfun";
import { canonicalPoolPda, coinCreatorVaultPda, fetchPool } from "./pumpswap";

const COLLECT_CREATOR_FEE_V2 = Buffer.from([207, 17, 138, 242, 4, 34, 19, 56]);
const COLLECT_COIN_CREATOR_FEE = Buffer.from([160, 57, 89, 42, 181, 139, 43, 66]);
/** Rent-exempt minimum for a 0-byte account: collect leaves this in the creator vault. */
const VAULT_RENT = 890_880n;
/** Sweeps per transaction (each adds ~3 unique accounts; keeps us well under 1232 bytes). */
export const MAX_SWEEPS_PER_TX = 6;

/** Pump `collect_creator_fee_v2` for a SOL-quoted creator vault: lamports vault → creator. Permissionless. */
export function buildCollectCreatorFeeV2Ix(creator: PublicKey): TransactionInstruction {
  const vault = creatorVaultPda(creator);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data: COLLECT_CREATOR_FEE_V2,
    keys: [
      { pubkey: creator, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, creator, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, vault, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/** PumpSwap `collect_coin_creator_fee`: WSOL from the coin-creator vault ATA into the creator's WSOL ATA (must exist). */
export function buildCollectCoinCreatorFeeIx(creator: PublicKey): TransactionInstruction {
  const authority = coinCreatorVaultPda(creator);
  return new TransactionInstruction({
    programId: PUMPSWAP_PROGRAM,
    data: COLLECT_COIN_CREATOR_FEE,
    keys: [
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: creator, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, authority, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, creator, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

export type CoinFees = { mint: string; graduated: boolean; on_curve: bigint; on_pool: bigint; pool?: { address: PublicKey; quote: PublicKey } };
export type CreatorFees = {
  creator: PublicKey;
  /** Already in the pump creator vault (above rent). Covers every coin this wallet created, anywhere. */
  curveVault: bigint;
  /** Already in the PumpSwap coin-creator vault ATA. */
  ammVault: bigint;
  ammVaultExists: boolean;
  coins: CoinFees[];
  total: bigint;
};

/** Everything `creator` can claim right now across `mints` (coins whose curve/pool names it as creator). */
export async function getCreatorFees(conn: Connection, creator: PublicKey, mints: PublicKey[]): Promise<CreatorFees> {
  const vault = creatorVaultPda(creator);
  const ammAta = getAssociatedTokenAddressSync(WSOL_MINT, coinCreatorVaultPda(creator), true, TOKEN_PROGRAM_ID);
  const [vaultInfo, ammInfo] = await conn.getMultipleAccountsInfo([vault, ammAta], "confirmed");
  const curveVault = vaultInfo && vaultInfo.lamports > VAULT_RENT ? BigInt(vaultInfo.lamports) - VAULT_RENT : 0n;
  const ammVault = ammInfo && ammInfo.data.length >= 72 ? Buffer.from(ammInfo.data).readBigUInt64LE(64) : 0n;

  const coins: CoinFees[] = [];
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk.map(bondingCurvePda), "confirmed");
    for (let k = 0; k < chunk.length; k++) {
      const info = infos[k];
      if (!info || !info.owner.equals(PUMP_PROGRAM)) continue;
      const curve = decodeBondingCurve(bondingCurvePda(chunk[k]), Buffer.from(info.data));
      if (!isSolQuoted(curve)) continue; // sweeps here pass WSOL as the quote mint
      const mine = curve.creator.equals(creator);
      const c: CoinFees = { mint: chunk[k].toBase58(), graduated: curve.complete, on_curve: mine ? curve.creatorFeeWaiting : 0n, on_pool: 0n };
      if (curve.complete) {
        const pool = await fetchPool(conn, canonicalPoolPda(chunk[k])).catch(() => null);
        if (pool && pool.coinCreator.equals(creator) && pool.quoteMint.equals(WSOL_MINT)) { c.on_pool = pool.creatorFeesWaiting; c.pool = { address: pool.address, quote: pool.poolQuoteTokenAccount }; }
      }
      if (mine || c.pool) coins.push(c);
    }
  }
  const total = curveVault + ammVault + coins.reduce((s, c) => s + c.on_curve + c.on_pool, 0n);
  return { creator, curveVault, ammVault, ammVaultExists: !!ammInfo, coins, total };
}

/**
 * Instructions that pay everything waiting to `creator` as SOL: sweep the largest parked buckets
 * (up to MAX_SWEEPS_PER_TX), then collect both vaults. The AMM side arrives as WSOL and is unwrapped.
 * `creator` must sign when it holds AMM fees (it closes its own WSOL account).
 */
export function buildClaimIxs(payer: PublicKey, f: CreatorFees): { ixs: TransactionInstruction[]; sweeps: number; remaining: number; lamports: bigint } {
  const buckets = f.coins.flatMap((c) => [
    ...(c.on_curve > 0n ? [{ kind: "curve" as const, c, amount: c.on_curve }] : []),
    ...(c.on_pool > 0n && c.pool ? [{ kind: "pool" as const, c, amount: c.on_pool }] : []),
  ]).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const take = buckets.slice(0, MAX_SWEEPS_PER_TX);
  const ixs: TransactionInstruction[] = [];
  for (const b of take) {
    const mint = new PublicKey(b.c.mint);
    if (b.kind === "curve") ixs.push(buildSweepCreatorFeeIx({ payer, mint, creator: f.creator }));
    else ixs.push(buildPoolSweepCreatorFeeIx({ payer, pool: b.c.pool!.address, poolQuoteTokenAccount: b.c.pool!.quote, coinCreator: f.creator }));
  }
  const curveSide = f.curveVault + take.filter((b) => b.kind === "curve").reduce((s, b) => s + b.amount, 0n);
  const poolSide = f.ammVault + take.filter((b) => b.kind === "pool").reduce((s, b) => s + b.amount, 0n);
  if (curveSide > 0n) ixs.push(buildCollectCreatorFeeV2Ix(f.creator));
  if (poolSide > 0n) {
    const ata = getAssociatedTokenAddressSync(WSOL_MINT, f.creator, true, TOKEN_PROGRAM_ID);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(payer, ata, f.creator, WSOL_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      buildCollectCoinCreatorFeeIx(f.creator),
      createCloseAccountInstruction(ata, f.creator, f.creator, [], TOKEN_PROGRAM_ID),
    );
  }
  return { ixs, sweeps: take.length, remaining: buckets.length - take.length, lamports: curveSide + poolSide };
}
