-- Baseline repair: qualify the alert request uniqueness target. In PL/pgSQL,
-- request_fingerprint is also a local variable, so the column-list form of
-- ON CONFLICT is ambiguous. Resolve it through the named unique constraint.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.enqueue_m9_alert_evaluation()'::regprocedure)
    into function_definition;
  execute replace(
    function_definition,
    'on conflict (request_fingerprint)',
    'on conflict on constraint alert_evaluation_requests_request_fingerprint_key'
  );

  select pg_get_functiondef('public.enqueue_m9_interview_alert_evaluation()'::regprocedure)
    into function_definition;
  execute replace(
    function_definition,
    'on conflict (request_fingerprint)',
    'on conflict on constraint alert_evaluation_requests_request_fingerprint_key'
  );

end;
$$;
