import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AesGcmCredentialCipher } from "./calendar-token-encryption";
import { createPkcePair, stateHash } from "./google-calendar-oauth";

describe("Google Calendar OAuth credential controls", () => {
  it("encrypts and decrypts refresh credentials without plaintext in the envelope", () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32).toString("base64url"));
    const token = "refresh-secret-value";
    const encrypted = cipher.encrypt(token);
    expect(encrypted).not.toContain(token);
    expect(cipher.decrypt(encrypted)).toBe(token);
  });

  it("rejects tampered encrypted credentials", () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32).toString("base64url"));
    const encrypted = cipher.encrypt("refresh-secret-value");
    const parts = encrypted.split(".");
    parts[3] = `${parts[3]?.startsWith("A") ? "B" : "A"}${parts[3]?.slice(1)}`;
    expect(() => cipher.decrypt(parts.join("."))).toThrow();
  });

  it("generates S256-compatible PKCE values and one-way OAuth state hashes", () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stateHash("state-one")).toMatch(/^[0-9a-f]{64}$/);
    expect(stateHash("state-one")).not.toBe(stateHash("state-two"));
  });
});
