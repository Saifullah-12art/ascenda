-- Log of routine-generation attempts, used to rate-limit
-- POST /api/generate-routine (5 per user per rolling 24h). One row is written
-- per attempt BEFORE the Claude call, so failed generations count too — the
-- limit protects API credits, not just successful writes.
create table if not exists public.generation_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The rate-limit check counts a user's rows in the last 24 hours.
create index if not exists generation_log_user_created_idx
  on public.generation_log (user_id, created_at desc);

-- RLS on, with NO policies: clients can neither read nor write this table.
-- Only the server's service-role client (which bypasses RLS) touches it.
alter table public.generation_log enable row level security;
