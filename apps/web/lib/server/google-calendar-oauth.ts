import { createHash, randomBytes } from "node:crypto";

import {
  consumeGoogleOauthState,
  createGoogleOauthState,
  getGoogleRefreshCredential,
  markGoogleCalendarReauthRequired,
  saveGoogleCalendarConnection,
} from "@recruitintel/db";

import { calendarCredentialCipher, type CredentialCipher } from "./calendar-token-encryption";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.owned",
] as const;

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_LIST_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

interface CalendarListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    primary?: boolean;
    timeZone?: string;
    accessRole?: string;
  }>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SaveConnectionInput = Parameters<typeof saveGoogleCalendarConnection>[0];
type SaveConnectionResult = Awaited<ReturnType<typeof saveGoogleCalendarConnection>>;

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function googleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleOAuthError("GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth is not configured");
  }
  const parsed = new URL(redirectUri);
  const localHttp =
    parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new GoogleOAuthError(
      "INVALID_GOOGLE_REDIRECT_URI",
      "Google redirect URI must use HTTPS except on localhost",
    );
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new GoogleOAuthError("INVALID_GOOGLE_REDIRECT_URI", "Google redirect URI is invalid");
  }
  return { clientId, clientSecret, redirectUri: parsed.toString() };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function stateHash(state: string): string {
  return sha256(state).toString("hex");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: sha256(verifier).toString("base64url") };
}

export async function createGoogleCalendarAuthorization(
  userId: string,
  dependencies: {
    cipher?: CredentialCipher;
    now?: Date;
    createState?: typeof createGoogleOauthState;
  } = {},
) {
  const config = googleConfig();
  const cipher = dependencies.cipher ?? calendarCredentialCipher();
  const now = dependencies.now ?? new Date();
  const state = randomBytes(32).toString("base64url");
  const pkce = createPkcePair();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
  await (dependencies.createState ?? createGoogleOauthState)({
    userId,
    stateHash: stateHash(state),
    encryptedCodeVerifier: cipher.encrypt(pkce.verifier),
    expiresAt: expiresAt.toISOString(),
    returnTo: "/settings",
  });
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizeUrl: url.toString(), expiresAt: expiresAt.toISOString() };
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new GoogleOAuthError("GOOGLE_INVALID_RESPONSE", "Google returned an invalid response");
  }
}

export async function completeGoogleCalendarAuthorization(
  input: { code: string; state: string; userId: string },
  dependencies: {
    cipher?: CredentialCipher;
    fetch?: FetchLike;
    consumeState?: typeof consumeGoogleOauthState;
    saveConnection?: (input: SaveConnectionInput) => Promise<SaveConnectionResult>;
  } = {},
) {
  const config = googleConfig();
  const fetcher: FetchLike = dependencies.fetch ?? fetch;
  const consumed = await (dependencies.consumeState ?? consumeGoogleOauthState)(
    stateHash(input.state),
  );
  if (!consumed) {
    throw new GoogleOAuthError("INVALID_OAUTH_STATE", "OAuth state is invalid, expired, or reused");
  }
  if (consumed.userId !== input.userId) {
    throw new GoogleOAuthError("INVALID_OAUTH_STATE", "OAuth state does not belong to this user");
  }
  const cipher = dependencies.cipher ?? calendarCredentialCipher();
  let verifier: string;
  try {
    verifier = cipher.decrypt(consumed.encryptedCodeVerifier);
  } catch {
    throw new GoogleOAuthError("INVALID_OAUTH_STATE", "OAuth state could not be validated");
  }
  const tokenResponse = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
  });
  const token = await parseJson<TokenResponse>(tokenResponse);
  if (!tokenResponse.ok || !token.access_token) {
    throw new GoogleOAuthError(
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      token.error === "access_denied" ? "Google access was denied" : "Google token exchange failed",
    );
  }
  const scopes = (token.scope ?? "").split(/\s+/).filter(Boolean);
  const missingCalendarScope = GOOGLE_CALENDAR_SCOPES.slice(2).some(
    (scope) => !scopes.includes(scope),
  );
  if (missingCalendarScope) {
    throw new GoogleOAuthError(
      "GOOGLE_SCOPE_NOT_GRANTED",
      "The required Google Calendar permissions were not granted",
    );
  }
  const userInfoResponse = await fetcher(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  const userInfo = await parseJson<UserInfoResponse>(userInfoResponse);
  if (!userInfoResponse.ok || !userInfo.sub) {
    throw new GoogleOAuthError("GOOGLE_ACCOUNT_LOOKUP_FAILED", "Google account lookup failed");
  }
  const connection = await (dependencies.saveConnection ?? saveGoogleCalendarConnection)({
    userId: consumed.userId,
    providerAccountId: userInfo.sub,
    providerEmail: userInfo.email ?? null,
    encryptedRefreshToken: token.refresh_token ? cipher.encrypt(token.refresh_token) : null,
    scopes,
    tokenMetadata: {
      tokenType: token.token_type ?? "Bearer",
      expiresInSeconds: token.expires_in ?? null,
      refreshCredentialIssued: Boolean(token.refresh_token),
      tokenBinding: "BEARER",
      connectedAt: new Date().toISOString(),
    },
  });
  return { connection, returnTo: consumed.returnTo };
}

export async function consumeGoogleCalendarAuthorizationFailure(
  state: string,
  userId: string,
): Promise<string> {
  const consumed = await consumeGoogleOauthState(stateHash(state));
  if (!consumed) {
    throw new GoogleOAuthError("INVALID_OAUTH_STATE", "OAuth state is invalid, expired, or reused");
  }
  if (consumed.userId !== userId) {
    throw new GoogleOAuthError("INVALID_OAUTH_STATE", "OAuth state does not belong to this user");
  }
  return consumed.returnTo;
}

export async function revokeGoogleCalendarAuthorization(
  userId: string,
  dependencies: { cipher?: CredentialCipher; fetch?: FetchLike } = {},
): Promise<void> {
  const credential = await getGoogleRefreshCredential(userId);
  if (!credential?.encryptedRefreshToken) return;
  const cipher = dependencies.cipher ?? calendarCredentialCipher();
  const fetcher: FetchLike = dependencies.fetch ?? fetch;
  let token: string;
  try {
    token = cipher.decrypt(credential.encryptedRefreshToken);
  } catch {
    return;
  }
  try {
    await fetcher(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Local disconnection still proceeds; a failed best-effort revoke exposes no token.
  }
}

export async function listGoogleCalendarOptions(
  userId: string,
  dependencies: { cipher?: CredentialCipher; fetch?: FetchLike } = {},
) {
  const config = googleConfig();
  const credential = await getGoogleRefreshCredential(userId);
  if (!credential?.encryptedRefreshToken) {
    throw new GoogleOAuthError("GOOGLE_CALENDAR_NOT_CONNECTED", "Google Calendar is not connected");
  }
  const cipher = dependencies.cipher ?? calendarCredentialCipher();
  const fetcher: FetchLike = dependencies.fetch ?? fetch;
  let refreshToken: string;
  try {
    refreshToken = cipher.decrypt(credential.encryptedRefreshToken);
  } catch {
    await markGoogleCalendarReauthRequired(userId, "REFRESH_CREDENTIAL_DECRYPT_FAILED");
    throw new GoogleOAuthError("REAUTH_REQUIRED", "Google Calendar must be reconnected");
  }
  const refreshResponse = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const refreshed = await parseJson<TokenResponse>(refreshResponse);
  if (!refreshResponse.ok || !refreshed.access_token) {
    if (refreshed.error === "invalid_grant") {
      await markGoogleCalendarReauthRequired(userId, "REFRESH_CREDENTIAL_INVALID");
      throw new GoogleOAuthError("REAUTH_REQUIRED", "Google Calendar must be reconnected");
    }
    throw new GoogleOAuthError("GOOGLE_TOKEN_REFRESH_FAILED", "Google token refresh failed");
  }
  const url = new URL(GOOGLE_CALENDAR_LIST_ENDPOINT);
  url.searchParams.set("minAccessRole", "owner");
  url.searchParams.set("fields", "items(id,summary,primary,timeZone,accessRole)");
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${refreshed.access_token}` },
    cache: "no-store",
  });
  const payload = await parseJson<CalendarListResponse>(response);
  if (!response.ok) {
    if ([401, 403].includes(response.status)) {
      await markGoogleCalendarReauthRequired(userId, "PROVIDER_UNAUTHORIZED");
    }
    throw new GoogleOAuthError("GOOGLE_CALENDAR_LIST_FAILED", "Google calendar lookup failed");
  }
  const calendars: Array<{
    id: string;
    summary: string;
    primary: boolean;
    timezone: string | null;
    accessRole: "owner";
  }> = [];
  for (const item of payload.items ?? []) {
    if (!item.id || !item.summary || item.accessRole !== "owner") continue;
    calendars.push({
      id: item.id,
      summary: item.summary,
      primary: item.primary ?? false,
      timezone: item.timeZone ?? null,
      accessRole: "owner",
    });
  }
  return calendars;
}
