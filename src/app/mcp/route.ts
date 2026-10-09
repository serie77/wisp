import { handleRpc, manifest } from "@/lib/mcp";

/** MCP server (JSON-RPC 2.0 over POST). Methods: initialize, tools/list, tools/call, ping. */
export async function GET() { return Response.json({ ok: true, mcp: manifest(), hint: "POST JSON-RPC here: initialize, tools/list, tools/call" }); }
export async function OPTIONS() { return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" } }); }
export async function POST(req: Request) { return handleRpc(req, { readOnly: false }); }
