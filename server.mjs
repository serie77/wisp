/**
 * Wisp server: Next.js + a WebSocket event stream on /ws.
 *   node server.mjs          # production (after `next build`)
 *   node server.mjs --dev    # development
 */
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || "0.0.0.0";

// Shared in-process bus (src/lib/bus.ts attaches to the same global).
const bus = (globalThis.__wispBus ??= Object.assign(new EventEmitter(), { __wisp: true }));
bus.setMaxListeners(0);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => handle(req, res));
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

const send = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (m) => { try { const j = JSON.parse(String(m)); if (j?.kind === "ping") send(ws, { kind: "pong", at: Date.now() }); } catch {} });
  send(ws, { kind: "hello", at: Date.now(), clients: wss.clients.size, note: "Events: post, action, bounty, buyback. Send {\"kind\":\"ping\"} for a pong. Everything here is public; writes go through the HTTP API." });
});
bus.on("event", (ev) => { for (const ws of wss.clients) send(ws, ev); });
const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 25_000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(port, hostname, () => console.log(`> wisp ${dev ? "dev" : "prod"} on http://${hostname}:${port}  (ws: /ws)`));
