import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const databaseRole = process.env.RECRUITINTEL_DB_ROLE;
const principalId = process.env.RECRUITINTEL_SERVICE_PRINCIPAL_ID;
const capabilityRole = process.env.RECRUITINTEL_CAPABILITY_ROLE;
const classes = (process.env.RECRUITINTEL_WORK_CLASSES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedCapabilityRoles = new Set([
  "recruitintel_scheduler",
  "recruitintel_worker_global",
  "recruitintel_worker_calendar",
  "recruitintel_worker_privacy",
]);
const allowedClasses = new Set([
  "ATS",
  "GITHUB",
  "WEB_SEARCH",
  "WEB_FETCH",
  "PROJECTION",
  "CALENDAR",
  "PRIVACY",
  "CONTROL",
]);
const capabilityContract = {
  recruitintel_scheduler: {
    scope: "WORKER_SCHEDULER",
    classes: new Set(["CONTROL"]),
  },
  recruitintel_worker_global: {
    scope: "WORKER_GLOBAL",
    classes: new Set(["ATS", "GITHUB", "WEB_SEARCH", "WEB_FETCH", "PROJECTION", "CONTROL"]),
  },
  recruitintel_worker_calendar: {
    scope: "WORKER_CALENDAR_SYNC",
    classes: new Set(["CALENDAR"]),
  },
  recruitintel_worker_privacy: {
    scope: "WORKER_PRIVACY",
    classes: new Set(["PRIVACY"]),
  },
};
if (!databaseRole || !/^[a-z_][a-z0-9_]{0,62}$/.test(databaseRole)) {
  throw new Error("RECRUITINTEL_DB_ROLE must be a safe existing PostgreSQL login role");
}
if (!principalId || !/^[0-9a-f-]{36}$/i.test(principalId)) {
  throw new Error("RECRUITINTEL_SERVICE_PRINCIPAL_ID is required");
}
if (!capabilityRole || !allowedCapabilityRoles.has(capabilityRole)) {
  throw new Error("RECRUITINTEL_CAPABILITY_ROLE is invalid");
}
if (!classes.length || classes.some((item) => !allowedClasses.has(item))) {
  throw new Error("RECRUITINTEL_WORK_CLASSES must contain enumerated work classes");
}
const contract = capabilityContract[capabilityRole];
if (classes.some((item) => !contract.classes.has(item))) {
  throw new Error("RECRUITINTEL_WORK_CLASSES exceeds the selected capability role");
}
const canSchedule = capabilityRole === "recruitintel_scheduler";
const sql = postgres(databaseUrl, { max: 1 });

try {
  const [principal] = await sql`
    select id from public.service_principals
    where id = ${principalId}::uuid and kind = 'WORKER' and status = 'ACTIVE'
      and (expires_at is null or expires_at > now())
      and ${contract.scope}::public.service_scope = any(scopes)
  `;
  if (!principal)
    throw new Error("Active worker service principal with required scope was not found");
  await sql.unsafe(`grant ${capabilityRole} to ${databaseRole}`);
  await sql`
    insert into public.worker_role_bindings (
      database_role, service_principal_id, allowed_work_classes, can_schedule
    ) values (
      ${databaseRole}, ${principalId}::uuid, ${classes}::public.work_class[], ${canSchedule}
    )
    on conflict (database_role) do update set
      service_principal_id = excluded.service_principal_id,
      allowed_work_classes = excluded.allowed_work_classes,
      can_schedule = excluded.can_schedule
  `;
  console.log(JSON.stringify({ databaseRole, principalId, capabilityRole, classes, canSchedule }));
} finally {
  await sql.end();
}
