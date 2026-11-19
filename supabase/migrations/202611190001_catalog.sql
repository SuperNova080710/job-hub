create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  source text not null,
  external_id text,
  url text not null check (url ~ '^https?://' and char_length(url) <= 2048),
  title text not null check (char_length(title) between 1 and 120),
  company text not null check (char_length(company) between 1 and 120),
  role text not null default '' check (char_length(role) <= 120),
  region text not null default '' check (char_length(region) <= 120),
  career text not null default 'unknown' check (career in ('entry','experienced','any','unknown')),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  deadline date,
  posted_on date,
  created_at timestamptz not null default now(),
  unique (source, external_id),
  unique (owner_id, url),
  check ((source = 'manual' and owner_id is not null and external_id is null)
    or (source = 'work24' and owner_id is null and external_id is not null))
);

create unique index jobs_official_url on public.jobs(url) where owner_id is null;
create index jobs_search_order on public.jobs(created_at desc, id);
create index jobs_skills on public.jobs using gin(skills);

create table public.tracking (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  favorite boolean not null default false,
  status text check (status in ('interested','applied','interview','result')),
  notes text not null default '' check (char_length(notes) <= 4000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  deadline date,
  primary key (user_id, job_id)
);
create index tracking_job on public.tracking(job_id);

alter table public.jobs enable row level security;
alter table public.tracking enable row level security;
revoke all on public.jobs, public.tracking from public, anon, authenticated;
grant select, insert on public.jobs to authenticated;
grant select, insert, update on public.tracking to authenticated;
grant select, insert, update on public.jobs to service_role;

create policy jobs_read on public.jobs for select to authenticated
using (owner_id is null or owner_id = (select auth.uid()));
create policy jobs_add on public.jobs for insert to authenticated
with check (source = 'manual' and owner_id = (select auth.uid()));
create policy tracking_read on public.tracking for select to authenticated
using (user_id = (select auth.uid()));
create policy tracking_add on public.tracking for insert to authenticated
with check (user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = tracking.job_id));
create policy tracking_update on public.tracking for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid())
  and exists (select 1 from public.jobs j where j.id = tracking.job_id));

create function public.search_jobs(
  term text, role_filter text, region_filter text, career_filter text,
  skill_filter text, page_number integer, saved_only boolean
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as (
    select distinct on (j.url) j.*, case when t.job_id is null then null
      else jsonb_build_object('favorite', t.favorite, 'status', t.status,
        'notes', t.notes, 'tags', t.tags, 'deadline', t.deadline) end as tracking
    from public.jobs j left join public.tracking t on j.id = t.job_id
    where (term = '' or strpos(lower(concat_ws(' ', j.title, j.company, j.role, j.region)), lower(term)) > 0)
      and (role_filter = '' or strpos(lower(j.role), lower(role_filter)) > 0)
      and (region_filter = '' or strpos(lower(j.region), lower(region_filter)) > 0)
      and (career_filter is null or j.career = career_filter)
      and (skill_filter is null or j.skills @> array[skill_filter])
      and (not saved_only or t.favorite or t.status is not null
        or t.notes <> '' or cardinality(t.tags) > 0 or t.deadline is not null)
    order by j.url,
      coalesce(t.favorite or t.status is not null or t.notes <> ''
        or cardinality(t.tags) > 0 or t.deadline is not null, false) desc,
      (j.source = 'work24') desc, j.id
  ), page as (
    select * from matches order by created_at desc, id limit 26
    offset ((least(greatest(page_number, 1), 1000) - 1) * 25)
  ), rows as (select * from page order by created_at desc, id limit 25)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(rows) - 'owner_id' order by created_at desc, id) from rows), '[]'::jsonb),
    'hasMore', (select count(*) > 25 from page));
$$;
revoke execute on function public.search_jobs(text,text,text,text,text,integer,boolean) from public, anon;
grant execute on function public.search_jobs(text,text,text,text,text,integer,boolean) to authenticated;
