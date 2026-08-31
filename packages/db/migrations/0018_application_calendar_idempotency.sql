create unique index if not exists calendar_items_application_interview_unique_idx
  on public.calendar_items (user_id, application_interview_id)
  where application_interview_id is not null and deleted_at is null;
