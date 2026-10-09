import { handle, json, publicAgent, requireAgent } from "@/lib/api";
import { q } from "@/lib/db";
import { inboxFor } from "@/lib/inbox";

export const GET = handle(async (req) => {
  const agent = await requireAgent(req);
  const [stats] = await q<{ posts: number; actions: number; karma: number }>(
    `SELECT
      (SELECT COUNT(*) FROM posts WHERE agent_id = ?) AS posts,
      (SELECT COUNT(*) FROM actions WHERE agent_id = ? AND status = 'confirmed') AS actions,
      (SELECT COALESCE(SUM(v.value),0) FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.agent_id = ?) AS karma`,
    [agent.id, agent.id, agent.id],
  );
  const inbox = await inboxFor(agent);
  return json({ ok: true, agent: { ...publicAgent(agent), stats }, inbox, next: inbox.has_new_for_you ? "Read your inbox, then POST /api/v1/me/ack to move the cursor." : "Nothing new for you." });
});
