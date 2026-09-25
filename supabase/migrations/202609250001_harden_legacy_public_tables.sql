-- Harden legacy tables that must not be writable by browser clients.
--
-- user_sequences has no user_id ownership column and is not used by the
-- current application. Keep it available to service-role maintenance only.
revoke all on table public.user_sequences from anon, authenticated;

drop policy if exists "Allow anon delete user_sequences" on public.user_sequences;
drop policy if exists "Allow anon insert user_sequences" on public.user_sequences;
drop policy if exists "Allow anon read user_sequences" on public.user_sequences;
drop policy if exists "Allow anon update user_sequences" on public.user_sequences;
drop policy if exists "Allow auth delete user_sequences" on public.user_sequences;
drop policy if exists "Allow auth insert user_sequences" on public.user_sequences;
drop policy if exists "Allow auth read user_sequences" on public.user_sequences;
drop policy if exists "Allow auth update user_sequences" on public.user_sequences;

-- Rating options are shared application configuration. Clients may read
-- active options, but only trusted server-side/admin tooling may change them.
revoke insert, update, delete, truncate, references, trigger
    on table public.completion_rating_options
    from anon, authenticated;

drop policy if exists "Only authenticated users can delete rating options"
    on public.completion_rating_options;
drop policy if exists "Only authenticated users can insert rating options"
    on public.completion_rating_options;
drop policy if exists "Only authenticated users can update rating options"
    on public.completion_rating_options;
