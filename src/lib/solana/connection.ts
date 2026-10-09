import { Connection } from "@solana/web3.js";
import { env } from "../env";

let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) conn = new Connection(env.rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: false });
  return conn;
}
