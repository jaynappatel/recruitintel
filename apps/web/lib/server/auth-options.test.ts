import { describe, expect, it } from "vitest";

import { getSchema } from "better-auth/db";

import {
  AUTH_SCHEMA_VERSION,
  buildAuthOptions,
  sanitizeAuthAccountPersistence,
} from "./auth-options";

describe("Better Auth 1.7.1 contract", () => {
  it("maps the pinned runtime schema to reviewed RecruitIntel tables", () => {
    const schema = getSchema(buildAuthOptions({} as never));
    expect(AUTH_SCHEMA_VERSION).toBe("better-auth@1.7.1");
    expect(Object.keys(schema).sort()).toEqual([
      "auth_verifications",
      "user_identities",
      "user_sessions",
      "users",
    ]);
    expect(Object.keys(schema.users?.fields ?? {})).toEqual([
      "name",
      "email",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
      "status",
      "is_admin",
    ]);
    expect(Object.keys(schema.user_sessions?.fields ?? {})).toEqual([
      "expires_at",
      "token",
      "created_at",
      "updated_at",
      "ip_address",
      "user_agent",
      "user_id",
    ]);
    expect(Object.keys(schema.user_identities?.fields ?? {})).toEqual([
      "issuer",
      "account_id",
      "provider_id",
      "user_id",
      "access_token",
      "refresh_token",
      "id_token",
      "access_token_expires_at",
      "refresh_token_expires_at",
      "scope",
      "password",
      "created_at",
      "updated_at",
    ]);
    expect(Object.keys(schema.auth_verifications?.fields ?? {})).toEqual([
      "identifier",
      "value",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
  });

  it("removes all provider credentials before account persistence", () => {
    const value = sanitizeAuthAccountPersistence({
      accountId: "google-sub",
      providerId: "google",
      accessToken: "access-plaintext",
      refreshToken: "refresh-plaintext",
      idToken: "id-plaintext",
      password: "password-plaintext",
    });
    expect(value).toMatchObject({
      accountId: "google-sub",
      providerId: "google",
      accessToken: null,
      refreshToken: null,
      idToken: null,
      password: null,
    });
    expect(JSON.stringify(value)).not.toContain("plaintext");
  });

  it("rejects an undersized session secret", () => {
    const previous = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "too-short";
    try {
      expect(() => buildAuthOptions({} as never)).toThrow(
        "BETTER_AUTH_SECRET must contain at least 32 characters",
      );
    } finally {
      if (previous === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previous;
    }
  });
});
