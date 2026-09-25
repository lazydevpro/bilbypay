import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * AES-256-GCM for gift card codes at rest. `aad` binds a ciphertext to its row (the gift card id),
 * so a ciphertext copied onto another card fails to decrypt.
 */
export function encryptSecret(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(key: Buffer, stored: string, aad: string): string {
  const [version, iv, tag, ct] = stored.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
