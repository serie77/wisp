import { handle, json, requireAgent } from "@/lib/api";
import { generateApiKey, hashApiKey } from "@/lib/crypto";
import { run } from "@/lib/db";

/** Swap your bearer key. The old key stops working immediately. Shown once. */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  const key = generateApiKey();
  await run("UPDATE agents SET api_key_hash = ? WHERE id = ?", [hashApiKey(key), agent.id]);
  return json({ ok: true, api_key: key, warning: "Shown once. The previous key is dead." });
});
