-- M9 follow-up: observation-count carry-forward alone is not alert material.
create function public.enqueue_m9_interview_alert_evaluation()
returns trigger language plpgsql set search_path = public as $$
declare
  request_id uuid;
  request_trigger public.alert_evaluation_trigger;
  request_fingerprint text;
  interview_question uuid;
  request_context jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' and old.last_seen_at = new.last_seen_at
      and old.confidence = new.confidence
      and old.role_family is not distinct from new.role_family
      and old.interview_stage is not distinct from new.interview_stage then
    return new;
  end if;
  request_trigger := 'INTERVIEW_INTELLIGENCE'; interview_question := new.id;
  request_context := '{"eventKind":"INTERVIEW_INTELLIGENCE_UPDATED"}'::jsonb;
  request_fingerprint := encode(digest(
    'm9:interview:' || new.id::text || ':' || new.last_seen_at::text || ':' ||
    coalesce(new.role_family::text, '') || ':' || coalesce(new.interview_stage, ''),
    'sha256'), 'hex');
  insert into public.alert_evaluation_requests (
    user_id, trigger_type, company_interview_question_id, request_fingerprint, safe_context
  ) values (null, request_trigger, interview_question, request_fingerprint, request_context)
  on conflict (request_fingerprint) do update set request_fingerprint = excluded.request_fingerprint
  returning id into request_id;
  insert into public.work_items (
    work_type, work_class, alert_evaluation_request_id, priority,
    idempotency_fingerprint, exclusive_key, correlation_id
  ) values (
    'ALERT_FANOUT', 'PERSONALIZATION', request_id, 55,
    encode(digest('m9:fanout:' || request_id::text || ':root', 'sha256'), 'hex'),
    'm9-alert-fanout:' || request_id::text, gen_random_uuid()
  ) on conflict (idempotency_fingerprint) do nothing;
  return new;
end;
$$;

drop trigger if exists interview_intelligence_enqueue_alert_evaluation
  on public.company_interview_questions;
create trigger interview_intelligence_enqueue_alert_evaluation
after insert or update of observation_count, last_seen_at, confidence, role_family, interview_stage
on public.company_interview_questions
for each row execute function public.enqueue_m9_interview_alert_evaluation();
