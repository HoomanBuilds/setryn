create schema if not exists setryn;

revoke all on schema setryn from public, anon, authenticated;

create table if not exists setryn.runtime_documents (
  scope text not null,
  collection text not null,
  document_key text not null,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, collection, document_key),
  check (scope ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  check (collection ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  check (document_key ~ '^[a-z0-9][a-z0-9._-]{0,127}$')
);

revoke all on setryn.runtime_documents from public, anon, authenticated;
grant usage on schema setryn to postgres;
grant select, insert, update, delete on setryn.runtime_documents to postgres;

comment on table setryn.runtime_documents is
  'Server-only durable state for Setryn application services. Not exposed through PostgREST.';
