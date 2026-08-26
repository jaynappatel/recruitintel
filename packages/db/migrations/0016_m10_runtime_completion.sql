-- M10 runtime completion: application-linked calendar/alert projections and
-- deterministic interview idempotency. No external provider is required.
alter type public.calendar_item_source add value if not exists 'APPLICATION';

create unique index if not exists application_interviews_idempotency_idx
  on public.application_interviews (user_id, application_id, interview_type, starts_at)
  where status <> 'CANCELLED';
