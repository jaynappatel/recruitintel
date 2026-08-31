-- A recruiting-intelligence Calendar item is derived from its recruiting date.
-- SET NULL conflicts with calendar_items_check5, which requires that reference
-- for this source type and makes source/date cleanup fail. Delete the derived
-- item atomically with its source date instead.
alter table public.calendar_items
  drop constraint calendar_items_recruiting_date_id_fkey;

alter table public.calendar_items
  add constraint calendar_items_recruiting_date_id_fkey
  foreign key (recruiting_date_id)
  references public.recruiting_dates(id)
  on delete cascade;
