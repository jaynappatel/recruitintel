import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const AAD = Buffer.from("recruitintel-calendar-token:v1", "utf8");

export interface CredentialCipher {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");
  if (key.length !== 32) {
    throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export class AesGcmCredentialCipher implements CredentialCipher {
  readonly #key: Buffer;

  constructor(encodedKey: string) {
    this.#key = decodeKey(encodedKey);
  }

  encrypt(plaintext: string): string {
    if (!plaintext) throw new Error("Cannot encrypt an empty credential");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
      VERSION,
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  decrypt(envelope: string): string {
    const [version, nonceValue, ciphertextValue, tagValue, extra] = envelope.split(".");
    if (version !== VERSION || !nonceValue || !ciphertextValue || !tagValue || extra) {
      throw new Error("Encrypted credential envelope is invalid");
    }
    const nonce = Buffer.from(nonceValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) {
      throw new Error("Encrypted credential envelope is invalid");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

export function calendarCredentialCipher(): CredentialCipher {
  const key = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY is required");
  return new AesGcmCredentialCipher(key);
}
