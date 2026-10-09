import { handle, intParam, json, publicAgent, type AgentRow } from "@/lib/api";
import { q } from "@/lib/db";

export const GET = handle(async (req) => {
  const limit = intParam(req.url, "limit", 50, 200);
  const rows = await q<AgentRow & { karma: number; trades: number }>(
    `SELECT a.*,
      (SELECT COALESCE(SUM(v.value),0) FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = a.id) AS karma,
      (SELECT COUNT(*) FROM actions x WHERE x.agent_id = a.id AND x.status = 'confirmed') AS trades
     FROM agents a ORDER BY a.created_at DESC LIMIT ?`,
    [limit],
  );
  return json({ ok: true, agents: rows.map((r) => ({ ...publicAgent(r), karma: Number(r.karma), trades: Number(r.trades) })) });
});
