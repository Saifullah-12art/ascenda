-- league_members.member_name is nullable, and nothing guarantees it is filled.
-- create_league and join_league copy the caller's profiles.full_name into the
-- column with no fallback, so a user who has not set a name writes a null --
-- unlike posts, where posts_set_author_name (0003) coalesces to 'Anonymous'.
--
-- A null there is not cosmetic: the league detail screen calls .trim() on the
-- value inside its members map, so one null row threw a TypeError out of
-- render and blanked the whole page for every member of that league. The
-- client now guards it, and this migration settles the database side.
--
-- WHY A TRIGGER RATHER THAN REWRITING THE TWO RPCs.
-- The obvious fix is to wrap the assignment inside create_league and
-- join_league. Those functions live only in the database -- they are not in
-- this migrations directory -- and they are SECURITY DEFINER, so reproducing
-- them from anything less than their exact current source risks silently
-- dropping an authorization check while appearing to work. A BEFORE trigger
-- reaches the same invariant without touching either function, and it holds
-- for any other writer too: a future RPC, a direct insert, the mobile client,
-- a backfill script. This is also the mechanism 0003 already chose for the
-- equivalent problem on posts.author_name.
--
-- If the two functions are rewritten later, this trigger stays correct: it
-- only fills a value that is missing, and never overwrites a real name.

-- Fills member_name from the member's profile when the incoming value is null
-- or blank, and falls back to 'Anonymous' when the profile has no usable name
-- either -- the same coalesce(nullif(btrim(...), ''), 'Anonymous') that
-- posts_set_author_name uses, so both surfaces render a nameless user
-- identically.
--
-- Deliberately keyed off new.user_id rather than auth.uid(): unlike posts,
-- this column is not a spoofing surface (RLS governs who may insert a
-- membership at all, and the name is only ever a display label), and the row's
-- own user is the correct subject when a trusted caller inserts on someone
-- else's behalf.
create or replace function public.league_members_set_member_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_name text;
begin
  -- A name the caller already supplied wins. create_league and join_league
  -- both set it correctly whenever the profile has a name, and this must not
  -- rewrite that or a later rename would silently propagate into old rows.
  if nullif(btrim(new.member_name), '') is not null then
    return new;
  end if;

  select p.full_name into profile_name
  from public.profiles p
  where p.id = new.user_id;

  new.member_name := coalesce(nullif(btrim(profile_name), ''), 'Anonymous');
  return new;
end;
$$;

-- INSERT and UPDATE both: an update that blanks the column should be repaired
-- on the same terms as an insert that never set it.
drop trigger if exists league_members_set_member_name on public.league_members;
create trigger league_members_set_member_name
  before insert or update on public.league_members
  for each row
  execute function public.league_members_set_member_name();

-- Backfill the rows written before the trigger existed. Idempotent, and safe
-- to run repeatedly -- it matches only null or blank names, so a second run
-- touches nothing.
--
-- NOTE: as of 2026-09-08 this affects 0 rows. The two null rows that prompted
-- this work (both belonging to one user whose profile full_name is null) were
-- already backfilled to 'Anonymous' by hand in Supabase before this migration
-- was written. It is kept so the migration is self-contained: anyone applying
-- 0001..0005 to a fresh or lagging database still ends up in the same state.
update public.league_members lm
set member_name = coalesce(
  nullif(btrim(p.full_name), ''),
  'Anonymous'
)
from public.profiles p
where p.id = lm.user_id
  and (lm.member_name is null or btrim(lm.member_name) = '');

-- Any membership with no matching profile row at all.
update public.league_members
set member_name = 'Anonymous'
where member_name is null or btrim(member_name) = '';

-- Deliberately NOT adding `alter column member_name set not null` here. The
-- trigger above already closes every write path, and a NOT NULL constraint
-- turns any future gap into a failed insert -- a league nobody can join --
-- rather than a name that reads 'Anonymous'. Worth adding once the trigger has
-- some production mileage, as a separate decision.
