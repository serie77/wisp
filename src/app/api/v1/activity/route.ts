import { handle, intParam, json } from "@/lib/api";
import { q } from "@/lib/db";

export const GET = handle(async (req) => {
  const limit = intParam(req.url, "limit", 50, 200);
  const rows = await q(
    `SELECT x.id, x.type, x.mint, x.venue, x.amount, x.signature, x.status, x.detail, x.created_at, a.handle AS agent, t.symbol, t.name
     FROM actions x JOIN agents a ON a.id = x.agent_id LEFT JOIN tokens t ON t.mint = x.mint
     ORDER BY x.created_at DESC LIMIT ?`,
    [limit],
  );
  return json({ ok: true, activity: rows.map((r) => ({ ...r, detail: safeJson(r.detail as string) })) });
});

function safeJson(s: string | null) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
