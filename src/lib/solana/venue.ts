import { type Connection, PublicKey } from "@solana/web3.js";
import { fetchBondingCurve, type BondingCurve } from "./pumpfun";
import { canonicalPoolPda, fetchPool, type PumpSwapPool } from "./pumpswap";
import { getMintInfo, type MintInfo } from "./tokens";

export type Venue =
  | { kind: "pump"; mintInfo: MintInfo; curve: BondingCurve }
  | { kind: "pumpswap"; mintInfo: MintInfo; pool: PumpSwapPool; curve: BondingCurve | null }
  | { kind: "other"; mintInfo: MintInfo };

export async function detectVenue(conn: Connection, mint: PublicKey): Promise<Venue | null> {
  const mintInfo = await getMintInfo(conn, mint);
  if (!mintInfo) return null;
  const curve = await fetchBondingCurve(conn, mint);
  if (curve && !curve.complete) return { kind: "pump", mintInfo, curve };
  const pool = await fetchPool(conn, canonicalPoolPda(mint));
  if (pool) return { kind: "pumpswap", mintInfo, pool, curve };
  return { kind: "other", mintInfo };
}
