-- Opt-in flag for the daily reminder email. Defaults to true so existing and
-- new users are reminded unless they unsubscribe (/api/unsubscribe sets this
-- to false). The daily-reminder cron only emails rows where this is true.
alter table public.profiles
  add column if not exists email_reminders boolean not null default true;
