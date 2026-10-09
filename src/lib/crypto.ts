import crypto from "node:crypto";
import bs58 from "bs58";
import { env } from "./env";

export function newId(prefix: string): string {
  return `${prefix}_${bs58.encode(crypto.randomBytes(10))}`;
}

export function generateApiKey(): string {
  return `wisp_sk_${bs58.encode(crypto.randomBytes(32))}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** AES-256-GCM. Output: v1:<base64(iv|tag|ciphertext)> */
export function encryptSecret(secret: Uint8Array): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", env.masterKey, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

export function decryptSecret(blob: string): Uint8Array {
  if (!blob.startsWith("v1:")) throw new Error("unknown secret format");
  const buf = Buffer.from(blob.slice(3), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", env.masterKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

export function sha256(data: Buffer | string): Buffer {
  return crypto.createHash("sha256").update(data).digest();
}
