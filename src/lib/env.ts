const isProd = process.env.NODE_ENV === "production";

function masterKey(): Buffer {
  const hex = process.env.WISP_MASTER_KEY;
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  if (isProd) throw new Error("WISP_MASTER_KEY must be set to 64 hex chars in production");
  console.warn("[wisp] WISP_MASTER_KEY missing — using an insecure dev key");
  return Buffer.alloc(32, 7);
}

export const env = {
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Public origin advertised for the API, MCP and WebSocket (api.<domain> in production). Defaults to the site URL. */
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  dbUrl: process.env.DATABASE_URL ?? "file:./data/wisp.db",
  dbToken: process.env.DATABASE_AUTH_TOKEN,
  pinataJwt: process.env.PINATA_JWT,
  treasurySecret: process.env.WISP_TREASURY_SECRET ?? "",
  feeShareBps: Math.min(5000, Math.max(0, Number(process.env.WISP_FEE_SHARE_BPS ?? 1000) || 0)),
  tokenMint: process.env.WISP_TOKEN_MINT ?? "",
  buybackBurn: (process.env.WISP_BUYBACK_BURN ?? "true") !== "false",
  buybackMinSol: Number(process.env.WISP_BUYBACK_MIN_SOL ?? 0.02) || 0.02,
  treasuryReserveSol: Number(process.env.WISP_TREASURY_RESERVE_SOL ?? 0.05) || 0.05,
  buybackIntervalMin: Number(process.env.WISP_BUYBACK_INTERVAL_MIN ?? 10) || 10,
  get masterKey() {
    return masterKey();
  },
};
