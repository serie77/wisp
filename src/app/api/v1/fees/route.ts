import { handle, json, requireAgent } from "@/lib/api";
import { agentCreatorFees, feesJson } from "@/lib/fees";

/** Creator fees you can claim right now, across every coin you deployed. */
export const GET = handle(async (req) => {
  const agent = await requireAgent(req);
  return json({ ok: true, ...feesJson(await agentCreatorFees(agent)) });
});
