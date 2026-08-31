import type { BetterAuthOptions } from "better-auth";

import { recordAuditEvent } from "@recruitintel/db";

import { logger } from "./logger";

export const AUTH_SCHEMA_VERSION = "better-auth@1.7.1";

export function sanitizeAuthAccountPersistence<T extends Record<string, unknown>>(account: T): T {
  return {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    password: null,
  };
}

function trustedOrigins(): string[] {
  const configured = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const base = process.env.BETTER_AUTH_URL;
  return [...new Set([...(configured ?? []), ...(base ? [new URL(base).origin] : [])])];
}

function googleProvider() {
  const clientId = process.env.AUTH_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.AUTH_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return {};
  return {
    google: {
      clientId,
      clientSecret,
      scopes: ["openid", "email", "profile"],
      accessType: "online" as const,
      includeGrantedScopes: false,
      requireEmailVerification: true,
    },
  };
}

async function auditSession(
  action: "AUTH_SESSION_CREATED" | "AUTH_SESSION_REVOKED",
  session: { id: string; userId: string },
) {
  try {
    await recordAuditEvent({
      actorKind: "USER",
      actorUserId: session.userId,
      action,
      resourceType: "AUTH_SESSION",
      resourceId: session.id,
      outcome: "SUCCEEDED",
    });
  } catch (error) {
    logger.error("auth_session_audit_failed", error, { action });
  }
}

export function buildAuthOptions(database: BetterAuthOptions["database"]): BetterAuthOptions {
  const isProduction = process.env.NODE_ENV === "production";
  const secret = process.env.BETTER_AUTH_SECRET;
  if (isProduction && !secret) throw new Error("BETTER_AUTH_SECRET is required in production");
  if (secret && secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }

  return {
    appName: "RecruitIntel",
    database,
    baseURL: process.env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: secret ?? "recruitintel-development-auth-secret-change-me",
    trustedOrigins: trustedOrigins(),
    telemetry: { enabled: false },
    socialProviders: googleProvider(),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
      },
    },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        status: {
          type: "string",
          required: true,
          defaultValue: "ACTIVE",
          input: false,
          returned: false,
        },
        isAdmin: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
          returned: false,
          fieldName: "is_admin",
        },
      },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: "user_sessions",
      cookieCache: { enabled: false },
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    account: {
      modelName: "user_identities",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
      storeStateStrategy: "database",
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    databaseHooks: {
      session: {
        create: { after: async (session) => auditSession("AUTH_SESSION_CREATED", session) },
        delete: { after: async (session) => auditSession("AUTH_SESSION_REVOKED", session) },
      },
      account: {
        create: {
          before: async (account) => ({ data: sanitizeAuthAccountPersistence(account) }),
        },
        update: {
          before: async (account) => ({ data: sanitizeAuthAccountPersistence(account) }),
        },
      },
    },
    logger: {
      level: isProduction ? "warn" : "info",
      log(level, message, ...args) {
        if (level === "error") logger.error("better_auth", new Error(message), { args });
        else if (level === "warn") logger.warn("better_auth", { message, args });
        else logger.info("better_auth", { message, args });
      },
    },
  };
}
