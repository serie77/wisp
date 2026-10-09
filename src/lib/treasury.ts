/**
 * Treasury: collects the creator fees of the Wisp token itself and turns them into buybacks
 * (and burns) of that token. Agents keep 100% of the creator fees on coins they deploy; the
 * treasury takes nothing from them. Every step is a public on-chain action, logged on the
 * ledger under the @treasury citizen.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { type AgentRow } from "./api";
import { encryptSecret, generateApiKey, hashApiKey, newId } from "./crypto";
import { now, one, q, run } from "./db";
import { env } from "./env";
import { append } from "./ledger";
import { ring } from "./doorbell";
import { connection } from "./solana/connection";
import { buildDistributeCreatorFeesV2Ix, buildPoolSweepCreatorFeeIx, buildSweepCreatorFeeIx, buildTransferCreatorFeesToPumpV2Ix, fetchSharingConfig, sharingConfigPda } from "./solana/feeshare";
import { buildClaimIxs, getCreatorFees } from "./solana/creatorfee";
import * as pump from "./solana/pumpfun";
import * as pumpswap from "./solana/pumpswap";
import { canonicalPoolPda } from "./solana/pumpswap";
import { buildBurnIxs, getMintInfo, getTokenBalance, solToLamports } from "./solana/tokens";
import { buildTx, explorer, sendAndConfirm } from "./solana/tx";
import { detectVenue } from "./solana/venue";
import { jupQuote, jupSwapTx } from "./solana/jupiter";
import { WSOL_MINT } from "./solana/constants";

export function treasuryKeypair(): Keypair | null {
  if (!env.treasurySecret) return null;
  try { return Keypair.fromSecretKey(bs58.decode(env.treasurySecret)); } catch { return null; }
}
export const treasuryPubkey = (): PublicKey | null => treasuryKeypair()?.publicKey ?? null;
export const treasuryEnabled = () => !!treasuryPubkey();

/** The @treasury citizen: a real row so its buys and burns sit on the ledger like anyone else's. */
export async function ensureTreasuryAgent(): Promise<AgentRow | null> {
  const kp = treasuryKeypair();
  if (!kp) return null;
  const existing = await one<AgentRow>("SELECT * FROM agents WHERE handle = 'treasury'");
  if (existing) return existing;
  const t = now();
  const row: AgentRow = { id: newId("agent"), handle: "treasury", model: "wisp-treasury", bio: "Collects the Wisp token's creator fees and buys the token back. Every move is on this ledger.", api_key_hash: hashApiKey(generateApiKey()), pubkey: kp.publicKey.toBase58(), secret_enc: encryptSecret(kp.secretKey), custody: "wisp", created_at: t, last_seen: t };
  await run("INSERT OR IGNORE INTO agents (id, handle, model, bio, api_key_hash, pubkey, secret_enc, custody, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)", [row.id, row.handle, row.model, row.bio, row.api_key_hash, row.pubkey, row.secret_enc, row.custody, t, t]);
  return (await one<AgentRow>("SELECT * FROM agents WHERE handle = 'treasury'")) ?? row;
}

const RENT_FLOOR = 900_000n; // creator vault stays rent-exempt; only the excess is distributable
let running = false;
let lastRun: { at: number; summary: string } | null = null;
export const lastTreasuryRun = () => lastRun;

/** One cycle: collect the Wisp token's creator fees (claim or distribute, whichever applies), then buy back. */
export async function runTreasuryCycle(): Promise<string> {
  if (running) return "busy";
  running = true;
  const notes: string[] = [];
  try {
    const kp = treasuryKeypair();
    if (!kp) return "treasury not configured";
    const agent = await ensureTreasuryAgent();
    const conn = connection();
    const bal = BigInt(await conn.getBalance(kp.publicKey, "confirmed"));
    if (bal < 3_000_000n) { notes.push(`treasury has ${Number(bal) / 1e9} SOL: not enough for fees`); return finish(notes); }

    // 1a. the treasury created the Wisp token: claim its creator fees straight to this wallet
    if (env.tokenMint) {
      const fees = await getCreatorFees(conn, kp.publicKey, [new PublicKey(env.tokenMint)]).catch(() => null);
      if (fees && fees.total > 2_000_000n) {
        try {
          const { ixs, sweeps, lamports } = buildClaimIxs(kp.publicKey, fees);
          const sig = await sendAndConfirm(conn, await buildTx(conn, { payer: kp.publicKey, ixs, computeUnits: 80_000 + sweeps * 60_000, priorityFeeSol: 0.0001, lookupTables: await pump.getPumpLookupTables(conn) }), [kp]);
          const sol = Number(lamports) / 1e9;
          await run("INSERT INTO buybacks (id, kind, mint, sol, tokens, signature, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", [newId("tr"), "claim", env.tokenMint, sol, 0, sig, "{}", now()]);
          if (agent) await append("claim", sig, agent.id, { mint: env.tokenMint, sol });
          notes.push(`claimed ${sol.toFixed(4)} SOL of creator fees: ${sig.slice(0, 8)}…`);
        } catch (e) { notes.push(`claim failed: ${(e as Error).message.slice(0, 120)}`); }
      }
    }

    // 1b. the Wisp token (or an older coin) shares its creator fee with the treasury: sweep + distribute (permissionless)
    const shared = await q<{ mint: string }>("SELECT mint FROM tokens WHERE fee_share_status = 'active' ORDER BY created_at DESC LIMIT 40");
    const tokens = [...(env.tokenMint ? [{ mint: env.tokenMint }] : []), ...shared.filter((t) => t.mint !== env.tokenMint)];
    type Due = { mint: PublicKey; curveCreator: PublicKey; graduated: boolean; sweepCurve: boolean; pool?: { address: PublicKey; quote: PublicKey; coinCreator: PublicKey }; shareholders: PublicKey[]; lamports: bigint };
    const due: Due[] = [];
    for (const t of tokens) {
      const mint = new PublicKey(t.mint);
      const cfg = await fetchSharingConfig(conn, mint).catch(() => null);
      if (!cfg) continue;
      const vault = pump.creatorVaultPda(sharingConfigPda(mint));
      const curve = await pump.fetchBondingCurve(conn, mint).catch(() => null);
      if (!curve) continue;
      const graduated = curve.complete;
      // Newer trade instructions (buy_v3/sell_v3, bots) park the creator fee on the curve until swept.
      let pending = BigInt(await conn.getBalance(vault, "confirmed").catch(() => 0)) + curve.creatorFeeWaiting;
      let pool: Due["pool"];
      if (graduated) {
        const p = await pumpswap.fetchPool(conn, canonicalPoolPda(mint)).catch(() => null);
        if (p) {
          pool = { address: p.address, quote: p.poolQuoteTokenAccount, coinCreator: p.coinCreator };
          const ata = (await import("@solana/spl-token")).getAssociatedTokenAddressSync(WSOL_MINT, pumpswap.coinCreatorVaultPda(sharingConfigPda(mint)), true);
          pending += BigInt(await conn.getBalance(ata, "confirmed").catch(() => 0));
        }
      }
      if (pending > RENT_FLOOR + 2_000_000n) due.push({ mint, curveCreator: curve.creator, graduated, sweepCurve: curve.creatorFeeWaiting > 0n, pool, shareholders: cfg.shareholders.map((x) => x.address), lamports: pending - RENT_FLOOR });
    }
    for (let i = 0; i < due.length; i += 3) {
      const batch = due.slice(i, i + 3);
      // Order matters: sweep (curve, then pool) -> move AMM fees to the pump vault -> distribute.
      const ixs = batch.flatMap((d) => [
        ...(d.sweepCurve ? [buildSweepCreatorFeeIx({ payer: kp.publicKey, mint: d.mint, creator: d.curveCreator })] : []),
        ...(d.graduated && d.pool ? [buildPoolSweepCreatorFeeIx({ payer: kp.publicKey, pool: d.pool.address, poolQuoteTokenAccount: d.pool.quote, coinCreator: d.pool.coinCreator }), buildTransferCreatorFeesToPumpV2Ix({ payer: kp.publicKey, mint: d.mint })] : []),
        buildDistributeCreatorFeesV2Ix({ payer: kp.publicKey, mint: d.mint, shareholders: d.shareholders }),
      ]);
      try {
        const built = await buildTx(conn, { payer: kp.publicKey, ixs, computeUnits: 200_000 * batch.length, priorityFeeSol: 0.0002, lookupTables: await pump.getPumpLookupTables(conn) });
        const sig = await sendAndConfirm(conn, built, [kp]);
        const sol = Number(batch.reduce((x, d) => x + d.lamports, 0n)) / 1e9;
        await run("INSERT INTO buybacks (id, kind, mint, sol, tokens, signature, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", [newId("tr"), "distribute", batch.map((d) => d.mint.toBase58()).join(","), sol, 0, sig, JSON.stringify({ mints: batch.length }), now()]);
        if (agent) await append("distribute", sig, agent.id, { mints: batch.map((d) => d.mint.toBase58()), sol });
        notes.push(`distributed ~${sol.toFixed(4)} SOL across ${batch.length} coin(s): ${sig.slice(0, 8)}…`);
      } catch (e) { notes.push(`distribute failed: ${(e as Error).message.slice(0, 120)}`); }
    }

    // 2. buy back
    if (!env.tokenMint) { notes.push("no WISP_TOKEN_MINT yet: fees accumulate"); return finish(notes); }
    const balance = BigInt(await conn.getBalance(kp.publicKey, "confirmed"));
    const spend = balance - solToLamports(env.treasuryReserveSol);
    if (spend < solToLamports(env.buybackMinSol)) { notes.push(`below buyback minimum (${Number(spend) / 1e9} SOL spendable)`); return finish(notes); }
    const mint = new PublicKey(env.tokenMint);
    const venue = await detectVenue(conn, mint);
    if (!venue) { notes.push("token mint not found"); return finish(notes); }
    let sig: string;
    if (venue.kind === "pump") {
      const q0 = pump.quoteBuy(venue.curve, spend);
      const ixs = pump.buildBuyIxs({ user: kp.publicKey, mint, lamports: spend, minTokensOut: (q0 * 90n) / 100n, creator: venue.curve.creator, tokenProgram: venue.mintInfo.tokenProgram, isMayhem: venue.curve.isMayhem });
      sig = await sendAndConfirm(conn, await buildTx(conn, { payer: kp.publicKey, ixs, computeUnits: 200_000, lookupTables: await pump.getPumpLookupTables(conn) }), [kp]);
    } else if (venue.kind === "pumpswap") {
      const q0 = pumpswap.quoteBuy(venue.pool, spend);
      const ixs = pumpswap.buildBuyIxs({ user: kp.publicKey, pool: venue.pool, lamports: spend, minBaseOut: (q0 * 90n) / 100n, baseTokenProgram: venue.mintInfo.tokenProgram });
      sig = await sendAndConfirm(conn, await buildTx(conn, { payer: kp.publicKey, ixs, computeUnits: 250_000, lookupTables: await pump.getPumpLookupTables(conn) }), [kp]);
    } else {
      const quote = await jupQuote({ inputMint: WSOL_MINT.toBase58(), outputMint: mint.toBase58(), amount: spend, slippageBps: 300 });
      const tx = await jupSwapTx(quote, kp.publicKey.toBase58(), 200_000);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      sig = await sendAndConfirm(conn, { tx, blockhash, lastValidBlockHeight }, [kp]);
    }
    const bought = await getTokenBalance(conn, kp.publicKey, mint, venue.mintInfo.tokenProgram);
    const boughtUi = Number(bought.amount) / 10 ** venue.mintInfo.decimals;
    await run("INSERT INTO buybacks (id, kind, mint, sol, tokens, signature, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", [newId("bb"), "buy", mint.toBase58(), Number(spend) / 1e9, boughtUi, sig, JSON.stringify({ venue: venue.kind }), now()]);
    if (agent) { await append("buyback", sig, agent.id, { mint: mint.toBase58(), sol: Number(spend) / 1e9, tokens: boughtUi }); ring("buyback", { agent: "treasury", mint: mint.toBase58(), sol: Number(spend) / 1e9, tokens: boughtUi, signature: sig }); }
    notes.push(`bought ${boughtUi} for ${Number(spend) / 1e9} SOL: ${sig.slice(0, 8)}…`);

    // 3. burn what was bought
    if (env.buybackBurn && bought.amount > 0n) {
      const info = await getMintInfo(conn, mint);
      const ixs = buildBurnIxs({ owner: kp.publicKey, mint, amount: bought.amount, tokenProgram: info!.tokenProgram, closeAfter: true });
      const bsig = await sendAndConfirm(conn, await buildTx(conn, { payer: kp.publicKey, ixs, computeUnits: 60_000 }), [kp]);
      await run("INSERT INTO buybacks (id, kind, mint, sol, tokens, signature, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", [newId("bb"), "burn", mint.toBase58(), 0, boughtUi, bsig, "{}", now()]);
      if (agent) await append("burn", bsig, agent.id, { mint: mint.toBase58(), tokens: boughtUi });
      notes.push(`burned ${boughtUi}: ${bsig.slice(0, 8)}…`);
    }
    return finish(notes);
  } catch (e) {
    notes.push(`error: ${(e as Error).message.slice(0, 160)}`);
    return finish(notes);
  } finally {
    running = false;
  }
}
function finish(notes: string[]): string { const s = notes.join("; ") || "nothing to do"; lastRun = { at: now(), summary: s }; return s; }

export async function treasuryBooks() {
  const kp = treasuryKeypair();
  const conn = connection();
  const wallet = kp?.publicKey.toBase58() ?? null;
  const sol = wallet ? (await conn.getBalance(kp!.publicKey, "confirmed").catch(() => 0)) / 1e9 : 0;
  const [tot] = await q<Record<string, number>>(`SELECT
    (SELECT COALESCE(SUM(sol),0) FROM buybacks WHERE kind IN ('claim','distribute')) AS fees_collected_sol,
    (SELECT COALESCE(SUM(sol),0) FROM buybacks WHERE kind='buy') AS sol_spent,
    (SELECT COALESCE(SUM(tokens),0) FROM buybacks WHERE kind='buy') AS tokens_bought,
    (SELECT COALESCE(SUM(tokens),0) FROM buybacks WHERE kind='burn') AS tokens_burned`);
  const recent = await q("SELECT id, kind, mint, sol, tokens, signature, created_at FROM buybacks ORDER BY created_at DESC LIMIT 20");
  return {
    wallet, sol, token_mint: env.tokenMint || null, burn: env.buybackBurn,
    policy: { reserve_sol: env.treasuryReserveSol, min_buyback_sol: env.buybackMinSol, interval_min: env.buybackIntervalMin },
    totals: Object.fromEntries(Object.entries(tot ?? {}).map(([k, v]) => [k, Number(v)])),
    last_run: lastRun, recent, explorer: wallet ? `https://solscan.io/account/${wallet}` : null,
    note: "Funded by the Wisp token's own creator fees. Agents keep 100% of the creator fees on coins they deploy. The treasury collects, buys the token, and burns it, each as a public transaction.",
  };
}
export { explorer };
