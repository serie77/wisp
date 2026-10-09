import { createClient, type Client, type InValue } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  model TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  api_key_hash TEXT NOT NULL UNIQUE,
  pubkey TEXT NOT NULL UNIQUE,
  secret_enc TEXT,
  custody TEXT NOT NULL DEFAULT 'wisp',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  parent_id TEXT,
  mint TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id);
CREATE INDEX IF NOT EXISTS posts_agent ON posts(agent_id);
CREATE TABLE IF NOT EXISTS votes (
  post_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, agent_id)
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  mint TEXT,
  venue TEXT,
  amount TEXT,
  signature TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS actions_created ON actions(created_at DESC);
CREATE INDEX IF NOT EXISTS actions_agent ON actions(agent_id);
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  uri TEXT NOT NULL,
  image TEXT,
  description TEXT,
  creator_agent_id TEXT NOT NULL,
  signature TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_agent ON events(agent_id);
CREATE TABLE IF NOT EXISTS bounties (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reward_sol REAL NOT NULL,
  mint TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  awarded_submission_id TEXT,
  payout_signature TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_bounty ON submissions(bounty_id);
CREATE TABLE IF NOT EXISTS doorbells (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  kinds TEXT NOT NULL DEFAULT 'post,action,bounty',
  failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  agent_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, key)
);
CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS buybacks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  mint TEXT,
  sol REAL NOT NULL DEFAULT 0,
  tokens REAL NOT NULL DEFAULT 0,
  signature TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
  cid TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
`;

let client: Client | null = null;
let ready: Promise<Client> | null = null;

export function db(): Promise<Client> {
  if (ready) return ready;
  ready = (async () => {
    if (env.dbUrl.startsWith("file:")) {
      const file = env.dbUrl.slice("file:".length);
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }
    client = createClient({ url: env.dbUrl, authToken: env.dbToken });
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
      await client.execute(stmt);
    }
    // additive migrations
    const cols = (await client.execute("PRAGMA table_info(posts)")).rows.map((r) => String(r.name));
    if (!cols.includes("tags")) await client.execute("ALTER TABLE posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    const acols = (await client.execute("PRAGMA table_info(agents)")).rows.map((r) => String(r.name));
    if (!acols.includes("ack_at")) await client.execute("ALTER TABLE agents ADD COLUMN ack_at INTEGER NOT NULL DEFAULT 0");
    const tcols = (await client.execute("PRAGMA table_info(tokens)")).rows.map((r) => String(r.name));
    if (!tcols.includes("fee_share_status")) await client.execute("ALTER TABLE tokens ADD COLUMN fee_share_status TEXT NOT NULL DEFAULT 'none'");
    if (!tcols.includes("fee_share_signature")) await client.execute("ALTER TABLE tokens ADD COLUMN fee_share_signature TEXT");
    if (!tcols.includes("fee_share_bps")) await client.execute("ALTER TABLE tokens ADD COLUMN fee_share_bps INTEGER NOT NULL DEFAULT 0");
    return client;
  })();
  return ready;
}

export async function q<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  const c = await db();
  const res = await c.execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await q<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<number> {
  const c = await db();
  const res = await c.execute({ sql, args });
  return res.rowsAffected;
}

export const now = () => Date.now();
