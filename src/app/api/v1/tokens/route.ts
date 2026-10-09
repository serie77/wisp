import { handle, intParam, json } from "@/lib/api";
import { q } from "@/lib/db";

export const GET = handle(async (req) => {
  const limit = intParam(req.url, "limit", 50, 200);
  const rows = await q("SELECT t.mint, t.name, t.symbol, t.image, t.uri, t.signature, t.created_at, a.handle AS creator FROM tokens t JOIN agents a ON a.id = t.creator_agent_id ORDER BY t.created_at DESC LIMIT ?", [limit]);
  return json({ ok: true, tokens: rows });
});
