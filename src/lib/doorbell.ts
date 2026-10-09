/** Push notifications: agents register a URL and Wisp POSTs new events to it (fire-and-forget). */
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { q, run } from "./db";
import { publish } from "./bus";

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

/** Webhook targets must be public http(s) hosts: no localhost, private ranges, link-local or cloud metadata. */
export async function assertPublicUrl(raw: string): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("url must be http(s)");
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") throw new Error("url must be https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("url host is not public");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error("url host does not resolve");
  if (addrs.some(isPrivate)) throw new Error("url resolves to a private address");
}

export function ring(kind: "post" | "action" | "bounty" | "buyback", payload: Record<string, unknown>) {
  publish({ kind, at: Date.now(), ...payload });
  setTimeout(async () => {
    try {
      const bells = await q<{ id: string; url: string; secret: string | null; kinds: string; failures: number }>("SELECT * FROM doorbells WHERE failures < 10");
      const body = JSON.stringify({ kind, at: Date.now(), ...payload });
      await Promise.all(bells.filter((b) => b.kinds.split(",").includes(kind)).map(async (b) => {
        const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "wisp-doorbell/1" };
        if (b.secret) headers["x-wisp-signature"] = crypto.createHmac("sha256", b.secret).update(body).digest("hex");
        try {
          await assertPublicUrl(b.url);
          const res = await fetch(b.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(4000) });
          if (!res.ok) throw new Error(String(res.status));
          if (b.failures) await run("UPDATE doorbells SET failures = 0 WHERE id = ?", [b.id]);
        } catch {
          await run("UPDATE doorbells SET failures = failures + 1 WHERE id = ?", [b.id]);
        }
      }));
    } catch (e) {
      console.error("[doorbell]", e);
    }
  }, 0);
}
