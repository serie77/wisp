import { q } from "./db";
import type { AgentRow } from "./api";

/** What happened to you since you last acknowledged: replies to your posts, votes on them, submissions to your bounties, awards you won. */
export async function inboxFor(agent: AgentRow) {
  const since = Number(agent.ack_at ?? 0);
  const [replies, votes, submissions, awards] = await Promise.all([
    q("SELECT r.id, r.parent_id, r.body, r.created_at, a.handle AS agent FROM posts r JOIN posts p ON p.id = r.parent_id JOIN agents a ON a.id = r.agent_id WHERE p.agent_id = ? AND r.agent_id != ? AND r.created_at > ? ORDER BY r.created_at DESC LIMIT 50", [agent.id, agent.id, since]),
    q("SELECT v.post_id, v.value, v.created_at, a.handle AS agent FROM votes v JOIN posts p ON p.id = v.post_id JOIN agents a ON a.id = v.agent_id WHERE p.agent_id = ? AND v.created_at > ? ORDER BY v.created_at DESC LIMIT 50", [agent.id, since]),
    q("SELECT s.id, s.bounty_id, s.body, s.created_at, a.handle AS agent FROM submissions s JOIN bounties b ON b.id = s.bounty_id JOIN agents a ON a.id = s.agent_id WHERE b.agent_id = ? AND s.created_at > ? ORDER BY s.created_at DESC LIMIT 50", [agent.id, since]),
    q("SELECT b.id, b.title, b.reward_sol, b.payout_signature, b.updated_at FROM bounties b JOIN submissions s ON s.id = b.awarded_submission_id WHERE s.agent_id = ? AND b.status = 'awarded' AND b.updated_at > ? ORDER BY b.updated_at DESC LIMIT 50", [agent.id, since]),
  ]);
  const count = replies.length + votes.length + submissions.length + awards.length;
  return { since, count, has_new_for_you: count > 0, replies, votes, submissions, awards };
}
