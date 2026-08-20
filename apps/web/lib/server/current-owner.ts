import { DEFAULT_MVP_OWNER_ID } from "@recruitintel/db";
import { databaseUuidSchema } from "@recruitintel/types";

/**
 * Milestone 5 deliberately has no multi-user authentication. Every server route
 * resolves the same configured owner UUID; the browser cannot choose or spoof it.
 */
export function currentOwnerId(): string {
  const configured = process.env.RECRUITINTEL_MVP_OWNER_ID ?? DEFAULT_MVP_OWNER_ID;
  return databaseUuidSchema.parse(configured);
}
