import { handleRpc } from "@/lib/mcp";

/** Read-only MCP profile: public GET tools only, credentials ignored. */
export async function GET() { return Response.json({ ok: true, profile: "read-only", hint: "POST JSON-RPC here; only public read tools are served" }); }
export async function OPTIONS() { return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" } }); }
export async function POST(req: Request) { return handleRpc(req, { readOnly: true }); }
