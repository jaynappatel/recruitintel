-- Milestone 15: aggregate-only evidence that recovery and key-rotation drills
-- occurred. This table intentionally has no user, content, credential, or work
-- payload reference; detailed run output belongs in the redacted operator log.
create table public.operational_drills (
  id uuid primary key default gen_random_uuid(),
  drill_type text not null check (drill_type in ('BACKUP_RESTORE', 'KEY_ROTATION', 'DISASTER_RECOVERY', 'PRIVACY_DELETE_RESTORE')),
  environment text not null check (environment in ('LOCAL', 'STAGING', 'PRODUCTION')),
  result text not null check (result in ('PASSED', 'FAILED')),
  completed_at timestamptz not null,
  runbook_version text not null check (length(btrim(runbook_version)) between 1 and 80),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (drill_type, environment, completed_at, evidence_hash)
);

create index operational_drills_recent_idx
  on public.operational_drills (environment, drill_type, completed_at desc);

comment on table public.operational_drills is
  'M15 aggregate recovery evidence only; never store backups, credentials, user IDs, or logs.';
