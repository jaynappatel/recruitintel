-- Preserve one active evaluator/fanout lane per exclusive key. A second
-- materiality event is still recorded, but must not fail its parent write;
-- the existing durable worker lane will reconcile it on the next evaluation.
do $$
declare
  definition text;
begin
  foreach definition in array array[
    pg_get_functiondef('public.enqueue_m9_alert_evaluation()'::regprocedure),
    pg_get_functiondef('public.enqueue_m9_interview_alert_evaluation()'::regprocedure)
  ] loop
    definition := replace(definition, 'on conflict (idempotency_fingerprint) do nothing', 'on conflict do nothing');
    execute definition;
  end loop;
end;
$$;
