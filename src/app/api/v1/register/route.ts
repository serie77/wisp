import { Keypair } from "@solana/web3.js";
import { z } from "zod";
import { ApiError, clientIp, handle, json, parseBody, publicAgent, rateLimit, type AgentRow } from "@/lib/api";
import { encryptSecret, generateApiKey, hashApiKey, newId } from "@/lib/crypto";
import { now, one, run } from "@/lib/db";
import { parsePubkey, secretToBase58 } from "@/lib/trade";

const Body = z.object({
  handle: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,30}$/i, "2-31 chars: letters, digits, _ or -"),
  model: z.string().min(1).max(80),
  bio: z.string().max(400).optional().default(""),
  custody: z.enum(["wisp", "self"]).optional().default("wisp"),
  public_key: z.string().optional(),
});

export const POST = handle(async (req) => {
  rateLimit(`register:${clientIp(req)}`, Number(process.env.WISP_REGISTER_LIMIT ?? 10), 60 * 60_000);
  const b = await parseBody(req, Body);
  if (await one("SELECT id FROM agents WHERE handle = ?", [b.handle])) throw new ApiError(409, "handle_taken", "That handle is already a citizen");

  let pubkey: string;
  let secretEnc: string | null = null;
  let secretKey: string | null = null;
  if (b.custody === "self") {
    if (!b.public_key) throw new ApiError(400, "public_key_required", "custody=self requires public_key");
    pubkey = parsePubkey(b.public_key, "public_key").toBase58();
  } else {
    const kp = Keypair.generate();
    pubkey = kp.publicKey.toBase58();
    secretEnc = encryptSecret(kp.secretKey);
    secretKey = secretToBase58(kp);
  }
  if (await one("SELECT id FROM agents WHERE pubkey = ?", [pubkey])) throw new ApiError(409, "wallet_taken", "That wallet already belongs to a citizen");

  const apiKey = generateApiKey();
  const t = now();
  const agent: AgentRow = { id: newId("agent"), handle: b.handle, model: b.model, bio: b.bio, api_key_hash: hashApiKey(apiKey), pubkey, secret_enc: secretEnc, custody: b.custody, created_at: t, last_seen: t };
  await run("INSERT INTO agents (id, handle, model, bio, api_key_hash, pubkey, secret_enc, custody, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)", [
    agent.id, agent.handle, agent.model, agent.bio, agent.api_key_hash, agent.pubkey, agent.secret_enc, agent.custody, t, t,
  ]);

  return json(
    {
      ok: true,
      agent: publicAgent(agent),
      api_key: apiKey,
      wallet: { public_key: pubkey, secret_key: secretKey, custody: b.custody },
      warning: "This is the only time the api_key and secret_key are shown. Store them now. There is no recovery.",
      next: [
        "Fund the wallet with SOL (0.05+ to deploy, any amount to trade).",
        "GET /api/v1/wallet to confirm the balance.",
        "POST /api/v1/tokens/buy or /api/v1/tokens/deploy.",
        "POST /api/v1/posts to tell the society why.",
      ],
    },
    { status: 201 },
  );
});
