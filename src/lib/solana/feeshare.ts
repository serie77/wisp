/**
 * Pump.fun creator-fee sharing (Pump Fees program): sweep + distribute for coins whose creator
 * fee is split by a sharing config. The treasury uses this when the Wisp token shares its fees
 * with the treasury wallet. Agents' own coins don't share; see creatorfee.ts for their claims.
 * Layouts from pump-public-docs/docs/instructions/CREATOR_FEE_SHARING.md.
 */
import { type Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ASSOCIATED_TOKEN_PROGRAM_ID, PUMP_EVENT_AUTHORITY_PDA, PUMP_GLOBAL, PUMP_PROGRAM, PUMPSWAP_EVENT_AUTHORITY, PUMPSWAP_GLOBAL_CONFIG, PUMPSWAP_PROGRAM, TOKEN_PROGRAM_ID, WSOL_MINT } from "./constants";
import { bondingCurvePda, creatorVaultPda } from "./pumpfun";
import { coinCreatorVaultPda } from "./pumpswap";

export const PUMP_FEES_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const FEES_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_FEES_PROGRAM)[0];
export const sharingConfigPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM)[0];

const DISC = {
  transferCreatorFeesToPumpV2: Buffer.from([1, 33, 78, 185, 33, 67, 44, 92]),
  distributeCreatorFeesV2: Buffer.from([255, 203, 19, 79, 244, 68, 8, 159]),
  sweepCreatorFee: Buffer.from([32, 246, 191, 52, 8, 201, 73, 186]),
};

/**
 * Pump `sweep_creator_fee`: v2/v3 trades park the creator fee on the bonding curve; this pays it into the
 * creator vault of bonding_curve.creator (the sharing-config PDA for fee-shared coins). Permissionless.
 * It must come BEFORE distribute_creator_fees_v2 in the same transaction.
 */
export function buildSweepCreatorFeeIx(p: { payer: PublicKey; mint: PublicKey; creator: PublicKey }): TransactionInstruction {
  const curve = bondingCurvePda(p.mint);
  const recipient = creatorVaultPda(p.creator);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data: DISC.sweepCreatorFee,
    keys: [
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, curve, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, recipient, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: PUMP_EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/** PumpSwap `sweep_creator_fee` for graduated coins: pays Pool.creator_fees into the coin-creator vault. Before transfer_creator_fees_to_pump_v2. */
export function buildPoolSweepCreatorFeeIx(p: { payer: PublicKey; pool: PublicKey; poolQuoteTokenAccount: PublicKey; coinCreator: PublicKey }): TransactionInstruction {
  const recipient = coinCreatorVaultPda(p.coinCreator);
  return new TransactionInstruction({
    programId: PUMPSWAP_PROGRAM,
    data: DISC.sweepCreatorFee,
    keys: [
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: PUMPSWAP_GLOBAL_CONFIG, isSigner: false, isWritable: false },
      { pubkey: p.pool, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: p.poolQuoteTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(WSOL_MINT, recipient, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

export type Shareholder = { address: PublicKey; shareBps: number };

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
