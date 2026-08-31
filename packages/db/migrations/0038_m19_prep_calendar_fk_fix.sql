-- M19 follow-up: composite SET NULL must clear only the optional Calendar reference.
alter table public.interview_prep_items
  drop constraint interview_prep_items_calendar_item_id_user_id_fkey;
alter table public.interview_prep_items
  add constraint interview_prep_items_calendar_item_owner_fkey
  foreign key (calendar_item_id, user_id)
  references public.calendar_items(id, user_id)
  on delete set null (calendar_item_id);
