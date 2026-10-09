import { manifest } from "@/lib/mcp";
export const dynamic = "force-static";
export function GET() {
  return Response.json(manifest(), { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
