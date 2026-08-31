import { getDatabase } from "./index";

export class BetaAccessNotFoundError extends Error {}
export class BetaAccessValidationError extends Error {}

const normalizedEmail = (value: string) => value.trim().toLowerCase();
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export interface BetaAccessGrant {
  id: string;
  email: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  revokedAt: string | null;
}

function map(row: Record<string, unknown>): BetaAccessGrant {
  return {
    id: String(row.id),
    email: String(row.email),
    status: String(row.status) as BetaAccessGrant["status"],
    createdAt: new Date(row.created_at as string).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string).toISOString() : null,
  };
}

export async function hasActiveBetaAccess(email: string): Promise<boolean> {
  const [row] = await getDatabase()`select id from public.beta_access_grants
    where email=${normalizedEmail(email)} and status='ACTIVE'`;
  return Boolean(row);
}

export async function listBetaAccessGrants(): Promise<BetaAccessGrant[]> {
  const rows = await getDatabase()`select id,email,status::text,created_at,revoked_at
    from public.beta_access_grants order by status,email`;
  return rows.map(map);
}

export async function grantBetaAccess(
  adminUserId: string,
  email: string,
): Promise<BetaAccessGrant> {
  const normalized = normalizedEmail(email);
  if (!validEmail(normalized)) throw new BetaAccessValidationError("Email is invalid");
  const [row] = await getDatabase()`insert into public.beta_access_grants
    (email,status,granted_by_user_id,revoked_at,revoked_by_user_id)
    values (${normalized},'ACTIVE',${adminUserId}::uuid,null,null)
    on conflict (email) do update set status='ACTIVE',granted_by_user_id=excluded.granted_by_user_id,
      revoked_at=null,revoked_by_user_id=null
    returning id,email,status::text,created_at,revoked_at`;
  if (!row) throw new Error("Beta access grant was not returned");
  return map(row);
}

export async function revokeBetaAccess(
  adminUserId: string,
  grantId: string,
): Promise<BetaAccessGrant> {
  const [row] = await getDatabase()`update public.beta_access_grants set status='REVOKED',
    revoked_at=coalesce(revoked_at,now()),revoked_by_user_id=${adminUserId}::uuid
    where id=${grantId}::uuid returning id,email,status::text,created_at,revoked_at`;
  if (!row) throw new BetaAccessNotFoundError("Beta access grant not found");
  return map(row);
}
