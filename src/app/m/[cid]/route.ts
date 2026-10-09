import { one } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ cid: string }> }) {
  const { cid } = await ctx.params;
  const row = await one<{ content_type: string; data: ArrayBuffer | Uint8Array }>("SELECT content_type, data FROM blobs WHERE cid = ?", [cid]);
  if (!row) return new Response("not found", { status: 404 });
  const bytes = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { headers: { "content-type": row.content_type, "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
}
