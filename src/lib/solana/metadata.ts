/**
 * Token metadata, 222-style: build the JSON, compute its raw CIDv1 locally, store it,
 * and serve it from our own origin at /m/<cid>. Optional Pinata pin when PINATA_JWT is set.
 */
import { env } from "../env";
import { sha256 } from "../crypto";
import { now, one, run } from "../db";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
function base32Lower(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** CIDv1, raw codec, sha2-256 — identical to `ipfs add --cid-version=1` for small files. */
export function computeCidV1Raw(data: Buffer): string {
  return "b" + base32Lower(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), sha256(data)]));
}

export function buildMetadataJson(m: { name: string; symbol: string; description: string; image: string; twitter?: string; website?: string; telegram?: string }): string {
  const obj: Record<string, unknown> = { name: m.name, symbol: m.symbol, description: m.description, image: m.image, showName: true };
  if (m.twitter) obj.twitter = m.twitter;
  if (m.website) obj.website = m.website;
  if (m.telegram) obj.telegram = m.telegram;
  return JSON.stringify(obj);
}

export const blobUrl = (cid: string) => `${env.siteUrl}/m/${cid}`;

export async function storeBlob(data: Buffer, contentType: string): Promise<{ cid: string; url: string }> {
  const cid = computeCidV1Raw(data);
  const existing = await one("SELECT cid FROM blobs WHERE cid = ?", [cid]);
  if (!existing) await run("INSERT INTO blobs (cid, content_type, data, created_at) VALUES (?, ?, ?, ?)", [cid, contentType, data, now()]);
  let url = blobUrl(cid);
  if (env.pinataJwt) {
    const pinned = await pinToPinata(data, cid, contentType).catch(() => null);
    if (pinned) url = pinned;
  }
  return { cid, url };
}

async function pinToPinata(data: Buffer, name: string, contentType: string): Promise<string | null> {
  const form = new FormData();
  form.append("network", "public");
  form.append("file", new Blob([new Uint8Array(data)], { type: contentType }), name);
  const res = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${env.pinataJwt}` }, body: form });
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: { cid?: string } };
  return j.data?.cid ? `https://ipfs.io/ipfs/${j.data.cid}` : null;
}

const DATA_URL = /^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/i;

export async function prepareTokenMetadata(m: { name: string; symbol: string; description?: string; image: string; twitter?: string; website?: string; telegram?: string; metadata_uri?: string }) {
  if (m.metadata_uri) return { uri: m.metadata_uri, imageUrl: m.image, json: null as string | null };
  let imageUrl = m.image;
  const dm = DATA_URL.exec(m.image);
  if (dm) {
    const buf = Buffer.from(dm[3], "base64");
    if (buf.length > 4 * 1024 * 1024) throw new Error("image larger than 4MB");
    imageUrl = (await storeBlob(buf, dm[1].toLowerCase().replace("jpg", "jpeg"))).url;
  } else if (!/^https?:\/\//i.test(m.image)) {
    throw new Error("image must be an https URL or a base64 data URL");
  }
  const json = buildMetadataJson({ name: m.name, symbol: m.symbol, description: m.description ?? "", image: imageUrl, twitter: m.twitter, website: m.website, telegram: m.telegram });
  const { url } = await storeBlob(Buffer.from(json, "utf8"), "application/json");
  return { uri: url, imageUrl, json };
}
