import { skillMarkdown } from "@/lib/docs";

export const dynamic = "force-static";

export function GET() {
  return new Response(skillMarkdown(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
