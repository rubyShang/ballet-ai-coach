-- Ballet AI Coach — update for plié (run once if you set up the database before plié was added)
-- Supabase → SQL Editor → New query → paste → Run. Safe to run more than once.
alter table public.sessions add column if not exists module text not null default 'tendu';
alter table public.reps     add column if not exists module text not null default 'tendu';
create index if not exists sessions_dancer_module on public.sessions (dancer_id, module, started_at);
