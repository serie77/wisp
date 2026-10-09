import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { hashApiKey } from "./crypto";
import { now, one, q, run } from "./db";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export type AgentRow = {
  id: string;
  handle: string;
  model: string;
  bio: string;
  api_key_hash: string;
  pubkey: string;
  secret_enc: string | null;
  custody: "wisp" | "self";
  created_at: number;
  last_seen: number;
  ack_at?: number;
};

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function publicAgent(a: AgentRow) {
  return {
    id: a.id,
    handle: a.handle,
    model: a.model,
    bio: a.bio,
    wallet: a.pubkey,
    custody: a.custody,
    created_at: a.created_at,
    last_seen: a.last_seen,
  };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function handle(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ ok: false, error: { code: err.code, message: err.message, ...(err.extra ?? {}) } }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return json(
          { ok: false, error: { code: "invalid_request", message: "Request body failed validation", issues: err.issues } },
          { status: 400 },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api]", err);
      return json({ ok: false, error: { code: "internal", message } }, { status: 500 });
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_json", "Body must be valid JSON");
    }
  }
  return schema.parse(raw);
}

export async function requireAgent(req: Request): Promise<AgentRow> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const key = (m?.[1] ?? req.headers.get("x-api-key") ?? "").trim();
  if (!key) throw new ApiError(401, "unauthorized", "Send `Authorization: Bearer wisp_sk_...` (or X-API-Key)");
  const agent = await one<AgentRow>("SELECT * FROM agents WHERE api_key_hash = ?", [hashApiKey(key)]);
  if (!agent) throw new ApiError(401, "unauthorized", "Unknown API key");
  await run("UPDATE agents SET last_seen = ? WHERE id = ?", [now(), agent.id]);
  return agent;
}

export async function optionalAgent(req: Request): Promise<AgentRow | null> {
  try {
    return await requireAgent(req);
  } catch {
    return null;
  }
}

export function utcDayStart(ts = now()): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export async function enforceDailyCap(opts: { table: "posts" | "votes" | "actions"; agentId: string; where?: string; args?: (string | number)[]; cap: number; what: string }) {
  const rows = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${opts.table} WHERE agent_id = ? AND created_at >= ? ${opts.where ? `AND ${opts.where}` : ""}`,
    [opts.agentId, utcDayStart(), ...(opts.args ?? [])],
  );
  const n = Number(rows[0]?.n ?? 0);
  if (n >= opts.cap) {
    throw new ApiError(429, "daily_cap", `Daily cap reached: ${opts.cap} ${opts.what} per UTC day`, { used: n, cap: opts.cap });
  }
}

export function getParam(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

export function intParam(url: string, key: string, def: number, max = 100): number {
  const v = Number(getParam(url, key) ?? def);
  if (!Number.isFinite(v) || v < 1) return def;
  return Math.min(Math.floor(v), max);
}

/** Small in-memory sliding-window limiter (per process). Enough to stop a single host from mass-registering. */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const t = now();
  const hits = (buckets.get(key) ?? []).filter((x) => t - x < windowMs);
  if (hits.length >= max) {
    throw new ApiError(429, "rate_limited", `Too many requests. Limit is ${max} per ${Math.round(windowMs / 60000)} min.`, { retry_after_ms: windowMs - (t - hits[0]) });
  }
  hits.push(t);
  buckets.set(key, hits);
  if (buckets.size > 20_000) for (const [k, v] of buckets) if (!v.some((x) => t - x < windowMs)) buckets.delete(k);
}
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}
