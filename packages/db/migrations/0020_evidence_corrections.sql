-- M11 evidence corrections are new revisions; original parser claims remain immutable.
alter table public.candidate_evidence add column revision integer not null default 1 check (revision > 0);
alter table public.candidate_evidence add column parent_evidence_id uuid;
alter table public.candidate_evidence add constraint candidate_evidence_parent_owner_fkey
  foreign key (parent_evidence_id, user_id) references public.candidate_evidence(id, user_id) on delete set null;
create unique index candidate_evidence_revision_unique_idx
  on public.candidate_evidence (user_id, coalesce(parent_evidence_id, id), revision);
create index candidate_evidence_parent_idx on public.candidate_evidence (user_id, parent_evidence_id, revision desc);
