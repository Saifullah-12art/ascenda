-- author_name was supplied by the client on insert (the compose screen writes
-- straight to public.posts, there is no API route in front of it), so any
-- caller could post under any name. These triggers move the field server-side:
-- the database derives it from the authenticated user's profile and ignores
-- whatever the client sent.
--
-- Snapshot semantics are unchanged: the name is still frozen into the row at
-- insert time, existing rows are left alone (no backfill), and a later profile
-- rename does not rewrite old posts.

-- Fills author_name from the profile of the *authenticated* user. Deriving
-- from auth.uid() rather than new.user_id means the name is right even if the
-- client lies about user_id. Under the service-role key (and in SQL run by an
-- admin) auth.uid() is null, so fall back to the row's user_id — the only
-- callers there are trusted server code.
create or replace function public.posts_set_author_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_by uuid := coalesce(auth.uid(), new.user_id);
  profile_name text;
begin
  select p.full_name into profile_name
  from public.profiles p
  where p.id = claimed_by;

  new.author_name := coalesce(nullif(btrim(profile_name), ''), 'Anonymous');
  return new;
end;
$$;

drop trigger if exists posts_set_author_name on public.posts;
create trigger posts_set_author_name
  before insert on public.posts
  for each row
  execute function public.posts_set_author_name();

-- The insert trigger alone would still leave a spoofing path: post, then
-- UPDATE the name. author_name is a snapshot, so it should never change after
-- the fact — pin it back to its stored value on every update.
create or replace function public.posts_freeze_author_name()
returns trigger
language plpgsql
as $$
begin
  new.author_name := old.author_name;
  return new;
end;
$$;

drop trigger if exists posts_freeze_author_name on public.posts;
create trigger posts_freeze_author_name
  before update on public.posts
  for each row
  when (new.author_name is distinct from old.author_name)
  execute function public.posts_freeze_author_name();
