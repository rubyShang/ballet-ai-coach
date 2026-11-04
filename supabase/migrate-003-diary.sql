-- Ballet AI Coach — pain diary (run once if your database was set up before the diary was added)
-- Supabase → SQL Editor → New query → paste → Run. Safe to run more than once.

-- regular class days on each dancer (0 = Sunday … 6 = Saturday)
alter table public.dancers add column if not exists schedule jsonb not null default '[]'::jsonb;

-- one diary entry per dancer per day
create table if not exists public.diary (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dancer_id   uuid not null references public.dancers(id) on delete cascade,
  day         date not null,
  pain        smallint not null check (pain between 0 and 5),
  areas       text[] not null default '{}',       -- heel_L, knee_R, …
  activities  text[] not null default '{}',       -- class, home, rehearsal, rest
  note        text check (note is null or char_length(note) <= 500),
  updated_at  timestamptz not null default now(),
  unique (dancer_id, day)
);
alter table public.diary enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'diary' and policyname = 'own diary') then
    create policy "own diary" on public.diary
      for all to authenticated
      using (owner = (select auth.uid()))
      with check (owner = (select auth.uid())
                  and exists (select 1 from public.dancers d where d.id = dancer_id and d.owner = (select auth.uid())));
  end if;
end $$;
