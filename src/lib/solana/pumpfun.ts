/**
 * Pump.fun bonding-curve builders. Mirrors the 222 raw builder: all accounts derived
 * locally, instruction data hand-encoded, no third-party transaction APIs.
 */
import { type AddressLookupTableAccount, type Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, CURVE, DISC, MAYHEM_FEE_RECIPIENT, MAYHEM_GLOBAL_PARAMS, MAYHEM_PROGRAM, MAYHEM_SOL_VAULT,
  NEW_FEE_RECIPIENTS, PUMP_EVENT_AUTHORITY, PUMP_EVENT_AUTHORITY_PDA, PUMP_FEE_CONFIG, PUMP_FEE_PROGRAM, PUMP_FEE_RECIPIENT, PUMP_GLOBAL,
  PUMP_GLOBAL_VOLUME, PUMP_MINT_AUTHORITY, PUMP_PROGRAM, TOKEN_2022_PROGRAM_ID, WSOL_MINT, pickTailFeeIdx,
} from "./constants";

export type BondingCurve = {
  address: PublicKey;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey;
  isMayhem: boolean;
  isCashback: boolean;
  quoteMint: PublicKey | null;
};

export const bondingCurvePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM)[0];
export const bondingCurveV2Pda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve-v2"), mint.toBuffer()], PUMP_PROGRAM)[0];
export const creatorVaultPda = (creator: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creator.toBuffer()], PUMP_PROGRAM)[0];
export const userVolumePda = (user: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), user.toBuffer()], PUMP_PROGRAM)[0];
export const mayhemStatePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("mayhem-state"), mint.toBuffer()], MAYHEM_PROGRAM)[0];

const u64 = (buf: Buffer, off: number) => buf.readBigUInt64LE(off);

export function decodeBondingCurve(address: PublicKey, data: Buffer): BondingCurve {
  // discriminator(8) + 5×u64 + complete(1) + creator(32) + is_mayhem(1) + is_cashback(1) + quote_mint(32)
  const creator = data.length >= 81 ? new PublicKey(data.subarray(49, 81)) : PublicKey.default;
  return {
    address,
    virtualTokenReserves: u64(data, 8),
    virtualSolReserves: u64(data, 16),
    realTokenReserves: u64(data, 24),
    realSolReserves: u64(data, 32),
    tokenTotalSupply: u64(data, 40),
    complete: data[48] === 1,
    creator,
    isMayhem: data.length > 81 ? data[81] === 1 : false,
    isCashback: data.length > 82 ? data[82] === 1 : false,
    quoteMint: data.length >= 115 ? new PublicKey(data.subarray(83, 115)) : null,
  };
}

export async function fetchBondingCurve(conn: Connection, mint: PublicKey): Promise<BondingCurve | null> {
  const pda = bondingCurvePda(mint);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info || !info.owner.equals(PUMP_PROGRAM) || info.data.length < 49) return null;
  return decodeBondingCurve(pda, Buffer.from(info.data));
}

export function isSolQuoted(curve: BondingCurve): boolean {
  return !curve.quoteMint || curve.quoteMint.equals(PublicKey.default) || curve.quoteMint.equals(WSOL_MINT);
}

/** Tokens received (base units, 6 decimals) for `lamports` SOL in. */
export function quoteBuy(curve: Pick<BondingCurve, "virtualSolReserves" | "virtualTokenReserves" | "realTokenReserves">, lamports: bigint, feeBps = CURVE.totalFeeBps): bigint {
  if (lamports <= 0n) return 0n;
  const input = (lamports * 10_000n) / (10_000n + feeBps);
  const out = (input * curve.virtualTokenReserves) / (curve.virtualSolReserves + input);
  return out < curve.realTokenReserves ? out : curve.realTokenReserves;
}

/** Lamports received for `tokens` (base units) sold. */
export function quoteSell(curve: Pick<BondingCurve, "virtualSolReserves" | "virtualTokenReserves">, tokens: bigint, feeBps = CURVE.totalFeeBps): bigint {
  if (tokens <= 0n) return 0n;
  const gross = (tokens * curve.virtualSolReserves) / (curve.virtualTokenReserves + tokens);
  return (gross * (10_000n - feeBps)) / 10_000n;
}

/** Spot price in SOL per whole token. */
export function curvePriceSol(curve: Pick<BondingCurve, "virtualSolReserves" | "virtualTokenReserves">): number {
  if (curve.virtualTokenReserves === 0n) return 0;
  return Number(curve.virtualSolReserves) / 1e9 / (Number(curve.virtualTokenReserves) / 1e6);
}

export function curveProgress(curve: BondingCurve): number {
  // Fraction of the real token reserves already sold (0 → 1 = graduated).
  const initial = Number(CURVE.realTokenReserves);
  return Math.max(0, Math.min(1, 1 - Number(curve.realTokenReserves) / initial));
}

export function freshCurve() {
  return { virtualSolReserves: CURVE.vSolReserves, virtualTokenReserves: CURVE.vTokenReserves, realTokenReserves: CURVE.realTokenReserves };
}

function borshString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

/** create_v2: new Token-2022 mint + bonding curve. Mint and payer both sign. */
export function buildCreateIx(p: { mint: PublicKey; payer: PublicKey; creator?: PublicKey; name: string; symbol: string; uri: string; mayhem?: boolean; cashback?: boolean; holderReward?: boolean }): TransactionInstruction {
  const creator = p.creator ?? p.payer;
  const bondingCurve = bondingCurvePda(p.mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(p.mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);
  const data = Buffer.concat([
    DISC.createV2,
    borshString(p.name),
    borshString(p.symbol),
    borshString(p.uri),
    creator.toBuffer(),
    Buffer.from([p.mayhem ? 1 : 0]),
    Buffer.from([p.cashback ? 1 : 0]), // OptionBool is_cashback_enabled (deprecated; must be false)
    // Trailing optional args (IDL): creator_fee_bps OptionU64 (0 = standard schedule), is_holder_reward OptionBool.
    ...(p.holderReward ? [Buffer.alloc(8), Buffer.from([1])] : []),
  ]);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data,
    keys: [
      { pubkey: p.mint, isSigner: true, isWritable: true },
      { pubkey: PUMP_MINT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MAYHEM_PROGRAM, isSigner: false, isWritable: true },
      { pubkey: MAYHEM_GLOBAL_PARAMS, isSigner: false, isWritable: false },
      { pubkey: MAYHEM_SOL_VAULT, isSigner: false, isWritable: true },
      { pubkey: mayhemStatePda(p.mint), isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(p.mint, MAYHEM_SOL_VAULT, true, TOKEN_2022_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: PUMP_EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/** buy_exact_sol_in on the bonding curve. */
export function buildBuyIxs(p: { user: PublicKey; mint: PublicKey; lamports: bigint; minTokensOut: bigint; creator: PublicKey; tokenProgram: PublicKey; isMayhem?: boolean }): TransactionInstruction[] {
  const bondingCurve = bondingCurvePda(p.mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(p.mint, bondingCurve, true, p.tokenProgram);
  const userAta = getAssociatedTokenAddressSync(p.mint, p.user, false, p.tokenProgram);
  const feeRecipient = p.isMayhem ? MAYHEM_FEE_RECIPIENT : PUMP_FEE_RECIPIENT;
  const data = Buffer.alloc(25);
  DISC.buyExactSolIn.copy(data, 0);
  data.writeBigUInt64LE(p.lamports, 8);
  data.writeBigUInt64LE(p.minTokensOut, 16);
  data[24] = 1; // track_volume
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.user, userAta, p.user, p.mint, p.tokenProgram),
    new TransactionInstruction({
      programId: PUMP_PROGRAM,
      data,
      keys: [
        { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: p.mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: userAta, isSigner: false, isWritable: true },
        { pubkey: p.user, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: p.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: creatorVaultPda(p.creator), isSigner: false, isWritable: true },
        { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: PUMP_GLOBAL_VOLUME, isSigner: false, isWritable: false },
        { pubkey: userVolumePda(p.user), isSigner: false, isWritable: true },
        { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
        { pubkey: PUMP_FEE_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: bondingCurveV2Pda(p.mint), isSigner: false, isWritable: false },
        { pubkey: NEW_FEE_RECIPIENTS[pickTailFeeIdx()], isSigner: false, isWritable: true },
      ],
    }),
  ];
}

/** sell on the bonding curve. */
export function buildSellIxs(p: { user: PublicKey; mint: PublicKey; tokens: bigint; minSolOut: bigint; creator: PublicKey; tokenProgram: PublicKey; isMayhem?: boolean; isCashback?: boolean; closeAccount?: boolean }): TransactionInstruction[] {
  const bondingCurve = bondingCurvePda(p.mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(p.mint, bondingCurve, true, p.tokenProgram);
  const userAta = getAssociatedTokenAddressSync(p.mint, p.user, false, p.tokenProgram);
  const feeRecipient = p.isMayhem ? MAYHEM_FEE_RECIPIENT : PUMP_FEE_RECIPIENT;
  const data = Buffer.alloc(24);
  DISC.sell.copy(data, 0);
  data.writeBigUInt64LE(p.tokens, 8);
  data.writeBigUInt64LE(p.minSolOut, 16);
  const keys = [
    { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: feeRecipient, isSigner: false, isWritable: true },
    { pubkey: p.mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: userAta, isSigner: false, isWritable: true },
    { pubkey: p.user, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: creatorVaultPda(p.creator), isSigner: false, isWritable: true },
    { pubkey: p.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_PROGRAM, isSigner: false, isWritable: false },
  ];
  if (p.isCashback) keys.push({ pubkey: userVolumePda(p.user), isSigner: false, isWritable: true });
  keys.push({ pubkey: bondingCurveV2Pda(p.mint), isSigner: false, isWritable: false });
  keys.push({ pubkey: NEW_FEE_RECIPIENTS[pickTailFeeIdx()], isSigner: false, isWritable: true });
  const ixs = [new TransactionInstruction({ programId: PUMP_PROGRAM, data, keys })];
  if (p.closeAccount) ixs.push(createCloseAccountInstruction(userAta, p.user, p.user, [], p.tokenProgram));
  return ixs;
}

/** Pump.fun's public address lookup tables (same ones 222 uses). Shrinks create/buy/sell txs well under 1232 bytes. */
const PUMP_ALTS = ["beaaXjkvwyQ8cC9G7aExy81ygAZgc7vdrB7oif8poL2", "7mFD2mUtRS65XstiSAvCJuYmdesZoQwCwRJhq1p3eRMe"].map((k) => new PublicKey(k));
let altCache: { at: number; tables: AddressLookupTableAccount[] } | null = null;
export async function getPumpLookupTables(conn: Connection): Promise<AddressLookupTableAccount[]> {
  if (altCache && Date.now() - altCache.at < 10 * 60_000) return altCache.tables;
  const tables: AddressLookupTableAccount[] = [];
  for (const addr of PUMP_ALTS) {
    try {
      const res = await conn.getAddressLookupTable(addr);
      if (res.value) tables.push(res.value);
    } catch {}
  }
  altCache = { at: Date.now(), tables };
  return tables;
}
