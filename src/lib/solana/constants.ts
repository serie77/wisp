import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

// ─── Pump.fun bonding curve program ───────────────────────────────────────────
export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
export const PUMP_EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
export const PUMP_FEE_CONFIG = new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
export const PUMP_FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const PUMP_FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
export const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
export const MAYHEM_GLOBAL_PARAMS = new PublicKey("13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ");
export const MAYHEM_SOL_VAULT = new PublicKey("BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s");
export const MAYHEM_FEE_RECIPIENT = new PublicKey("GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS");

// Tail fee recipients (April 2026 program upgrade). Required as the last account on
// pump.fun buy/sell and PumpSwap buy/sell. Rotate for throughput.
export const NEW_FEE_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
].map((k) => new PublicKey(k));

// ─── PumpSwap AMM (graduated coins) ───────────────────────────────────────────
export const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMPSWAP_GLOBAL_CONFIG = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
export const PUMPSWAP_FEE_CONFIG = new PublicKey("5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");
export const PUMPSWAP_FEE_RECIPIENTS = [
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
].map((k) => new PublicKey(k)); // per pump-public-docs/docs/FEE_RECIPIENTS.md

export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };

// ─── Anchor discriminators: sha256("global:<name>")[0..8] ─────────────────────
export const DISC = {
  createV2: Buffer.from([0xd6, 0x90, 0x4c, 0xec, 0x5f, 0x8b, 0x31, 0xb4]),
  buyExactSolIn: Buffer.from([0x38, 0xfc, 0x74, 0x08, 0x9e, 0xdf, 0xcd, 0x5f]),
  sell: Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]),
  pumpswapBuyExactQuoteIn: Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]),
  pumpswapSell: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
};

// ─── Fresh bonding curve parameters (for deploy quotes) ───────────────────────
export const CURVE = {
  vTokenReserves: 1_073_000_000_000_000n,
  vSolReserves: 30_000_000_000n,
  realTokenReserves: 793_100_000_000_000n,
  totalFeeBps: 125n,
  tokenDecimals: 6,
  totalSupply: 1_000_000_000_000_000n,
};

// ─── Derived PDAs (static) ────────────────────────────────────────────────────
export const PUMP_MINT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], PUMP_PROGRAM)[0];
export const PUMP_EVENT_AUTHORITY_PDA = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM)[0];
export const PUMP_GLOBAL_VOLUME = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], PUMP_PROGRAM)[0];
export const PUMPSWAP_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMPSWAP_PROGRAM)[0];
export const PUMPSWAP_GLOBAL_VOLUME = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], PUMPSWAP_PROGRAM)[0];

export const NEW_FEE_RECIPIENT_WSOL_ATAS = NEW_FEE_RECIPIENTS.map((r) => getAssociatedTokenAddressSync(WSOL_MINT, r, true, TOKEN_PROGRAM_ID));

let tailIdx = 0;
export function pickTailFeeIdx(): number {
  tailIdx = (tailIdx + 1) % NEW_FEE_RECIPIENTS.length;
  return tailIdx;
}
export function pickPumpswapFeeRecipient(): PublicKey {
  return PUMPSWAP_FEE_RECIPIENTS[Math.floor(Math.random() * PUMPSWAP_FEE_RECIPIENTS.length)];
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;
