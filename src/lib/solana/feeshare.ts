/**
 * Pump.fun creator-fee sharing (Pump Fees program). A coin deployed through Wisp opts into
 * shared distribution: the creator keeps most of the creator fee, the Wisp treasury takes a
 * slice, and anyone can sweep + distribute accrued fees permissionlessly.
 * Layouts from pump-public-docs/docs/instructions/CREATOR_FEE_SHARING.md.
 */
import { type Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ASSOCIATED_TOKEN_PROGRAM_ID, PUMP_EVENT_AUTHORITY_PDA, PUMP_GLOBAL, PUMP_PROGRAM, PUMPSWAP_EVENT_AUTHORITY, PUMPSWAP_PROGRAM, TOKEN_PROGRAM_ID, WSOL_MINT } from "./constants";
import { bondingCurvePda, creatorVaultPda } from "./pumpfun";
import { coinCreatorVaultPda } from "./pumpswap";

export const PUMP_FEES_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const FEES_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_FEES_PROGRAM)[0];
export const sharingConfigPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM)[0];

const DISC = {
  createFeeSharingConfig: Buffer.from([195, 78, 86, 76, 111, 52, 251, 213]),
  updateFeeSharesV2: Buffer.from([111, 251, 49, 6, 78, 78, 106, 18]),
  transferCreatorFeesToPumpV2: Buffer.from([1, 33, 78, 185, 33, 67, 44, 92]),
  distributeCreatorFeesV2: Buffer.from([255, 203, 19, 79, 244, 68, 8, 159]),
};

export type Shareholder = { address: PublicKey; shareBps: number };

/** Opt a coin into shared distribution. Payer must be the coin creator. `pool` only for graduated coins. */
export function buildCreateFeeSharingConfigIx(p: { creator: PublicKey; mint: PublicKey; pool?: PublicKey }): TransactionInstruction {
  const keys = [
    { pubkey: FEES_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEES_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: p.creator, isSigner: true, isWritable: true },
    { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: p.mint, isSigner: false, isWritable: false },
    { pubkey: sharingConfigPda(p.mint), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: bondingCurvePda(p.mint), isSigner: false, isWritable: true },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
  ];
  // Anchor optional accounts: when the coin has not graduated, pass the program id as the placeholder.
  if (p.pool) keys.push({ pubkey: p.pool, isSigner: false, isWritable: true }, { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false }, { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false });
  else keys.push({ pubkey: PUMP_FEES_PROGRAM, isSigner: false, isWritable: false }, { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false }, { pubkey: PUMP_FEES_PROGRAM, isSigner: false, isWritable: false });
  return new TransactionInstruction({ programId: PUMP_FEES_PROGRAM, keys, data: DISC.createFeeSharingConfig });
}

/** Set the final shareholder list (once). Authority = current creator. SOL-quoted coins only. */
export function buildUpdateFeeSharesV2Ix(p: { authority: PublicKey; mint: PublicKey; currentShareholders: PublicKey[]; shareholders: Shareholder[] }): TransactionInstruction {
  const total = p.shareholders.reduce((s, x) => s + x.shareBps, 0);
  if (total !== 10_000 || p.shareholders.length === 0 || p.shareholders.length > 10) throw new Error("shareholders must sum to 10000 bps (1–10 entries)");
  const cfg = sharingConfigPda(p.mint);
  const pumpCreatorVault = creatorVaultPda(cfg);
  const ammVaultAuthority = coinCreatorVaultPda(cfg);
  const body = Buffer.alloc(4 + p.shareholders.length * 34);
  body.writeUInt32LE(p.shareholders.length, 0);
  p.shareholders.forEach((s, i) => { s.address.toBuffer().copy(body, 4 + i * 34); body.writeUInt16LE(s.shareBps, 4 + i * 34 + 32); });
  const keys = [
    { pubkey: FEES_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEES_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: p.authority, isSigner: true, isWritable: true },
    { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: p.mint, isSigner: false, isWritable: false },
    { pubkey: cfg, isSigner: false, isWritable: true },
    { pubkey: bondingCurvePda(p.mint), isSigner: false, isWritable: false },
    { pubkey: pumpCreatorVault, isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, pumpCreatorVault, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ammVaultAuthority, isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, ammVaultAuthority, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
    ...p.currentShareholders.map((s) => ({ pubkey: s, isSigner: false, isWritable: true })),
  ];
  return new TransactionInstruction({ programId: PUMP_FEES_PROGRAM, keys, data: Buffer.concat([DISC.updateFeeSharesV2, body]) });
}

/** Permissionless: move AMM-side creator fees (graduated coins) into the pump creator vault. */
export function buildTransferCreatorFeesToPumpV2Ix(p: { payer: PublicKey; mint: PublicKey }): TransactionInstruction {
  const cfg = sharingConfigPda(p.mint);
  const ammVaultAuthority = coinCreatorVaultPda(cfg);
  const pumpCreatorVault = creatorVaultPda(cfg);
  return new TransactionInstruction({
    programId: PUMPSWAP_PROGRAM,
    data: DISC.transferCreatorFeesToPumpV2,
    keys: [
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: cfg, isSigner: false, isWritable: false },
      { pubkey: ammVaultAuthority, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, ammVaultAuthority, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: pumpCreatorVault, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, pumpCreatorVault, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/** Permissionless: pay the pump creator vault out to every shareholder (SOL-quoted). */
export function buildDistributeCreatorFeesV2Ix(p: { payer: PublicKey; mint: PublicKey; shareholders: PublicKey[] }): TransactionInstruction {
  const cfg = sharingConfigPda(p.mint);
  const vault = creatorVaultPda(cfg);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data: Buffer.concat([DISC.distributeCreatorFeesV2, Buffer.from([0])]),
    keys: [
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: bondingCurvePda(p.mint), isSigner: false, isWritable: true },
      { pubkey: cfg, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, vault, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...p.shareholders.map((s) => ({ pubkey: s, isSigner: false, isWritable: true })),
    ],
  });
}

export type SharingConfig = { address: PublicKey; admin: PublicKey; adminRevoked: boolean; shareholders: Shareholder[] };

/** Decode the on-chain SharingConfig (pump_fees IDL): disc(8) bump(1) version(1) status(1) mint(32) admin(32) admin_revoked(1) shareholders Vec<{pubkey,u16}>. */
export async function fetchSharingConfig(conn: Connection, mint: PublicKey): Promise<SharingConfig | null> {
  const address = sharingConfigPda(mint);
  const info = await conn.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(PUMP_FEES_PROGRAM) || info.data.length < 80) return null;
  const d = Buffer.from(info.data);
  const n = d.readUInt32LE(76);
  if (n < 1 || n > 10 || 80 + n * 34 > d.length) return null;
  const shareholders: Shareholder[] = [];
  for (let i = 0; i < n; i++) shareholders.push({ address: new PublicKey(d.subarray(80 + i * 34, 112 + i * 34)), shareBps: d.readUInt16LE(112 + i * 34) });
  return { address, admin: new PublicKey(d.subarray(43, 75)), adminRevoked: d[75] === 1, shareholders };
}
