create table public.ingest_days (
  day date primary key,
  status text not null default 'started' check (status in ('started','complete','failed')),
  written integer not null default 0 check (written >= 0)
);
alter table public.ingest_days enable row level security;
revoke all on public.ingest_days from public, anon, authenticated;
grant select, insert, update on public.ingest_days to service_role;
