/**
 * Mainnet instruction-layout verification. Builds real pump.fun create_v2 / buy / sell,
 * PumpSwap buy / sell, SPL burn and transfer transactions with a *funded* payer, then
 * simulates them against mainnet (sigVerify=false). Nothing is signed or broadcast.
 * A pass means the program accepted our account list + data and ran to completion.
 *
 *   npx tsx scripts/simulate.ts [pump_mint] [graduated_mint]
 */
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { connection } from "../src/lib/solana/connection";
import { CURVE, PUMP_PROGRAM, PUMPSWAP_PROGRAM, TOKEN_2022_PROGRAM_ID } from "../src/lib/solana/constants";
import * as pump from "../src/lib/solana/pumpfun";
import * as ps from "../src/lib/solana/pumpswap";
import { buildBurnIxs, buildTransferSolIx, getMintInfo, getTokenBalance } from "../src/lib/solana/tokens";
import { buildTx, simulateTx } from "../src/lib/solana/tx";
import { detectVenue } from "../src/lib/solana/venue";
import { buildClaimIxs, getCreatorFees } from "../src/lib/solana/creatorfee";

// A large, always-funded mainnet wallet used purely as a simulation payer (never signs).
const FUNDED = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const conn = connection();
let failures = 0;
const ok = (n: string, extra = "") => console.log(`  ✓ ${n}${extra ? `  ${extra}` : ""}`);
const bad = (n: string, extra = "") => { failures++; console.log(`  ✗ ${n}${extra ? `  ${extra}` : ""}`); };

async function sim(name: string, payer: PublicKey, ixs: Awaited<ReturnType<typeof pump.buildBuyIxs>>, program: PublicKey, cu = 400_000) {
  await sleep(800);
  let built, r;
  try {
    built = await buildTx(conn, { payer, ixs, computeUnits: cu, priorityFeeSol: 0.0001, lookupTables: await pump.getPumpLookupTables(conn) });
    r = await simulateTx(conn, built.tx);
  } catch (e) {
    return bad(name, `rpc error: ${(e as Error).message.slice(0, 120)}`);
  }
  const size = built.tx.serialize().length;
  const logs = r.logs.join("\n");
  const invoked = logs.includes(`${program.toBase58()} invoke`);
  const success = logs.includes(`${program.toBase58()} success`) && !r.err;
  if (success) ok(name, `${size}B, ${r.units_consumed} CU`);
  else if (invoked) bad(name, `program invoked but failed: ${JSON.stringify(r.err)} :: ${r.logs.filter((l) => /Error|failed|Program log/.test(l)).slice(-4).join(" | ")}`);
  else bad(name, `not invoked: ${JSON.stringify(r.err)} ${logs.slice(0, 300)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SYSTEM = new PublicKey("11111111111111111111111111111111");

async function isFundedWallet(o: PublicKey) {
  const ai = await conn.getAccountInfo(o, "confirmed");
  return !!ai && ai.owner.equals(SYSTEM) && ai.lamports > 5_000_000;
}

/** Find a wallet that holds the token: try `candidates` (creator etc.) first, then the largest accounts (rate-limited on Alchemy). */
async function largestHolder(mint: PublicKey, tokenProgram: PublicKey, exclude: PublicKey[], candidates: PublicKey[] = []): Promise<PublicKey | null> {
  for (const c of candidates) {
    const bal = await getTokenBalance(conn, c, mint, tokenProgram);
    if (bal.amount > 1_000_000n && (await isFundedWallet(c))) return c;
  }
  // Fall back to recent signers against the market account (buyers who likely still hold).
  const market = exclude[0];
  await sleep(1000);
  const sigs = await conn.getSignaturesForAddress(market, { limit: 25 }, "confirmed").catch(() => []);
  const seen = new Set<string>();
  for (const s of sigs) {
    if (s.err) continue;
    await sleep(300);
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    const payer = tx?.transaction.message.staticAccountKeys[0];
    if (!payer || seen.has(payer.toBase58()) || exclude.some((e) => e.equals(payer))) continue;
    seen.add(payer.toBase58());
    const bal = await getTokenBalance(conn, payer, mint, tokenProgram).catch(() => ({ amount: 0n }));
    if (bal.amount > 1_000_000n && (await isFundedWallet(payer))) return payer;
  }
  return null;
}

async function findPumpMint(): Promise<string | null> {
  const res = (await fetch("https://api.dexscreener.com/token-profiles/latest/v1").then((r) => r.json()).catch(() => [])) as { chainId: string; tokenAddress: string }[];
  for (const t of res) {
    if (t.chainId !== "solana" || !t.tokenAddress.endsWith("pump")) continue;
    const v = await detectVenue(conn, new PublicKey(t.tokenAddress));
    if (v?.kind === "pump" && pump.isSolQuoted(v.curve)) return t.tokenAddress;
  }
  return null;
}
async function findGraduatedMint(): Promise<string | null> {
  const res = (await fetch("https://api.dexscreener.com/token-boosts/top/v1").then((r) => r.json()).catch(() => [])) as { chainId: string; tokenAddress: string }[];
  for (const t of res) {
    if (t.chainId !== "solana" || !t.tokenAddress.endsWith("pump")) continue;
    const v = await detectVenue(conn, new PublicKey(t.tokenAddress));
    if (v?.kind === "pumpswap" && v.pool.quoteReserve > 0n) return t.tokenAddress;
  }
  return null;
}

(async () => {
  console.log("wisp mainnet simulation (no signing, no broadcast)\n");
  const alts = await pump.getPumpLookupTables(conn);
  if (alts.length) ok("pump.fun lookup tables loaded", `${alts.map((a) => a.state.addresses.length).join("+")} addresses`); else bad("pump.fun lookup tables");

  // ── create_v2 + dev buy ──
  {
    const mintKp = Keypair.generate();
    const uri = "http://localhost:3000/m/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
    const ixs = [pump.buildCreateIx({ mint: mintKp.publicKey, payer: FUNDED, name: "Wisp Probe", symbol: "WPRB", uri })];
    const lamports = 10_000_000n;
    const q = pump.quoteBuy(pump.freshCurve(), lamports);
    ixs.push(...pump.buildBuyIxs({ user: FUNDED, mint: mintKp.publicKey, lamports, minTokensOut: (q * 90n) / 100n, creator: FUNDED, tokenProgram: TOKEN_2022_PROGRAM_ID }));
    const built = await buildTx(conn, { payer: FUNDED, ixs, computeUnits: 400_000, lookupTables: alts });
    built.tx.sign([mintKp]); // mint must sign; payer sig is skipped via sigVerify=false
    const size = built.tx.serialize().length;
    const r = await simulateTx(conn, built.tx);
    const logs = r.logs.join("\n");
    if (!r.err && logs.includes(`${PUMP_PROGRAM.toBase58()} success`)) ok("pump.fun create_v2 + dev buy (0.01 SOL)", `${size}B, ${r.units_consumed} CU, quoted ${Number(q) / 10 ** CURVE.tokenDecimals} tokens`);
    else bad("pump.fun create_v2 + dev buy", `${size}B err=${JSON.stringify(r.err)} :: ${r.logs.slice(-6).join(" | ")}`);
  }

  // ── create_v2 holder-rewards coin (trailing OptionU64 + OptionBool args) ──
  {
    const mintKp = Keypair.generate();
    const ixs = [pump.buildCreateIx({ mint: mintKp.publicKey, payer: FUNDED, name: "Wisp HR", symbol: "WHR", uri: "http://localhost:3000/m/x", holderReward: true })];
    const built = await buildTx(conn, { payer: FUNDED, ixs, computeUnits: 300_000, lookupTables: alts });
    built.tx.sign([mintKp]);
    const r = await simulateTx(conn, built.tx);
    if (!r.err && r.logs.join("\n").includes(`${PUMP_PROGRAM.toBase58()} success`)) ok("pump.fun create_v2 holder-rewards coin", `${r.units_consumed} CU`);
    else bad("pump.fun create_v2 holder-rewards coin", `${JSON.stringify(r.err)} :: ${r.logs.filter((l) => /Error|log/.test(l)).slice(-4).join(" | ")}`);
  }

  // ── bonding curve buy / sell ──
  const pumpMint = process.argv[2] ?? (await findPumpMint());
  if (!pumpMint) bad("find live pump mint");
  else {
    const mint = new PublicKey(pumpMint);
    const v = await detectVenue(conn, mint);
    if (v?.kind !== "pump") bad("pump mint venue", String(v?.kind));
    else {
      const lamports = 5_000_000n;
      const q = pump.quoteBuy(v.curve, lamports);
      await sim(`pump.fun buy_exact_sol_in on ${pumpMint.slice(0, 6)}… (0.005 SOL → ${Math.round(Number(q) / 1e6)} tokens)`, FUNDED,
        pump.buildBuyIxs({ user: FUNDED, mint, lamports, minTokensOut: (q * 95n) / 100n, creator: v.curve.creator, tokenProgram: v.mintInfo.tokenProgram, isMayhem: v.curve.isMayhem }), PUMP_PROGRAM, 200_000);
      const holder = await largestHolder(mint, v.mintInfo.tokenProgram, [v.curve.address], [v.curve.creator]);
      if (!holder) bad("find pump holder for sell sim");
      else {
        const bal = await getTokenBalance(conn, holder, mint, v.mintInfo.tokenProgram);
        const tokens = bal.amount / 10n;
        const qs = pump.quoteSell(v.curve, tokens);
        await sim(`pump.fun sell by holder ${holder.toBase58().slice(0, 6)}… (${Number(tokens) / 1e6} tokens → ${Number(qs) / 1e9} SOL)`, holder,
          pump.buildSellIxs({ user: holder, mint, tokens, minSolOut: (qs * 90n) / 100n, creator: v.curve.creator, tokenProgram: v.mintInfo.tokenProgram, isMayhem: v.curve.isMayhem, isCashback: v.curve.isCashback }), PUMP_PROGRAM, 200_000);
        await sim(`SPL burn by holder (${Number(tokens) / 1e6} tokens)`, holder, buildBurnIxs({ owner: holder, mint, amount: tokens, tokenProgram: v.mintInfo.tokenProgram }), v.mintInfo.tokenProgram, 60_000);
      }
    }
  }

  // ── PumpSwap buy / sell ──
  const gradMint = process.argv[3] ?? (await findGraduatedMint());
  if (!gradMint) bad("find graduated (PumpSwap) mint");
  else {
    const mint = new PublicKey(gradMint);
    const v = await detectVenue(conn, mint);
    if (v?.kind !== "pumpswap") bad("graduated mint venue", String(v?.kind));
    else {
      const lamports = 5_000_000n;
      const q = ps.quoteBuy(v.pool, lamports);
      await sim(`PumpSwap buy on ${gradMint.slice(0, 6)}… (0.005 SOL → ${Math.round(Number(q) / 10 ** v.mintInfo.decimals)} tokens)`, FUNDED,
        ps.buildBuyIxs({ user: FUNDED, pool: v.pool, lamports, minBaseOut: (q * 95n) / 100n, baseTokenProgram: v.mintInfo.tokenProgram }), PUMPSWAP_PROGRAM, 300_000);
      const holder = await largestHolder(mint, v.mintInfo.tokenProgram, [v.pool.address, v.pool.poolBaseTokenAccount], [v.pool.coinCreator, v.pool.creator]);
      if (!holder) bad("find PumpSwap holder for sell sim");
      else {
        const bal = await getTokenBalance(conn, holder, mint, v.mintInfo.tokenProgram);
        const tokens = bal.amount / 100n;
        const qs = ps.quoteSell(v.pool, tokens);
        await sim(`PumpSwap sell by holder ${holder.toBase58().slice(0, 6)}… (${Number(tokens) / 10 ** v.mintInfo.decimals} tokens → ${Number(qs) / 1e9} SOL)`, holder,
          ps.buildSellIxs({ user: holder, pool: v.pool, tokens, minSolOut: (qs * 90n) / 100n, baseTokenProgram: v.mintInfo.tokenProgram }), PUMPSWAP_PROGRAM, 300_000);
      }
    }
  }

  // ── creator-fee claim (sweep parked fees + collect both vaults) for the live coins' creators ──
  for (const m of [pumpMint, gradMint].filter((x): x is string => !!x)) {
    const mint = new PublicKey(m);
    const v = await detectVenue(conn, mint);
    const curve = await pump.fetchBondingCurve(conn, mint);
    if (!curve) continue;
    const creator = v?.kind === "pumpswap" ? v.pool.coinCreator : curve.creator;
    const owner = (await conn.getAccountInfo(creator, "confirmed"))?.owner;
    if (owner && !owner.equals(SYSTEM)) { ok(`claim on ${m.slice(0, 6)}… skipped`, `creator is a PDA of ${owner.toBase58().slice(0, 6)}…`); continue; }
    const fees = await getCreatorFees(conn, creator, [mint]);
    if (fees.total === 0n) { ok(`claim on ${m.slice(0, 6)}… skipped`, "nothing waiting"); continue; }
    const c = fees.coins[0];
    await sim(`creator-fee claim on ${m.slice(0, 6)}… (${Number(fees.total) / 1e9} SOL: vaults ${Number(fees.curveVault + fees.ammVault) / 1e9}, curve ${Number(c?.on_curve ?? 0n) / 1e9}, pool ${Number(c?.on_pool ?? 0n) / 1e9})`, FUNDED,
      buildClaimIxs(FUNDED, fees).ixs, v?.kind === "pumpswap" ? PUMPSWAP_PROGRAM : PUMP_PROGRAM, 300_000);
  }

  // ── SOL transfer ──
  await sim("SystemProgram transfer 0.001 SOL", FUNDED, [buildTransferSolIx(FUNDED, Keypair.generate().publicKey, 1_000_000n)], new PublicKey("11111111111111111111111111111111"), 50_000);

  void getMintInfo;
  console.log(`\n${failures === 0 ? "ALL SIMULATIONS PASSED" : `${failures} FAILED`}`);
  process.exit(failures ? 1 : 0);
})();
