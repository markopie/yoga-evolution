-- Remove legacy policies that made completion history globally readable or
-- writable. The application signs users in anonymously, which still produces
-- the authenticated Supabase role, so anonymous SQL privileges are not needed.
drop policy if exists "Allow public read" on public.sequence_completions;
drop policy if exists "Allow public insert" on public.sequence_completions;
drop policy if exists "Enable full access for app" on public.sequence_completions;
revoke all on table public.sequence_completions from anon;

-- Personal tables must not be directly accessible by the anon database role.
revoke all on table
    public.curriculum_drafts,
    public.curriculum_mastery_decisions,
    public.curriculum_optional_stage_enrollments,
    public.media_assets,
    public.offline_download_packs,
    public.sequence_completions,
    public.sync_entities,
    public.sync_mutations,
    public.sync_tables,
    public.user_asana_overrides,
    public.user_asanas,
    public.user_preferences,
    public.user_prop_overrides,
    public.user_stages
from anon;

-- These routines are internal or require a signed-in trusted device. Do not
-- expose them as anonymous RPC endpoints.
revoke execute on function public.get_next_curriculum_node(text, uuid)
    from anon, authenticated;
revoke execute on function public.has_trusted_auth_device_access()
    from anon;
revoke execute on function public.register_trusted_auth_device(text, text)
    from anon;
revoke execute on function public.revoke_trusted_auth_device(text)
    from anon;
revoke execute on function public.verify_trusted_auth_device(text)
    from anon;

-- get_asana_mapping exists only on some deployments; revoke it when present
-- without making this migration fail on deployments that do not have it.
do $$
declare
    routine regprocedure := to_regprocedure('public.get_asana_mapping(integer, text)');
begin
    if routine is not null then
        execute format('revoke execute on function %s from anon, authenticated', routine);
    end if;
end
$$;

-- Pin search_path for the known helper functions in this repository. This is
-- especially important if any are later changed to SECURITY DEFINER.
alter function public.normalize_course_pose_id(text) set search_path = public;
alter function public.sync_has_conflict(text, jsonb, bigint) set search_path = public;
alter function public.sync_pk_for_row(text, jsonb) set search_path = public;
alter function public.sync_register_table(text) set search_path = public;
