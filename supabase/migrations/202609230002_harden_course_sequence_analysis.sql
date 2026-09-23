-- This is a derived maintenance cache. It is populated by the service-role
-- refresh function and is not part of the public client data model.
alter table if exists public.course_sequence_analysis enable row level security;

revoke all on table public.course_sequence_analysis from anon, authenticated;
