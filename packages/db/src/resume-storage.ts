import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const DEV_KEY = createHash("sha256").update("recruitintel-m11-local-resume-storage").digest();

function keyMaterial(): Buffer {
  const configured = process.env.RESUME_STORAGE_KEY;
  if (!configured) {
    if (process.env.NODE_ENV === "production")
      throw new Error("RESUME_STORAGE_KEY is required in production");
    return DEV_KEY;
  }
  const value = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (value.length !== 32) throw new Error("RESUME_STORAGE_KEY must decode to 32 bytes");
  return value;
}

export interface EncryptedResumeObject {
  storageKey: string;
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: number;
}

export function encryptResumeObject(
  userId: string,
  contentHash: string,
  bytes: Buffer,
): EncryptedResumeObject {
  const storageKey = randomBytes(24).toString("hex");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), nonce);
  cipher.setAAD(Buffer.from(`${userId}:${contentHash}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return { storageKey, ciphertext, nonce, keyVersion: 1 };
}

export function decryptResumeObject(
  userId: string,
  contentHash: string,
  object: { ciphertext: Buffer; nonce: Buffer; storageKey: string },
): Buffer {
  if (!/^[a-f0-9]{48}$/.test(object.storageKey)) throw new Error("Invalid resume storage key");
  if (object.nonce.length !== 12 || object.ciphertext.length < 16)
    throw new Error("Invalid encrypted resume object");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), object.nonce);
  decipher.setAAD(Buffer.from(`${userId}:${contentHash}`, "utf8"));
  decipher.setAuthTag(object.ciphertext.subarray(-16));
  return Buffer.concat([decipher.update(object.ciphertext.subarray(0, -16)), decipher.final()]);
}
