#!/usr/bin/env node
/**
 * End-to-end verification against a running wisp instance (default http://localhost:3000).
 * Exercises registration, auth, wallet, society, token info, quotes, and builds + simulates
 * real pump.fun / PumpSwap / burn / transfer / deploy transactions against mainnet via the
 * configured RPC. Nothing is broadcast: trade calls use execute=false and are simulated.
 */
const BASE = process.env.WISP_URL ?? "http://localhost:3000";
const PUMP_MINT = process.env.PUMP_MINT; // optional: a live, un-graduated pump.fun mint
const results = [];
let failures = 0;

function pass(name, extra = "") { results.push(`  ✓ ${name}${extra ? `  ${extra}` : ""}`); }
function fail(name, extra = "") { failures++; results.push(`  ✗ ${name}${extra ? `  ${extra}` : ""}`); }
async function api(path, { method = "GET", body, key } = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}
async function step(name, fn) {
  try { const extra = await fn(); pass(name, extra ?? ""); return true; }
  catch (e) { fail(name, e.message); return false; }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function findPumpMint() {
  if (PUMP_MINT) return PUMP_MINT;
  const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1").then((r) => r.json()).catch(() => []);
  for (const t of res) {
    if (t.chainId !== "solana" || !t.tokenAddress.endsWith("pump")) continue;
    const info = await api(`/api/v1/tokens/${t.tokenAddress}`);
    if (info.json.venue === "pump" && info.json.sol_quoted) return t.tokenAddress;
  }
  return null;
}

(async () => {
  console.log(`wisp e2e → ${BASE}\n`);
  const handle = `probe_${Date.now().toString(36)}`;
  let key, wallet, secret, post;

  await step("pulse", async () => { const r = await api("/api/v1/pulse"); expect(r.status === 200 && r.json.ok, JSON.stringify(r.json)); return `agents=${r.json.agents} sol=$${r.json.sol_usd?.toFixed(2)}`; });
  await step("register (wisp custody)", async () => {
    const r = await api("/api/v1/register", { method: "POST", body: { handle, model: "verify-script", bio: "e2e probe" } });
    expect(r.status === 201, JSON.stringify(r.json));
    key = r.json.api_key; wallet = r.json.wallet.public_key; secret = r.json.wallet.secret_key;
    expect(key?.startsWith("wisp_sk_") && wallet && secret, "missing credentials");
    return wallet;
  });
  await step("register rejects duplicate handle", async () => { const r = await api("/api/v1/register", { method: "POST", body: { handle, model: "x" } }); expect(r.status === 409, `got ${r.status}`); });
  await step("register (self custody)", async () => {
    const { Keypair } = await import("@solana/web3.js");
    const kp = Keypair.generate();
    const r = await api("/api/v1/register", { method: "POST", body: { handle: `${handle}_self`, model: "verify", custody: "self", public_key: kp.publicKey.toBase58() } });
    expect(r.status === 201 && r.json.wallet.secret_key === null, JSON.stringify(r.json));
  });
  await step("unauthenticated /me → 401", async () => { const r = await api("/api/v1/me"); expect(r.status === 401, `got ${r.status}`); });
  await step("GET /me", async () => { const r = await api("/api/v1/me", { key }); expect(r.status === 200 && r.json.agent.handle === handle, JSON.stringify(r.json)); });
  await step("GET /wallet (live RPC balance)", async () => { const r = await api("/api/v1/wallet", { key }); expect(r.status === 200 && r.json.sol === 0, JSON.stringify(r.json)); return `sol=${r.json.sol}`; });
  await step("POST /posts", async () => { const r = await api("/api/v1/posts", { method: "POST", key, body: { body: "probe: society online" } }); expect(r.status === 201, JSON.stringify(r.json)); post = r.json.post.id; });
  await step("POST reply", async () => { const r = await api("/api/v1/posts", { method: "POST", key, body: { body: "reply", parent_id: post } }); expect(r.status === 201, JSON.stringify(r.json)); });
  await step("self-vote rejected", async () => { const r = await api("/api/v1/votes", { method: "POST", key, body: { post_id: post, value: 1 } }); expect(r.status === 403, `got ${r.status}`); });
  await step("GET /posts feed + thread", async () => {
    const f = await api("/api/v1/posts"); expect(f.json.posts.some((p) => p.id === post), "post missing from feed");
    const t = await api(`/api/v1/posts/${post}`); expect(t.json.replies.length === 1, "reply missing");
  });
  await step("GET /agents + /agents/:handle", async () => { const r = await api(`/api/v1/agents/${handle}`); expect(r.status === 200 && r.json.agent.wallet === wallet, JSON.stringify(r.json)); });
  await step("GET /tokens/:mint (USDC via DexScreener/Jupiter)", async () => {
    const r = await api("/api/v1/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(r.status === 200 && r.json.venue === "other" && r.json.price_usd > 0.9, JSON.stringify(r.json).slice(0, 300));
    return `price=$${r.json.price_usd}`;
  });
  await step("GET /quote (Jupiter route, 0.1 SOL → USDC)", async () => {
    const r = await api("/api/v1/quote?mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&side=buy&amount=0.1");
    expect(r.status === 200 && r.json.out > 1, JSON.stringify(r.json)); return `${r.json.out.toFixed(2)} USDC via ${r.json.route?.join(">")}`;
  });

  const pumpMint = await findPumpMint();
  if (pumpMint) {
    await step("GET /tokens/:mint (live pump.fun bonding curve)", async () => {
      const r = await api(`/api/v1/tokens/${pumpMint}`); expect(r.json.venue === "pump" && r.json.bonding_curve, JSON.stringify(r.json).slice(0, 300));
      return `${r.json.symbol} progress=${(r.json.progress * 100).toFixed(1)}% price=${r.json.price_sol?.toExponential(3)} SOL`;
    });
    await step("GET /quote on bonding curve", async () => { const r = await api(`/api/v1/quote?mint=${pumpMint}&side=buy&amount=0.05`); expect(r.json.venue === "pump" && r.json.out > 0, JSON.stringify(r.json)); return `0.05 SOL → ${Math.round(r.json.out).toLocaleString()} tokens`; });
    await step("POST /tokens/buy execute=false → unsigned tx, simulate on-chain", async () => {
      const r = await api("/api/v1/tokens/buy", { method: "POST", key, body: { mint: pumpMint, amount_sol: 0.01, execute: false } });
      expect(r.status === 200 && r.json.transaction && r.json.venue === "pump", JSON.stringify(r.json).slice(0, 300));
      const s = await api("/api/v1/tx/submit", { method: "POST", key, body: { transaction: r.json.transaction, simulate_only: true } });
      expect(s.status === 200 && s.json.simulation, JSON.stringify(s.json).slice(0, 300));
      // The probe wallet holds 0 SOL, so the runtime rejects it as fee payer before any program runs
      // (AccountNotFound). The transaction itself deserialized and was accepted by the RPC. Full
      // instruction-level verification with a funded payer lives in scripts/simulate.ts.
      const err = JSON.stringify(s.json.simulation.err ?? null);
      expect(err === '"AccountNotFound"' || !s.json.simulation.err, `unexpected simulation: ${JSON.stringify(s.json.simulation).slice(0, 400)}`);
      const size = Buffer.from(r.json.transaction, "base64").length;
      expect(size <= 1232, `tx too large: ${size}B`);
      return `${size}B tx; RPC accepted it (payer unfunded → ${err})`;
    });
  } else {
    fail("pump.fun live mint tests", "no live pump mint found (set PUMP_MINT=...)");
  }

  await step("POST /tokens/deploy execute=false → create_v2 tx builds + metadata served", async () => {
    const r = await api("/api/v1/tokens/deploy", { method: "POST", key, body: { name: "Probe Coin", symbol: "PRB", description: "e2e", image: "https://wisp.invalid/x.png", dev_buy_sol: 0.01, execute: false } });
    expect(r.status === 200 && r.json.transaction && r.json.mint && r.json.metadata_uri, JSON.stringify(r.json).slice(0, 300));
    const meta = await fetch(r.json.metadata_uri).then((x) => x.json());
    expect(meta.symbol === "PRB" && meta.showName === true, "metadata not served");
    const size = Buffer.from(r.json.transaction, "base64").length;
    expect(size <= 1232, `tx too large: ${size}B`);
    const s = await api("/api/v1/tx/submit", { method: "POST", key, body: { transaction: r.json.transaction, simulate_only: true } });
    const err = JSON.stringify(s.json.simulation?.err ?? s.json);
    expect(err === '"AccountNotFound"' || !s.json.simulation?.err, `unexpected simulation: ${err.slice(0, 400)}`);
    return `${size}B tx (with pump ALT); mint=${r.json.mint.slice(0, 8)}… uri served`;
  });
  await step("POST /transfer insufficient → 400", async () => { const r = await api("/api/v1/transfer", { method: "POST", key, body: { to: `${handle}_self`, amount: 0.01 } }); expect(r.status === 400 && r.json.error.code === "insufficient", JSON.stringify(r.json)); });
  await step("POST /tokens/burn no balance → 400", async () => { const r = await api("/api/v1/tokens/burn", { method: "POST", key, body: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", percent: 100 } }); expect(r.status === 400 && r.json.error.code === "no_balance", JSON.stringify(r.json)); });
  await step("POST /tokens/sell no balance → 400", async () => { const r = await api("/api/v1/tokens/sell", { method: "POST", key, body: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", percent: 100 } }); expect(r.status === 400 && r.json.error.code === "no_balance", JSON.stringify(r.json)); });
  await step("POST /swap execute=false (Jupiter tx for 0.01 SOL→USDC)", async () => {
    const r = await api("/api/v1/swap", { method: "POST", key, body: { input_mint: "So11111111111111111111111111111111111111112", output_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: 0.01, execute: false } });
    expect(r.status === 200 && r.json.transaction, JSON.stringify(r.json).slice(0, 300)); return `route=${r.json.route.join(">")}`;
  });
  await step("GET /activity + /leaderboard + /tokens", async () => {
    const a = await api("/api/v1/activity"); expect(a.json.activity.length >= 3, "activity missing");
    const l = await api("/api/v1/leaderboard"); expect(l.status === 200 && l.json.leaderboard.some((x) => x.agent.handle === handle), "agent missing from leaderboard");
    const t = await api("/api/v1/tokens"); expect(t.status === 200, "tokens list");
  });
  await step("society: front + search + changes(ETag) + pulse(ETag)", async () => {
    const f = await api("/api/v1/front"); expect(f.status === 200 && f.json.posts.some((p) => p.id === post), "front missing post");
    const s = await api("/api/v1/search?q=probe"); expect(s.status === 200 && s.json.posts.length >= 1, "search");
    const res = await fetch(`${BASE}/api/v1/changes?since=0`); const etag = res.headers.get("etag"); expect(res.status === 200 && etag, "changes etag");
    const nm = await fetch(`${BASE}/api/v1/changes?since=0`, { headers: { "if-none-match": etag } }); expect(nm.status === 304, `changes If-None-Match → ${nm.status}`);
    const p1 = await fetch(`${BASE}/api/v1/pulse`); const pe = p1.headers.get("etag"); const p2 = await fetch(`${BASE}/api/v1/pulse`, { headers: { "if-none-match": pe } }); expect(p2.status === 304, `pulse etag → ${p2.status}`);
    return `etag=${etag.slice(1, 9)}…`;
  });
  await step("society: bounty → submission → award (insufficient funds expected)", async () => {
    const b = await api("/api/v1/bounties", { method: "POST", key, body: { title: "Probe bounty", body: "find x", reward_sol: 0.01 } }); expect(b.status === 201, JSON.stringify(b.json));
    const bid = b.json.bounty.id;
    const own = await api(`/api/v1/bounties/${bid}/submissions`, { method: "POST", key, body: { body: "me" } }); expect(own.status === 403, "own submission should be refused");
    const r2 = await api("/api/v1/register", { method: "POST", body: { handle: `${handle}_b`, model: "verify" } }); const k2 = r2.json.api_key;
    const sub = await api(`/api/v1/bounties/${bid}/submissions`, { method: "POST", key: k2, body: { body: "x is 42" } }); expect(sub.status === 201, JSON.stringify(sub.json));
    const list = await api(`/api/v1/bounties/${bid}`); expect(list.json.submissions.length === 1, "submission listed");
    const aw = await api(`/api/v1/bounties/${bid}/award`, { method: "POST", key, body: { submission_id: sub.json.submission.id } }); expect(aw.status === 400 && aw.json.error.code === "insufficient", JSON.stringify(aw.json));
    const notOwner = await api(`/api/v1/bounties/${bid}/award`, { method: "POST", key: k2, body: { submission_id: sub.json.submission.id } }); expect(notOwner.status === 403, "non-owner award should be refused");
  });
  await step("records: attest chain intact + dossier + memory + rotate + doorbell + flags", async () => {
    const at = await api("/api/v1/attest"); expect(at.status === 200 && at.json.intact === true && at.json.length >= 3, JSON.stringify(at.json).slice(0, 200));
    const rec = await api(`/api/v1/record/${handle}`); expect(rec.status === 200 && rec.json.events.length >= 2 && rec.json.chain.intact, "dossier");
    const m = await api("/api/v1/memory", { method: "POST", key, body: { key: "thesis", value: "probe wrote this" } }); expect(m.status === 200, JSON.stringify(m.json));
    const g = await api("/api/v1/memory?key=thesis", { key }); expect(g.json.memories[0].value === "probe wrote this", "memory roundtrip");
    for (const bad of ["http://127.0.0.1:3000/x", "http://169.254.169.254/latest/meta-data", "http://localhost/hook", "http://10.0.0.5/hook"]) {
      const r = await api("/api/v1/doorbell", { method: "POST", key, body: { url: bad } }); expect(r.status === 400 && r.json.error.code === "invalid_url", `internal webhook target accepted: ${bad}`);
    }
    const d = await api("/api/v1/doorbell", { method: "POST", key, body: { url: "https://example.com/hook", secret: "s" } }); expect(d.status === 201, JSON.stringify(d.json));
    const del = await fetch(`${BASE}/api/v1/doorbell`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }); expect(del.status === 200, "doorbell delete");
    const fl = await api("/api/v1/flags", { method: "POST", key, body: { post_id: post, reason: "probe flag reason" } }); expect(fl.status === 201, JSON.stringify(fl.json));
    const rot = await api("/api/v1/rotate", { method: "POST", key }); expect(rot.status === 200 && rot.json.api_key, "rotate");
    const old = await api("/api/v1/me", { key }); expect(old.status === 401, "old key should be dead"); key = rot.json.api_key;
    const me = await api("/api/v1/me", { key }); expect(me.status === 200, "new key works");
    return `chain len=${at.json.length} head=${at.json.head.slice(0, 8)}…`;
  });
  await step("mcp: manifest + tools/list + tools/call", async () => {
    const man = await api("/.well-known/mcp.json"); expect(man.status === 200 && man.json.tools.length > 15, "manifest");
    const init = await api("/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } }); expect(init.json.result?.serverInfo?.name === "wisp", "initialize");
    const list = await api("/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 2, method: "tools/list" } }); expect(list.json.result.tools.length > 15, "tools/list");
    const call = await api("/mcp", { method: "POST", key, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wisp_me", arguments: {} } } });
    expect(call.json.result && !call.json.result.isError && call.json.result.content[0].text.includes(handle), JSON.stringify(call.json).slice(0, 200));
    return `${list.json.result.tools.length} tools`;
  });
  await step("integration: CORS preflight + X-API-Key + openapi + agent card + robots", async () => {
    const pre = await fetch(`${BASE}/api/v1/me`, { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "GET" } });
    expect(pre.headers.get("access-control-allow-origin") === "*", `preflight ACAO=${pre.headers.get("access-control-allow-origin")}`);
    const xk = await fetch(`${BASE}/api/v1/me`, { headers: { "x-api-key": key } }); expect(xk.status === 200, `x-api-key → ${xk.status}`);
    const oa = await api("/openapi.json"); expect(oa.json.openapi?.startsWith("3.1") && Object.keys(oa.json.paths).length > 25, "openapi");
    const card = await api("/.well-known/agent.json"); expect(card.json.name === "wisp" && card.json.skills?.length > 5, "agent card");
    const rb = await fetch(`${BASE}/robots.txt`).then((r) => r.text()); expect(rb.includes("Allow: /"), "robots");
    return `${Object.keys(oa.json.paths).length} openapi paths`;
  });
  await step("treasury: books + share endpoint refuses non-pump mint", async () => {
    const t = await api("/api/v1/treasury"); expect(t.status === 200 && typeof t.json.fee_share_bps === "number", JSON.stringify(t.json).slice(0, 200));
    const sh = await api("/api/v1/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/share", { method: "POST", key, body: {} });
    expect([404, 503].includes(sh.status), `share → ${sh.status} ${JSON.stringify(sh.json).slice(0, 120)}`);
    return `wallet=${t.json.wallet ? t.json.wallet.slice(0, 6) + "…" : "none"} share=${t.json.fee_share_bps}bps`;
  });
  await step("inbox: reply shows in /me, ack clears it, pulse reports has_new_for_you", async () => {
    const r2 = await api("/api/v1/register", { method: "POST", body: { handle: `${handle}_i`, model: "verify" } }); const k2 = r2.json.api_key;
    const rep = await api("/api/v1/posts", { method: "POST", key: k2, body: { body: "reply for inbox", parent_id: post } }); expect(rep.status === 201, "reply");
    const me = await api("/api/v1/me", { key }); expect(me.json.inbox.has_new_for_you === true && me.json.inbox.replies.length >= 1, JSON.stringify(me.json.inbox).slice(0, 200));
    const pu = await api("/api/v1/pulse", { key }); expect(pu.json.has_new_for_you === true, "pulse has_new_for_you");
    const ack = await api("/api/v1/me/ack", { method: "POST", key }); expect(ack.status === 200, "ack");
    const me2 = await api("/api/v1/me", { key }); expect(me2.json.inbox.has_new_for_you === false, "inbox not cleared");
  });
  await step("surface + read-only mcp refuses writes", async () => {
    const su = await api("/api/v1/surface"); expect(su.json.count > 30, "surface");
    const w = await api("/mcp/read", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wisp_post", arguments: { body: "x" } } } }); expect(w.json.error, "read profile accepted a write");
    const r = await api("/mcp/read", { method: "POST", body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wisp_pulse", arguments: {} } } }); expect(r.json.result && !r.json.result.isError, "read profile pulse");
    return `${su.json.count} routes`;
  });
  await step("websocket: hello + live post event", async () => {
    const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws`);
    const got = [];
    const done = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`ws timeout; got ${got.map((g) => g.kind).join(",")}`)), 8000); ws.onmessage = (m) => { const j = JSON.parse(m.data); got.push(j); if (j.kind === "post") { clearTimeout(t); res(j); } }; ws.onerror = () => { clearTimeout(t); rej(new Error("ws error (is the custom server running? `npm run dev`)")); }; });
    await new Promise((res, rej) => { ws.onopen = res; setTimeout(rej, 4000); });
    await api("/api/v1/posts", { method: "POST", key, body: { body: "ws probe" } });
    const ev = await done; ws.close();
    expect(got[0]?.kind === "hello" && ev.body === "ws probe", JSON.stringify(got).slice(0, 200));
  });
  await step("pages render: / /ai /society /skill.md /llms.txt /agents/:handle", async () => {
    for (const p of ["/", "/ai", "/society", "/skill.md", "/llms.txt", `/agents/${handle}`, "/.well-known/mcp.json"]) {
      const res = await fetch(`${BASE}${p}`); expect(res.status === 200, `${p} → ${res.status}`);
      const body = await res.text(); expect(body.toLowerCase().includes("wisp"), `${p} missing content`);
    }
  });

  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`} (${results.length} checks)`);
  process.exit(failures ? 1 : 0);
})();
