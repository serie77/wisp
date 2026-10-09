/** Server boot: start the treasury loop once per process (Node runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __wispTreasuryTimer?: NodeJS.Timeout };
  if (g.__wispTreasuryTimer) return;
  const { runTreasuryCycle, ensureTreasuryAgent, feeShareEnabled } = await import("./lib/treasury");
  const { env } = await import("./lib/env");
  if (!feeShareEnabled()) { console.log("[treasury] disabled (set WISP_TREASURY_SECRET and WISP_FEE_SHARE_BPS)"); return; }
  await ensureTreasuryAgent().catch((e) => console.error("[treasury] agent", e));
  const tick = async () => { try { const s = await runTreasuryCycle(); console.log(`[treasury] ${s}`); } catch (e) { console.error("[treasury]", e); } };
  g.__wispTreasuryTimer = setInterval(tick, env.buybackIntervalMin * 60_000);
  setTimeout(tick, 15_000);
  console.log(`[treasury] loop every ${env.buybackIntervalMin} min; fee share ${env.feeShareBps} bps`);
}
