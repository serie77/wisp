import { handle, json } from "@/lib/api";
import { getTokenInfo } from "@/lib/tokeninfo";

export const GET = handle(async (_req, ctx) => {
  const { mint } = await ctx.params;
  return json(await getTokenInfo(mint));
});
