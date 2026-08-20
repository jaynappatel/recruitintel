import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { saveGoogleCalendarConnection } from "@recruitintel/db";

import { AesGcmCredentialCipher } from "./calendar-token-encryption";
import {
  completeGoogleCalendarAuthorization,
  createGoogleCalendarAuthorization,
  GOOGLE_CALENDAR_SCOPES,
  GoogleOAuthError,
  stateHash,
} from "./google-calendar-oauth";

const ownerId = "00000000-0000-0000-0000-000000000001";

describe("Google Calendar web-server OAuth flow", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    process.env.GOOGLE_REDIRECT_URI =
      "http://localhost:3000/api/integrations/google-calendar/callback";
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  it("persists hashed state and PKCE while returning no verifier", async () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32).toString("base64url"));
    const createState = vi.fn(async () => "2026-08-20T12:10:00.000Z");
    const authorization = await createGoogleCalendarAuthorization(ownerId, {
      cipher,
      now: new Date("2026-08-20T12:00:00.000Z"),
      createState,
    });
    const url = new URL(authorization.authorizeUrl);
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(GOOGLE_CALENDAR_SCOPES);
    expect(createState).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        stateHash: stateHash(state ?? ""),
        encryptedCodeVerifier: expect.stringMatching(/^v1\./),
      }),
    );
    expect(authorization).not.toHaveProperty("state");
  });

  it("rejects invalid or replayed state before token exchange", async () => {
    const fetcher = vi.fn(async () => new Response());
    await expect(
      completeGoogleCalendarAuthorization(
        { code: "code", state: "invalid-state" },
        { consumeState: async () => null, fetch: fetcher },
      ),
    ).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a stable callback failure without retaining provider tokens", async () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32).toString("base64url"));
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      completeGoogleCalendarAuthorization(
        { code: "bad-code", state: "valid-state" },
        {
          cipher,
          consumeState: async () => ({
            ownerId,
            encryptedCodeVerifier: cipher.encrypt("pkce-verifier"),
            returnTo: "/settings",
          }),
          fetch: fetcher,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GoogleOAuthError>>({ code: "GOOGLE_TOKEN_EXCHANGE_FAILED" }),
    );
  });

  it("encrypts refresh credentials and omits access and ID tokens from metadata", async () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32).toString("base64url"));
    const saveConnection = vi.fn(
      async (input: Parameters<typeof saveGoogleCalendarConnection>[0]) => ({
        provider: "GOOGLE" as const,
        status: "CONNECTED" as const,
        accountEmail: input.providerEmail,
        selectedCalendarId: "primary",
        scopes: input.scopes,
        preferences: {
          syncRecruitingDates: true,
          syncApplicationTasks: true,
          syncLeetcode: true,
          syncInterviewPrep: true,
          syncCareerEvents: true,
        },
        lastSyncAt: null,
        lastSyncStatus: null,
        reconnectRequired: false,
        errorCode: null,
      }),
    );
    const fetcher = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            id_token: "id-secret",
            expires_in: 3600,
            token_type: "Bearer",
            scope: GOOGLE_CALENDAR_SCOPES.join(" "),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ sub: "google-sub", email: "user@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await completeGoogleCalendarAuthorization(
      { code: "valid-code", state: "valid-state" },
      {
        cipher,
        consumeState: async () => ({
          ownerId,
          encryptedCodeVerifier: cipher.encrypt("pkce-verifier"),
          returnTo: "/settings",
        }),
        fetch: fetcher,
        saveConnection,
      },
    );
    const saved = saveConnection.mock.calls[0]?.[0];
    expect(cipher.decrypt(saved?.encryptedRefreshToken ?? "")).toBe("refresh-secret");
    expect(JSON.stringify(saved?.tokenMetadata)).not.toContain("access-secret");
    expect(JSON.stringify(saved?.tokenMetadata)).not.toContain("id-secret");
  });
});
