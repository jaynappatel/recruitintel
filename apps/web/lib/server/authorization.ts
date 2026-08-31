import { createHash, randomUUID } from "node:crypto";

import {
  activatePendingUser,
  authenticateExtensionGrant,
  authenticateServicePrincipal,
  type ExtensionGrantRecord,
  type ExtensionGrantScope,
  getUserActor,
  hasActiveBetaAccess,
  type ServicePrincipalRecord,
  type ServiceScope,
  type UserActorRecord,
} from "@recruitintel/db";

import { apiError, databaseApiError } from "../api";
import { auth } from "./auth";

export type UserActor = {
  kind: "USER" | "ADMIN";
  user: UserActorRecord;
  requestId: string;
  ipHash: string | null;
};

export type ServiceActor = {
  kind: "SERVICE";
  servicePrincipal: ServicePrincipalRecord;
  requestId: string;
  ipHash: string | null;
};

export type ExtensionActor = {
  kind: "EXTENSION";
  grant: ExtensionGrantRecord;
  requestId: string;
  ipHash: string | null;
};

export class AuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

function resolveRequestId(request: Request): string {
  const value = request.headers.get("x-request-id");
  return value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

function requestIpHash(request: Request): string | null {
  const salt = process.env.AUDIT_IP_HASH_KEY;
  if (!salt) return null;
  const address = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  if (!address) return null;
  return createHash("sha256").update(`${salt}\0${address}`).digest("hex");
}

function assertSameOriginMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set([
    new URL(request.url).origin,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? []),
  ]);
  if (!allowed.has(origin)) {
    throw new AuthorizationError(403, "FORBIDDEN", "Cross-origin mutation was rejected");
  }
}

export async function requireAuthenticatedUser(
  request: Request,
  options: { mutation?: boolean } = {},
): Promise<UserActor> {
  if (options.mutation) assertSameOriginMutation(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  let user = await getUserActor(session.user.id);
  if (user?.status === "PENDING_IDENTITY" && session.user.emailVerified) {
    await activatePendingUser(user.id, session.user.email);
    user = await getUserActor(user.id);
  }
  if (!user || user.status !== "ACTIVE") {
    throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  if (process.env.PRIVATE_BETA_MODE === "true" && !user.isAdmin) {
    if (!(await hasActiveBetaAccess(user.email))) {
      throw new AuthorizationError(403, "FORBIDDEN", "Private beta access is required");
    }
  }
  return {
    kind: user.isAdmin ? "ADMIN" : "USER",
    user,
    requestId: resolveRequestId(request),
    ipHash: requestIpHash(request),
  };
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function extensionOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : null;
}

export function extensionCorsHeaders(request: Request): HeadersInit {
  const origin = extensionOrigin(request);
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        vary: "Origin",
      }
    : {};
}

export async function requireExtensionGrant(
  request: Request,
  scope: ExtensionGrantScope,
): Promise<ExtensionActor> {
  if (request.method !== "GET" && request.method !== "OPTIONS" && !extensionOrigin(request)) {
    throw new AuthorizationError(403, "FORBIDDEN", "Extension origin was rejected");
  }
  const token = bearerToken(request);
  if (!token) throw new AuthorizationError(401, "UNAUTHENTICATED", "Extension grant is required");
  const grant = await authenticateExtensionGrant(token, scope, requestIpHash(request));
  if (!grant) throw new AuthorizationError(401, "UNAUTHENTICATED", "Extension grant is invalid");
  return {
    kind: "EXTENSION",
    grant,
    requestId: resolveRequestId(request),
    ipHash: requestIpHash(request),
  };
}

export async function requireAdmin(
  request: Request,
  scope: ServiceScope = "ADMIN_MUTATE",
): Promise<UserActor | ServiceActor> {
  const token = bearerToken(request);
  if (token) {
    const ipHash = requestIpHash(request);
    const servicePrincipal = await authenticateServicePrincipal(token, scope, ipHash);
    if (!servicePrincipal) {
      throw new AuthorizationError(401, "UNAUTHENTICATED", "Administrative authentication failed");
    }
    return {
      kind: "SERVICE",
      servicePrincipal,
      requestId: resolveRequestId(request),
      ipHash,
    };
  }
  const actor = await requireAuthenticatedUser(request, { mutation: request.method !== "GET" });
  if (!actor.user.isAdmin) {
    throw new AuthorizationError(403, "FORBIDDEN", "Administrative access is required");
  }
  return actor;
}

export function authorizationApiError(error: unknown) {
  if (error instanceof AuthorizationError) return apiError(error.status, error.code, error.message);
  return databaseApiError(error);
}

export async function authenticatedUserOrResponse(
  request: Request,
  options: { mutation?: boolean } = {},
) {
  try {
    return await requireAuthenticatedUser(request, options);
  } catch (error) {
    return authorizationApiError(error);
  }
}

export async function optionalAuthenticatedUser(request: Request): Promise<UserActor | null> {
  try {
    return await requireAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return null;
    throw error;
  }
}
