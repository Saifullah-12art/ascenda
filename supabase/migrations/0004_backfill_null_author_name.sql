-- 0003_posts_author_name_server_side added a BEFORE INSERT trigger that derives
-- author_name from the poster's profile, and deliberately left existing rows
-- alone. Those legacy rows still hold whatever the client sent at the time,
-- including null and blank names (two such rows in production), which render as
-- an empty byline and used to throw in the feed's initials()/firstInitial()
-- helpers. Normalise them to the same 'Anonymous' the insert trigger applies.
--
-- This is a one-time cleanup of pre-0003 rows. New posts cannot reach this
-- state: the insert trigger already collapses a null, empty or whitespace-only
-- profile name to 'Anonymous' before the row is written.

-- posts_freeze_author_name is a BEFORE UPDATE trigger that pins author_name
-- back to old.author_name whenever an update would change it, so a plain UPDATE
-- here would be reverted row by row -- reporting "UPDATE 2" while changing
-- nothing. Disable it for the backfill.
--
-- Postgres runs a multi-statement script as a single implicit transaction, so
-- the re-enable cannot be stranded by a failing UPDATE: the whole script rolls
-- back together, trigger included. Run these three statements as ONE script --
-- do not execute them one at a time. The ALTER TABLE also takes an ACCESS
-- EXCLUSIVE lock held to the end of that transaction, so no concurrent write
-- can slip past the disabled trigger in the meantime.
alter table public.posts disable trigger posts_freeze_author_name;

update public.posts
set author_name = 'Anonymous'
where author_name is null
   or btrim(author_name) = '';

alter table public.posts enable trigger posts_freeze_author_name;
