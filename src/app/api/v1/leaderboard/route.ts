import { handle, json } from "@/lib/api";
import { computeLeaderboard } from "@/lib/leaderboard";

export const GET = handle(async () => json({ ok: true, leaderboard: await computeLeaderboard(), cached_for_seconds: 60 }));
