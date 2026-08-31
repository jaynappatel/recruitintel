-- M11: encrypted private resume object bytes. The database is the local object boundary;
-- callers never receive a public URL or a plaintext object column.
alter table public.resume_documents add column storage_key text;
alter table public.resume_documents add column storage_ciphertext bytea;
alter table public.resume_documents add column storage_nonce bytea;
alter table public.resume_documents add column storage_key_version smallint not null default 1 check (storage_key_version > 0);
alter table public.resume_documents add constraint resume_documents_storage_complete_chk check (
  (status = 'DELETED' and storage_ciphertext is null and storage_nonce is null)
  or (status <> 'DELETED' and storage_key is not null and storage_ciphertext is not null and storage_nonce is not null)
) not valid;
create unique index resume_documents_storage_key_idx on public.resume_documents (storage_key) where storage_key is not null;
