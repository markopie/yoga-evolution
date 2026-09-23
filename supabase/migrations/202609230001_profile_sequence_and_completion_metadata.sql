-- Additive metadata for profile-owned sequence copies and immutable practice
-- snapshots. Existing rows and authored curriculum content are untouched.
alter table if exists public.courses
    add column if not exists source_sequence_id text;

create index if not exists courses_user_source_sequence_idx
    on public.courses (user_id, source_sequence_id);

alter table if exists public.sequence_completions
    add column if not exists source_type text;
alter table if exists public.sequence_completions
    add column if not exists source_sequence_id text;
alter table if exists public.sequence_completions
    add column if not exists profile_sequence_id text;
alter table if exists public.sequence_completions
    add column if not exists sequence_hash text;
alter table if exists public.sequence_completions
    add column if not exists sequence_snapshot jsonb;

update public.sequence_completions
set source_type = case when curriculum_node_id is not null then 'curriculum' else 'manual' end
where source_type is null;

alter table if exists public.sequence_completions
    alter column source_type set default 'manual';

create index if not exists sequence_completions_curriculum_node_idx
    on public.sequence_completions (user_id, curriculum_node_id)
    where curriculum_node_id is not null;
