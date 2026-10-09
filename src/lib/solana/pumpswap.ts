/** PumpSwap AMM builders for graduated pump.fun coins (mirrors 222's Rust pumpswap.rs). */
import { type Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, DISC, NEW_FEE_RECIPIENTS, NEW_FEE_RECIPIENT_WSOL_ATAS, PUMP_FEE_PROGRAM, PUMP_PROGRAM, PUMPSWAP_EVENT_AUTHORITY,
  PUMPSWAP_FEE_CONFIG, PUMPSWAP_GLOBAL_CONFIG, PUMPSWAP_GLOBAL_VOLUME, PUMPSWAP_PROGRAM, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT,
  pickPumpswapFeeRecipient, pickTailFeeIdx,
} from "./constants";

export type PumpSwapPool = {
  address: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  coinCreator: PublicKey;
  isMayhem: boolean;
  isCashback: boolean;
  isHolderReward: boolean;
  /** Signed; appended Sept 2026. Pools older than the field read as 0. */
  virtualQuoteReserves: bigint;
  /** Pool.creator_fees: creator fee kept in the quote vault by buy_v2/sell_v2 until sweep_creator_fee. */
  creatorFeesWaiting: bigint;
  /** Raw pool_base_token_account.amount */
  baseReserve: bigint;
  /** Effective quote reserves = pool_quote_token_account.amount + virtualQuoteReserves (pricing basis) */
  quoteReserve: bigint;
  rawQuoteReserve: bigint;
  config: PumpSwapConfig;
  feeBps: bigint;
};

/** GlobalConfig (on-chain): fee rates + the 8 protocol fee recipients the program accepts. Cached 10 min. */
export type PumpSwapConfig = { lpFeeBps: bigint; protocolFeeBps: bigint; creatorFeeBps: bigint; protocolFeeRecipients: PublicKey[] };
let cfgCache: { at: number; cfg: PumpSwapConfig } | null = null;
export async function getPumpSwapConfig(conn: Connection): Promise<PumpSwapConfig> {
  if (cfgCache && Date.now() - cfgCache.at < 10 * 60_000) return cfgCache.cfg;
  const info = await conn.getAccountInfo(PUMPSWAP_GLOBAL_CONFIG, "confirmed");
  if (!info) throw new Error("PumpSwap GlobalConfig not found");
  const d = Buffer.from(info.data);
  // disc(8) admin(32) lp_fee(u64)@40 protocol_fee(u64)@48 disable_flags(u8)@56 protocol_fee_recipients[8]@57 coin_creator_fee(u64)@313
  // admin_set_coin_creator_authority(32)@321 whitelist_pda(32)@353 reserved_fee_recipient(32)@385 mayhem_mode_enabled(1)@417
  // (later fields: reserved/buyback recipients, buyback_basis_points — not needed for trading)
  const recipients: PublicKey[] = [];
  for (let i = 0; i < 8; i++) recipients.push(new PublicKey(d.subarray(57 + i * 32, 89 + i * 32)));
  const cfg: PumpSwapConfig = {
    lpFeeBps: d.readBigUInt64LE(40),
    protocolFeeBps: d.readBigUInt64LE(48),
    creatorFeeBps: d.length >= 321 ? d.readBigUInt64LE(313) : 0n,
    protocolFeeRecipients: recipients.filter((r) => !r.equals(PublicKey.default)),
  };
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}

/** Fallback total fee estimate when the config is unavailable. */
export const PUMPSWAP_FEE_BPS = 125n;

export const pumpPoolAuthorityPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("pool-authority"), mint.toBuffer()], PUMP_PROGRAM)[0];
export function canonicalPoolPda(mint: PublicKey): PublicKey {
  const idx = Buffer.alloc(2);
  idx.writeUInt16LE(0, 0);
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), idx, pumpPoolAuthorityPda(mint).toBuffer(), mint.toBuffer(), WSOL_MINT.toBuffer()], PUMPSWAP_PROGRAM)[0];
}
export const poolV2Pda = (baseMint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("pool-v2"), baseMint.toBuffer()], PUMPSWAP_PROGRAM)[0];
export const coinCreatorVaultPda = (creator: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), creator.toBuffer()], PUMPSWAP_PROGRAM)[0];
export const userVolumePda = (user: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), user.toBuffer()], PUMPSWAP_PROGRAM)[0];

export async function fetchPool(conn: Connection, address: PublicKey): Promise<PumpSwapPool | null> {
  const info = await conn.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(PUMPSWAP_PROGRAM) || info.data.length < 245) return null;
  const d = Buffer.from(info.data);
  // disc(8) bump(1) index(2) creator(32) base_mint(32) quote_mint(32) lp_mint(32) pool_base(32) pool_quote(32) lp_supply(8)
  // coin_creator(32) is_mayhem(1) is_cashback(1) | appended: virtual_quote_reserves(i128) creator_fee_bps(u64) can_edit(bool) is_holder_reward(bool)
  // protocol_fees(u64)@271 creator_fees(u64)@279
  const virtualQuoteReserves = d.length >= 261 ? readI128LE(d, 245) : 0n;
  const pool: PumpSwapPool = {
    address,
    config: null as unknown as PumpSwapConfig,
    feeBps: PUMPSWAP_FEE_BPS,
    creator: new PublicKey(d.subarray(11, 43)),
    baseMint: new PublicKey(d.subarray(43, 75)),
    quoteMint: new PublicKey(d.subarray(75, 107)),
    poolBaseTokenAccount: new PublicKey(d.subarray(139, 171)),
    poolQuoteTokenAccount: new PublicKey(d.subarray(171, 203)),
    coinCreator: new PublicKey(d.subarray(211, 243)),
    isMayhem: d[243] === 1,
    isCashback: d[244] === 1,
    isHolderReward: d.length >= 271 ? d[270] === 1 : false,
    virtualQuoteReserves,
    creatorFeesWaiting: d.length >= 287 ? d.readBigUInt64LE(279) : 0n,
    baseReserve: 0n,
    quoteReserve: 0n,
    rawQuoteReserve: 0n,
  };
  const config = await getPumpSwapConfig(conn);
  const [b, qt] = await conn.getMultipleAccountsInfo([pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount], "confirmed");
  if (b) pool.baseReserve = Buffer.from(b.data).readBigUInt64LE(64);
  if (qt) pool.rawQuoteReserve = Buffer.from(qt.data).readBigUInt64LE(64);
  const eff = pool.rawQuoteReserve + virtualQuoteReserves;
  pool.quoteReserve = eff > 0n ? eff : 0n;
  pool.config = config;
  // lp + protocol are exact; the creator/buyback share is tiered by market cap on-chain. 125 bps total
  // matches Jupiter's quotes within 0.02% and the on-chain min-out check protects the rest.
  pool.feeBps = config.lpFeeBps + config.protocolFeeBps + 100n;
  return pool;
}

function readI128LE(d: Buffer, off: number): bigint {
  const lo = d.readBigUInt64LE(off);
  const hi = d.readBigInt64LE(off + 8);
  return (hi << 64n) + lo;
}

export function quoteBuy(pool: PumpSwapPool, lamports: bigint, feeBps = pool.feeBps): bigint {
  const input = (lamports * (10_000n - feeBps)) / 10_000n;
  return (input * pool.baseReserve) / (pool.quoteReserve + input);
}
export function quoteSell(pool: PumpSwapPool, tokens: bigint, feeBps = pool.feeBps): bigint {
  const gross = (tokens * pool.quoteReserve) / (pool.baseReserve + tokens);
  return (gross * (10_000n - feeBps)) / 10_000n;
}
export function poolPriceSol(pool: PumpSwapPool, baseDecimals = 6): number {
  if (pool.baseReserve === 0n) return 0;
  return Number(pool.quoteReserve) / 1e9 / (Number(pool.baseReserve) / 10 ** baseDecimals);
}

function commonTail(pool: PumpSwapPool, user: PublicKey, baseTokenProgram: PublicKey) {
  const list = pool.config?.protocolFeeRecipients?.length ? pool.config.protocolFeeRecipients : null;
  const protocolFeeRecipient = list ? list[Math.floor(Math.random() * list.length)] : pickPumpswapFeeRecipient();
  const coinCreatorVault = coinCreatorVaultPda(pool.coinCreator);
  return {
    userBaseAta: getAssociatedTokenAddressSync(pool.baseMint, user, false, baseTokenProgram),
    userQuoteAta: getAssociatedTokenAddressSync(WSOL_MINT, user, false, TOKEN_PROGRAM_ID),
    protocolFeeRecipient,
    protocolFeeRecipientAta: getAssociatedTokenAddressSync(WSOL_MINT, protocolFeeRecipient, true, TOKEN_PROGRAM_ID),
    coinCreatorVault,
    coinCreatorVaultAta: getAssociatedTokenAddressSync(WSOL_MINT, coinCreatorVault, true, TOKEN_PROGRAM_ID),
    userVol: userVolumePda(user),
  };
}

export function buildBuyIxs(p: { user: PublicKey; pool: PumpSwapPool; lamports: bigint; minBaseOut: bigint; baseTokenProgram: PublicKey }): TransactionInstruction[] {
  const t = commonTail(p.pool, p.user, p.baseTokenProgram);
  const data = Buffer.alloc(25);
  DISC.pumpswapBuyExactQuoteIn.copy(data, 0);
  data.writeBigUInt64LE(p.lamports, 8);
  data.writeBigUInt64LE(p.minBaseOut, 16);
  data[24] = 1;
  const tail = pickTailFeeIdx();
  const keys = [
    { pubkey: p.pool.address, isSigner: false, isWritable: true },
    { pubkey: p.user, isSigner: true, isWritable: true },
    { pubkey: PUMPSWAP_GLOBAL_CONFIG, isSigner: false, isWritable: false },
    { pubkey: p.pool.baseMint, isSigner: false, isWritable: false },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: t.userBaseAta, isSigner: false, isWritable: true },
    { pubkey: t.userQuoteAta, isSigner: false, isWritable: true },
    { pubkey: p.pool.poolBaseTokenAccount, isSigner: false, isWritable: true },
    { pubkey: p.pool.poolQuoteTokenAccount, isSigner: false, isWritable: true },
    { pubkey: t.protocolFeeRecipient, isSigner: false, isWritable: false },
    { pubkey: t.protocolFeeRecipientAta, isSigner: false, isWritable: true },
    { pubkey: p.baseTokenProgram, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: t.coinCreatorVaultAta, isSigner: false, isWritable: true },
    { pubkey: t.coinCreatorVault, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_GLOBAL_VOLUME, isSigner: false, isWritable: false },
    { pubkey: t.userVol, isSigner: false, isWritable: true },
    { pubkey: PUMPSWAP_FEE_CONFIG, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_PROGRAM, isSigner: false, isWritable: false },
  ];
  if (p.pool.isCashback) keys.push({ pubkey: getAssociatedTokenAddressSync(WSOL_MINT, t.userVol, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true });
  keys.push({ pubkey: poolV2Pda(p.pool.baseMint), isSigner: false, isWritable: false });
  keys.push({ pubkey: NEW_FEE_RECIPIENTS[tail], isSigner: false, isWritable: false });
  keys.push({ pubkey: NEW_FEE_RECIPIENT_WSOL_ATAS[tail], isSigner: false, isWritable: true });
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.user, t.userBaseAta, p.user, p.pool.baseMint, p.baseTokenProgram),
    createAssociatedTokenAccountIdempotentInstruction(p.user, t.userQuoteAta, p.user, WSOL_MINT, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: p.user, toPubkey: t.userQuoteAta, lamports: p.lamports }),
    createSyncNativeInstruction(t.userQuoteAta, TOKEN_PROGRAM_ID),
    new TransactionInstruction({ programId: PUMPSWAP_PROGRAM, data, keys }),
    createCloseAccountInstruction(t.userQuoteAta, p.user, p.user, [], TOKEN_PROGRAM_ID),
  ];
}

export function buildSellIxs(p: { user: PublicKey; pool: PumpSwapPool; tokens: bigint; minSolOut: bigint; baseTokenProgram: PublicKey; closeAccount?: boolean }): TransactionInstruction[] {
  const t = commonTail(p.pool, p.user, p.baseTokenProgram);
  const data = Buffer.alloc(25);
  DISC.pumpswapSell.copy(data, 0);
  data.writeBigUInt64LE(p.tokens, 8);
  data.writeBigUInt64LE(p.minSolOut, 16);
  data[24] = 0;
  const tail = pickTailFeeIdx();
  const keys = [
    { pubkey: p.pool.address, isSigner: false, isWritable: true },
    { pubkey: p.user, isSigner: true, isWritable: true },
    { pubkey: PUMPSWAP_GLOBAL_CONFIG, isSigner: false, isWritable: false },
    { pubkey: p.pool.baseMint, isSigner: false, isWritable: false },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: t.userBaseAta, isSigner: false, isWritable: true },
    { pubkey: t.userQuoteAta, isSigner: false, isWritable: true },
    { pubkey: p.pool.poolBaseTokenAccount, isSigner: false, isWritable: true },
    { pubkey: p.pool.poolQuoteTokenAccount, isSigner: false, isWritable: true },
    { pubkey: t.protocolFeeRecipient, isSigner: false, isWritable: false },
    { pubkey: t.protocolFeeRecipientAta, isSigner: false, isWritable: true },
    { pubkey: p.baseTokenProgram, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: t.coinCreatorVaultAta, isSigner: false, isWritable: true },
    { pubkey: t.coinCreatorVault, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_FEE_CONFIG, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_PROGRAM, isSigner: false, isWritable: false },
  ];
  if (p.pool.isCashback) {
    keys.push({ pubkey: getAssociatedTokenAddressSync(WSOL_MINT, t.userVol, true, TOKEN_PROGRAM_ID), isSigner: false, isWritable: true });
    keys.push({ pubkey: t.userVol, isSigner: false, isWritable: true });
  }
  keys.push({ pubkey: poolV2Pda(p.pool.baseMint), isSigner: false, isWritable: false });
  keys.push({ pubkey: NEW_FEE_RECIPIENTS[tail], isSigner: false, isWritable: false });
  keys.push({ pubkey: NEW_FEE_RECIPIENT_WSOL_ATAS[tail], isSigner: false, isWritable: true });
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(p.user, t.userQuoteAta, p.user, WSOL_MINT, TOKEN_PROGRAM_ID),
    new TransactionInstruction({ programId: PUMPSWAP_PROGRAM, data, keys }),
    createCloseAccountInstruction(t.userQuoteAta, p.user, p.user, [], TOKEN_PROGRAM_ID),
  ];
  if (p.closeAccount) ixs.push(createCloseAccountInstruction(t.userBaseAta, p.user, p.user, [], p.baseTokenProgram));
  return ixs;
}

export { TOKEN_2022_PROGRAM_ID };
