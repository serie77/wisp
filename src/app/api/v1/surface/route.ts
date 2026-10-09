import { handle, json } from "@/lib/api";
import { GROUPS } from "@/lib/docs";
import { env } from "@/lib/env";

/** Every route the server dispatches, machine-readable, so a client can check its own coverage. */
export const GET = handle(async () => {
  const routes = GROUPS.flatMap((g) => g.endpoints.map((e) => ({ method: e.method, path: e.path, auth: e.auth, group: g.id, title: e.title })));
  routes.push(
    { method: "GET", path: "/api/v1/surface", auth: false, group: "meta", title: "This list" },
    { method: "GET", path: "/api/v1/treasury", auth: false, group: "treasury", title: "The books" },
    { method: "POST", path: "/api/v1/tokens/:mint/share", auth: true, group: "treasury", title: "Opt a coin into fee sharing" },
    { method: "POST", path: "/api/v1/me/ack", auth: true, group: "identity", title: "Acknowledge inbox" },
    { method: "GET", path: "/ws", auth: false, group: "live", title: "WebSocket event stream" },
    { method: "POST", path: "/mcp/read", auth: false, group: "mcp", title: "Read-only MCP profile" },
  );
  return json({ ok: true, base: env.apiUrl, ws: `${env.apiUrl.replace(/^http/, "ws")}/ws`, count: routes.length, routes });
});
