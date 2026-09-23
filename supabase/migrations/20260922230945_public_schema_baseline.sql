


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."digest"("p_data" "text", "p_type" "text") RETURNS "bytea"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'extensions'
    AS $$
        select extensions.digest(p_data, p_type)
      $$;


ALTER FUNCTION "public"."digest"("p_data" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_curriculum_node"("p_curriculum_slug" "text" DEFAULT 'iyengar_integrated_master_path_draft_v0'::"text", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS TABLE("curriculum_node_id" bigint, "curriculum_slug" "text", "program_name" "text", "week_number" integer, "day_number" integer, "order_index" numeric, "node_type" "text", "sequence_id" bigint, "source_name" "text", "source_key" "text", "source_course" "text", "source_reference" "text", "practice_track" "text", "curriculum_phase" "text", "intensity" "text", "primary_focus" "text", "special_instructions" "text", "requires_user_selection" boolean, "is_rest_day" boolean, "completion_requirement" "text", "curriculum_payload" "jsonb", "day_role" "text", "recovery_type" "text", "is_visible" boolean, "source_policy" "text", "source_sequence_order" integer, "estimated_minutes" integer, "curriculum_unit_id" "text", "adaptive_behavior" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with eligible_nodes as (
    select pc.*
    from public.program_curriculum pc
    where pc.curriculum_slug = p_curriculum_slug
      and pc.is_active = true
      and pc.is_visible = true
      and (
        nullif(pc.curriculum_payload ->> 'optional_stage', '') is null
        or exists (
          select 1
          from public.curriculum_optional_stage_enrollments enrollment
          where p_user_id is not null
            and enrollment.user_id = p_user_id
            and enrollment.curriculum_slug = pc.curriculum_slug
            and enrollment.stage_key = pc.curriculum_payload ->> 'optional_stage'
        )
        or (
          pc.requires_user_selection = true
          and not exists (
            select 1
            from public.curriculum_optional_stage_enrollments enrollment
            where p_user_id is not null
              and enrollment.user_id = p_user_id
              and enrollment.curriculum_slug = pc.curriculum_slug
              and enrollment.stage_key = pc.curriculum_payload ->> 'optional_stage'
          )
          and (
            nullif(pc.curriculum_payload ->> 'required_optional_stage', '') is null
            or exists (
              select 1
              from public.curriculum_optional_stage_enrollments prerequisite
              where p_user_id is not null
                and prerequisite.user_id = p_user_id
                and prerequisite.curriculum_slug = pc.curriculum_slug
                and prerequisite.stage_key =
                  pc.curriculum_payload ->> 'required_optional_stage'
            )
          )
        )
      )
  ),
  latest_completion as (
    select sc.curriculum_node_id, sc.rating
    from public.sequence_completions sc
    join eligible_nodes pc on pc.id = sc.curriculum_node_id
    where coalesce(sc.completed, true) = true
      and (
        (p_user_id is not null and sc.user_id = p_user_id)
        or (p_user_id is null and sc.user_id is null)
      )
    order by sc.completed_at desc nulls last, sc.id desc
    limit 1
  ),
  candidates as (
    select 0 as adaptive_priority, pc.*
    from eligible_nodes pc
    join latest_completion latest on latest.curriculum_node_id = pc.id
    where latest.rating between 1 and 2

    union all

    select 1 as adaptive_priority, pc.*
    from eligible_nodes pc
    where not exists (
        select 1
        from public.sequence_completions sc
        where sc.curriculum_node_id = pc.id
          and coalesce(sc.completed, true) = true
          and (
            (p_user_id is not null and sc.user_id = p_user_id)
            or (p_user_id is null and sc.user_id is null)
          )
      )
      and not exists (
        select 1
        from public.curriculum_mastery_decisions cmd
        where p_user_id is not null
          and cmd.user_id = p_user_id
          and cmd.curriculum_slug = pc.curriculum_slug
          and cmd.repeat_group = pc.curriculum_payload ->> 'repeat_group'
          and coalesce(
            (pc.curriculum_payload ->> 'mastery_skippable')::boolean,
            false
          )
      )
  ),
  chosen as (
    select *
    from candidates
    order by adaptive_priority, order_index
    limit 1
  )
  select
    chosen.id,
    chosen.curriculum_slug,
    chosen.program_name,
    chosen.week_number,
    chosen.day_number,
    chosen.order_index,
    chosen.node_type,
    chosen.sequence_id,
    chosen.source_name,
    chosen.source_key,
    chosen.source_course,
    chosen.source_reference,
    chosen.practice_track,
    chosen.curriculum_phase,
    chosen.intensity,
    chosen.primary_focus,
    chosen.special_instructions,
    chosen.requires_user_selection,
    chosen.is_rest_day,
    chosen.completion_requirement,
    chosen.curriculum_payload,
    chosen.day_role,
    chosen.recovery_type,
    chosen.is_visible,
    chosen.source_policy,
    chosen.source_sequence_order,
    chosen.estimated_minutes,
    chosen.curriculum_unit_id,
    chosen.adaptive_behavior::jsonb
  from chosen;
$$;


ALTER FUNCTION "public"."get_next_curriculum_node"("p_curriculum_slug" "text", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_next_curriculum_node"("p_curriculum_slug" "text", "p_user_id" "uuid") IS 'Returns the latest low-rated curriculum node for persistent retry, otherwise the next eligible incomplete node.';



CREATE OR REPLACE FUNCTION "public"."get_today_curriculum_practice"("p_curriculum_slug" "text" DEFAULT 'iyengar_integrated_master_path_draft_v0'::"text", "p_user_id" "uuid" DEFAULT "auth"."uid"(), "p_repeat_node_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("curriculum_node_id" bigint, "curriculum_slug" "text", "program_name" "text", "week_number" integer, "day_number" integer, "order_index" numeric, "node_type" "text", "resolved_node_type" "text", "resolved_sequence_id" bigint, "resolved_course_title" "text", "source_name" "text", "source_key" "text", "source_course" "text", "source_reference" "text", "practice_track" "text", "curriculum_phase" "text", "intensity" "text", "primary_focus" "text", "special_instructions" "text", "requires_user_selection" boolean, "is_rest_day" boolean, "completion_requirement" "text", "curriculum_payload" "jsonb", "resolution_reason" "text", "day_role" "text", "recovery_type" "text", "is_visible" boolean, "source_policy" "text", "source_sequence_order" integer, "estimated_minutes" integer, "curriculum_unit_id" "text", "adaptive_behavior" "jsonb")
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  with next_node as (
    select
      pc.id as curriculum_node_id,
      pc.curriculum_slug,
      pc.program_name,
      pc.week_number,
      pc.day_number,
      pc.order_index,
      pc.node_type,
      pc.sequence_id,
      pc.source_name,
      pc.source_key,
      pc.source_course,
      pc.source_reference,
      pc.practice_track,
      pc.curriculum_phase,
      pc.intensity,
      pc.primary_focus,
      pc.special_instructions,
      pc.requires_user_selection,
      pc.is_rest_day,
      pc.completion_requirement,
      pc.curriculum_payload,
      pc.day_role,
      pc.recovery_type,
      pc.is_visible,
      pc.source_policy,
      pc.source_sequence_order,
      pc.estimated_minutes,
      pc.curriculum_unit_id,
      pc.adaptive_behavior::jsonb as adaptive_behavior
    from public.program_curriculum pc
    where p_repeat_node_id is not null
      and pc.id = p_repeat_node_id
      and pc.curriculum_slug = p_curriculum_slug
      and pc.is_active = true
      and pc.is_visible = true

    union all

    select *
    from public.get_next_curriculum_node(p_curriculum_slug, p_user_id)
    where p_repeat_node_id is null
  ),

  adaptive_resolution as (
    select rr.*
    from next_node nn
    cross join lateral public.resolve_revision_curriculum_node(
      nn.curriculum_node_id,
      p_user_id
    ) rr
    where nn.node_type in ('revision', 'choice', 'consolidation')
       or nn.source_policy in ('adaptive_revision', 'adaptive_consolidation')
  )

  select
    nn.curriculum_node_id,
    nn.curriculum_slug,
    nn.program_name,
    nn.week_number,
    nn.day_number,
    nn.order_index,
    nn.node_type,
    case
      when (nn.node_type in ('revision', 'choice', 'consolidation')
            or nn.source_policy in ('adaptive_revision', 'adaptive_consolidation'))
        and ar.resolved_sequence_id is not null
      then 'sequence'
      when nn.node_type in ('rest', 'recovery')
      then nn.node_type
      else nn.node_type
    end as resolved_node_type,
    case
      when nn.node_type in ('revision', 'choice', 'consolidation')
        or nn.source_policy in ('adaptive_revision', 'adaptive_consolidation')
      then ar.resolved_sequence_id
      else nn.sequence_id
    end as resolved_sequence_id,
    case
      when nn.node_type in ('revision', 'choice', 'consolidation')
        or nn.source_policy in ('adaptive_revision', 'adaptive_consolidation')
      then ar.resolved_course_title
      else c.title
    end as resolved_course_title,
    nn.source_name,
    nn.source_key,
    nn.source_course,
    nn.source_reference,
    nn.practice_track,
    nn.curriculum_phase,
    nn.intensity,
    nn.primary_focus,
    nn.special_instructions,
    nn.requires_user_selection,
    nn.is_rest_day,
    nn.completion_requirement,
    nn.curriculum_payload,
    case
      when (nn.node_type in ('revision', 'choice', 'consolidation')
            or nn.source_policy in ('adaptive_revision', 'adaptive_consolidation'))
        and ar.resolved_sequence_id is not null
      then ar.reason
      when nn.node_type in ('revision', 'choice', 'consolidation')
        or nn.source_policy in ('adaptive_revision', 'adaptive_consolidation')
      then 'Adaptive node: no prior source-backed sequence is available yet.'
      when nn.node_type = 'recovery'
      then 'Recovery node: no sequence required.'
      when nn.node_type = 'rest'
      then 'Rest node: no sequence required.'
      when nn.node_type in ('instruction', 'assessment', 'mastery_gate', 'reserve')
        and nn.sequence_id is null
      then 'Non-sequence curriculum node: no sequence required.'
      when p_repeat_node_id is not null
      then 'Repeat: low rating on previous attempt.'
      else 'Curriculum sequence node.'
    end as resolution_reason,
    nn.day_role,
    nn.recovery_type,
    nn.is_visible,
    nn.source_policy,
    nn.source_sequence_order,
    nn.estimated_minutes,
    nn.curriculum_unit_id,
    nn.adaptive_behavior
  from next_node nn
  left join adaptive_resolution ar
    on true
  left join public.courses c
    on c.id = nn.sequence_id
  limit 1;
$$;


ALTER FUNCTION "public"."get_today_curriculum_practice"("p_curriculum_slug" "text", "p_user_id" "uuid", "p_repeat_node_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_trusted_auth_device_access"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  supplied_token text;
begin
  supplied_token := current_setting('request.headers', true)::jsonb
    ->> 'x-yoga-device-token';
  if auth.uid() is null or length(coalesce(supplied_token, '')) < 43 then
    return false;
  end if;
  return exists (
    select 1
      from public.trusted_auth_devices
     where user_id = auth.uid()
       and token_hash = encode(extensions.digest(supplied_token, 'sha256'), 'hex')
       and revoked_at is null
       and expires_at > now()
  );
exception when others then
  return false;
end;
$$;


ALTER FUNCTION "public"."has_trusted_auth_device_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_device_profile"("p_backup" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare profile_id uuid := auth.uid();
begin
  if profile_id is null then raise exception 'A profile session is required'; end if;
  if p_backup->>'format' is distinct from 'yoga-profile'
     or p_backup->>'version' is distinct from '1'
     or jsonb_typeof(p_backup->'completions') is distinct from 'array'
     or jsonb_typeof(p_backup->'mastery') is distinct from 'array'
     or jsonb_typeof(p_backup->'enrollments') is distinct from 'array'
     or jsonb_typeof(p_backup->'preferences') is distinct from 'object' then
    raise exception 'Invalid profile file';
  end if;
  if octet_length(p_backup::text) > 10485760 then raise exception 'Profile file is too large'; end if;
  -- Serialize imports for this user, including simultaneous requests.
  perform pg_advisory_xact_lock(hashtextextended(profile_id::text, 0));
  if exists (select 1 from sequence_completions where user_id = profile_id)
     or exists (select 1 from curriculum_mastery_decisions where user_id = profile_id)
     or exists (select 1 from curriculum_optional_stage_enrollments where user_id = profile_id)
     or exists (select 1 from user_preferences where user_id = profile_id) then
    raise exception 'Import requires a new empty profile';
  end if;

  insert into sequence_completions (user_id, title, category, completed_at,
    duration_seconds, notes, completed, sequence_id, curriculum_node_id, status,
    rating, difficulty_feedback, duration_scale_used, planned_duration_minutes,
    actual_adjusted_duration_minutes)
  select profile_id, coalesce(r.title, ''), r.category, r.completed_at,
    r.duration_seconds, r.notes, coalesce(r.completed, true), r.sequence_id,
    r.curriculum_node_id, r.status, r.rating, r.difficulty_feedback,
    r.duration_scale_used, r.planned_duration_minutes, r.actual_adjusted_duration_minutes
  from jsonb_to_recordset(p_backup->'completions') as r(title text, category text,
    completed_at timestamptz, duration_seconds integer, notes text, completed boolean,
    sequence_id bigint, curriculum_node_id bigint, status text, rating integer,
    difficulty_feedback text, duration_scale_used numeric, planned_duration_minutes numeric,
    actual_adjusted_duration_minutes numeric);

  insert into curriculum_mastery_decisions (user_id, curriculum_slug, repeat_group, easy_rating_count, mastered_at)
  select profile_id, r.curriculum_slug, r.repeat_group, r.easy_rating_count, r.mastered_at
  from jsonb_to_recordset(p_backup->'mastery') as r(curriculum_slug text, repeat_group text, easy_rating_count integer, mastered_at timestamptz);

  insert into curriculum_optional_stage_enrollments (user_id, curriculum_slug, stage_key, accepted_at)
  select profile_id, r.curriculum_slug, r.stage_key, r.accepted_at
  from jsonb_to_recordset(p_backup->'enrollments') as r(curriculum_slug text, stage_key text, accepted_at timestamptz);

  insert into user_preferences (user_id, preferences) values (profile_id, p_backup->'preferences');
end;
$$;


ALTER FUNCTION "public"."import_device_profile"("p_backup" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_course_pose_id"("p_pose_id" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
    select case
        when nullif(btrim(p_pose_id), '') is null then ''
        when lower(btrim(p_pose_id)) ~ '^[0-9]+[a-z]?$' then
            lpad(regexp_replace(lower(btrim(p_pose_id)), '^([0-9]+)[a-z]?$', '\1'), 3, '0') ||
            coalesce(
                nullif(
                    regexp_replace(lower(btrim(p_pose_id)), '^[0-9]+([a-z])$', '\1'),
                    lower(btrim(p_pose_id))
                ),
                ''
            )
        else lower(btrim(p_pose_id))
    end;
$_$;


ALTER FUNCTION "public"."normalize_course_pose_id"("p_pose_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_course_analysis_refresh_queue"("limit_count" integer DEFAULT 50) RETURNS TABLE("course_id" bigint, "success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    r record;
begin
    for r in
        select queue.course_id
        from public.course_analysis_refresh_queue as queue
        where queue.processed_at is null
        order by queue.requested_at asc
        limit limit_count
        for update skip locked
    loop
        begin
            perform public.refresh_course_sequence_analysis_for_course(
                r.course_id
            );

            update public.course_analysis_refresh_queue as queue
            set processed_at = now(),
                last_error = null::text
            where queue.course_id = r.course_id;

            course_id := r.course_id;
            success := true;
            error_message := null::text;
            return next;

        exception when others then
            update public.course_analysis_refresh_queue as queue
            set last_error = sqlerrm,
                attempts = queue.attempts + 1
            where queue.course_id = r.course_id;

            course_id := r.course_id;
            success := false;
            error_message := sqlerrm;
            return next;
        end;
    end loop;
end;
$$;


ALTER FUNCTION "public"."process_course_analysis_refresh_queue"("limit_count" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_course_analysis_refresh_queue"("limit_count" integer) IS 'Admin/server-only maintenance RPC. Processes course analysis refresh queue; call from service-role scripts, not browser clients.';



CREATE OR REPLACE FUNCTION "public"."queue_course_analysis_refresh"("p_course_id" bigint, "p_reason" "text" DEFAULT 'trigger'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    insert into public.course_analysis_refresh_queue (
        course_id,
        reason,
        requested_at,
        processed_at,
        attempts,
        last_error
    )
    values (
        p_course_id,
        p_reason,
        now(),
        null::timestamptz,
        0,
        null::text
    )
    on conflict (course_id)
    do update set
        reason = excluded.reason,
        requested_at = now(),
        processed_at = null::timestamptz,
        attempts = 0,
        last_error = null::text;
end;
$$;


ALTER FUNCTION "public"."queue_course_analysis_refresh"("p_course_id" bigint, "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_course_analysis_refresh"("p_course_id" bigint, "p_reason" "text") IS 'Admin/internal maintenance helper. Queues course analysis refresh work; used by database trigger functions and service-role maintenance.';



CREATE OR REPLACE FUNCTION "public"."queue_course_for_self_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.queue_course_analysis_refresh(new.id, 'course_change');
    return new;
end;
$$;


ALTER FUNCTION "public"."queue_course_for_self_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_course_for_self_change"() IS 'Internal trigger helper. Queues course analysis refreshes after course changes; not intended for direct browser RPC calls.';



CREATE OR REPLACE FUNCTION "public"."queue_courses_for_asana_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    affected_course_id bigint;
begin
    for affected_course_id in
        select distinct c.id
        from public.courses c
        where c.sequence_json is not null
          and jsonb_typeof(c.sequence_json) = 'array'
          and exists (
              select 1
              from jsonb_array_elements(c.sequence_json) as item
              where item->>'type' = 'pose'
                and item->>'pose_id' = new.id::text
          )
    loop
        perform public.queue_course_analysis_refresh(
            affected_course_id,
            'asana_change: ' || new.id
        );
    end loop;

    return new;
end;
$$;


ALTER FUNCTION "public"."queue_courses_for_asana_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_courses_for_asana_change"() IS 'Internal trigger helper. Queues course analysis refreshes after asana changes; not intended for direct browser RPC calls.';



CREATE OR REPLACE FUNCTION "public"."queue_courses_for_stage_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    affected_course_id bigint;
    target_stage_id bigint;
begin
    target_stage_id := coalesce(new.id, old.id);

    for affected_course_id in
        select distinct c.id
        from public.courses c
        where c.sequence_json is not null
          and jsonb_typeof(c.sequence_json) = 'array'
          and exists (
              select 1
              from jsonb_array_elements(c.sequence_json) as item
              where item->>'type' = 'pose'
                and item->>'stage_id' is not null
                and item->>'stage_id' <> ''
                and (item->>'stage_id')::bigint = target_stage_id
          )
    loop
        perform public.queue_course_analysis_refresh(
            affected_course_id,
            'stage_change: ' || target_stage_id
        );
    end loop;

    return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."queue_courses_for_stage_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_courses_for_stage_change"() IS 'Internal trigger helper. Queues course analysis refreshes after stage changes; not intended for direct browser RPC calls.';



CREATE OR REPLACE FUNCTION "public"."refresh_course_pose_index"("p_course_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    delete from public.course_pose_index
    where course_id = p_course_id
      and source_type = 'direct';

    insert into public.course_pose_index (
        course_id,
        pose_id,
        occurrence_count,
        first_order_index,
        source_type,
        updated_at
    )
    with direct_pose_rows as (
        select
            c.id as course_id,
            public.normalize_course_pose_id(item.elem ->> 'pose_id') as pose_id,
            (item.ordinality - 1)::integer as order_index
        from public.courses c
        cross join lateral jsonb_array_elements(
            case
                when jsonb_typeof(c.sequence_json::jsonb) = 'array' then c.sequence_json::jsonb
                else '[]'::jsonb
            end
        ) with ordinality as item(elem, ordinality)
        where c.id = p_course_id
          and item.elem ->> 'type' = 'pose'
          and nullif(btrim(item.elem ->> 'pose_id'), '') is not null
    ),
    grouped as (
        select
            course_id,
            pose_id,
            count(*)::integer as occurrence_count,
            min(order_index)::integer as first_order_index
        from direct_pose_rows
        where pose_id <> ''
        group by course_id, pose_id
    )
    select
        course_id,
        pose_id,
        occurrence_count,
        first_order_index,
        'direct',
        now()
    from grouped
    on conflict (course_id, pose_id, source_type) do update
    set occurrence_count = excluded.occurrence_count,
        first_order_index = excluded.first_order_index,
        updated_at = now();
end;
$$;


ALTER FUNCTION "public"."refresh_course_pose_index"("p_course_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_course_pose_index"("p_course_id" bigint) IS 'Admin/internal maintenance helper. Rebuilds course pose index for one course; not intended for browser RPC calls.';



CREATE OR REPLACE FUNCTION "public"."refresh_course_pose_index_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.refresh_course_pose_index(new.id);
    return new;
end;
$$;


ALTER FUNCTION "public"."refresh_course_pose_index_trigger"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_course_pose_index_trigger"() IS 'Internal trigger function for course pose index maintenance; not intended for direct browser RPC calls.';



CREATE OR REPLACE FUNCTION "public"."refresh_course_sequence_analysis_for_course"("p_course_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
begin

  insert into public.course_sequence_analysis (
    course_id,
    course_title,

    primary_theme,
    secondary_theme,
    top_theme_share,
    second_theme_share,

    weighted_intensity,
    max_intensity,
    intensity_band,

    total_duration_seconds,
    total_duration_minutes,

    theme_classification_seconds,
    theme_classification_minutes,

    pose_count,

    restorative_seconds,
    restorative_minutes,
    restorative_share,

    theme_profile,
    all_theme_profile,
    restorative_theme_profile,

    missing_pose_ids,
    missing_stage_ids,

    analysed_at
  )

  with recursive expanded_items as (
    -- Base case: root course items
    select
      c.id                                 as root_course_id,
      c.title                              as root_course_title,
      c.id                                 as source_course_id,
      c.sub_category_id                    as source_course_sub_category_id,
      x.item,
      x.item->>'type'                      as item_type,
      array[x.ordinality]                  as order_path,
      0                                    as expansion_depth,
      array[c.id]::bigint[]                as visited_course_ids,
      1::integer                           as macro_multiplier
    from public.courses c
    cross join lateral jsonb_array_elements(c.sequence_json)
      with ordinality as x(item, ordinality)
    where c.id = p_course_id
      and c.sequence_json is not null
      and jsonb_typeof(c.sequence_json) = 'array'
      and x.item is not null
      and x.item->>'type' is not null

    union all

    -- Recursive case: expand macro items
    select
      ei.root_course_id,
      ei.root_course_title,
      linked.id                            as source_course_id,
      linked.sub_category_id               as source_course_sub_category_id,
      x.item,
      x.item->>'type'                      as item_type,
      ei.order_path || x.ordinality        as order_path,
      ei.expansion_depth + 1               as expansion_depth,
      ei.visited_course_ids || linked.id   as visited_course_ids,
      ei.macro_multiplier
        * coalesce(nullif(ei.item->>'rounds', '')::integer, 1) as macro_multiplier
    from expanded_items ei
    inner join lateral (
      select c.*
      from public.courses c
      where c.id = (ei.item->>'sequence_id')::bigint
        and c.sequence_json is not null
        and jsonb_typeof(c.sequence_json) = 'array'
    ) linked on true
    cross join lateral jsonb_array_elements(linked.sequence_json)
      with ordinality as x(item, ordinality)
    where ei.item_type = 'macro'
      and ei.expansion_depth < 12
      and not ((ei.item->>'sequence_id')::bigint = any(ei.visited_course_ids))
  ),

  -- Assign final ordinality based on expanded order_path
  expanded_ordered as (
    select
      ei.*,
      row_number() over (order by ei.order_path) as ordinality
    from expanded_items ei
  ),

  loop_ranges as (
    select
      eo.root_course_id,
      eo.ordinality as loop_start_ord,
      (
        select min(eo2.ordinality)
        from expanded_ordered eo2
        where eo2.root_course_id = eo.root_course_id
          and eo2.ordinality > eo.ordinality
          and eo2.item_type = 'loop_end'
      ) as loop_end_ord,
      coalesce(nullif(eo.item->>'rounds', '')::integer, 1) as rounds
    from expanded_ordered eo
    where eo.item_type = 'loop_start'
  ),

  pose_items as (
    select
      eo.root_course_id as course_id,
      eo.root_course_title as course_title,
      eo.source_course_id,
      eo.source_course_sub_category_id,
      eo.ordinality,
      row_number() over (
        partition by eo.root_course_id
        order by eo.ordinality
      ) as pose_index,

      eo.item,
      eo.item->>'pose_id' as pose_id_raw,
      nullif(eo.item->>'stage_id', '')::bigint as stage_id,
      lower(coalesce(nullif(eo.item->>'tier', ''), 'standard')) as hold_tier,
      nullif(eo.item->>'side', '') as side_raw,

      eo.macro_multiplier,

      coalesce(
        round(exp(sum(ln(lr.rounds::numeric))))::integer,
        1
      ) as loop_multiplier

    from expanded_ordered eo
    left join loop_ranges lr
      on lr.root_course_id = eo.root_course_id
     and lr.loop_end_ord is not null
     and eo.ordinality > lr.loop_start_ord
     and eo.ordinality < lr.loop_end_ord
    where eo.item_type = 'pose'
    group by
      eo.root_course_id,
      eo.root_course_title,
      eo.source_course_id,
      eo.source_course_sub_category_id,
      eo.ordinality,
      eo.item,
      eo.macro_multiplier
  ),


  course_pose_positions as (
    select
      course_id,
      max(pose_index) as last_pose_index,
      max(pose_index) filter (where pose_id_raw = '200') as last_savasana_pose_index
    from pose_items
    group by course_id
  ),

  resolved_base as (
    select
      pi.course_id,
      pi.course_title,
      pi.source_course_sub_category_id,
      pi.ordinality,
      pi.pose_index,
      pi.pose_id_raw,
      pi.stage_id,
      pi.hold_tier,
      pi.side_raw,
      pi.loop_multiplier,
      pi.macro_multiplier,


      a.id as asana_id,
      a.name as asana_name,
      a.category_id as base_category_id,
      ac_base.name as base_category_name,

      nullif(nullif(a.intensity::text, '-'), '')::numeric as base_intensity,
      coalesce(a.is_restorative, false) as base_is_restorative,
      coalesce(a.requires_sides, false) as requires_sides,

      st.id as resolved_stage_id,
      st.title as stage_title,
      st.category_id_override,
      ac_stage.name as stage_category_override_name,
      st.intensity_override,
      coalesce(st.is_restorative, false) as stage_is_restorative,

      coalesce(st.category_id_override, a.category_id) as effective_category_id,
      coalesce(ac_stage.name, ac_base.name) as effective_category_name,

      coalesce(
        nullif(nullif(st.intensity_override::text, '-'), '')::numeric,
        nullif(nullif(a.intensity::text, '-'), '')::numeric
      ) as effective_intensity,

      (
        coalesce(a.is_restorative, false)
        or coalesce(st.is_restorative, false)
      ) as effective_is_restorative,

      case
        when coalesce(a.requires_sides, false)
          and (
            pi.side_raw is null
            or lower(pi.side_raw) in ('both', 'all', 'null')
          )
        then 2
        else 1
      end as side_multiplier,

      case
        -- Flow courses: authored duration first, then flow hold, then standard hold.
        -- Use source_course_sub_category_id so linked courses use their own Flow/Cycle status.
        when pi.source_course_sub_category_id = 55 then

          coalesce(
            case
              when nullif(pi.item->>'duration', '') is not null then
                case
                  when (pi.item->>'duration') ~ '^\s*\d+(\.\d+)?\s*$'
                  then round((pi.item->>'duration')::numeric)::integer
                  else public.yoga_parse_hold_seconds(pi.item->>'duration')
                end
              else null
            end,
            public.yoga_parse_hold_seconds(st.hold_json ->> 'flow'),
            public.yoga_parse_hold_seconds(a.hold_json ->> 'flow'),
            public.yoga_parse_hold_seconds(st.hold_json ->> 'standard'),
            public.yoga_parse_hold_seconds(a.hold_json ->> 'standard'),
            0
          )

        -- Cycle and normal courses: ignore sequence_json.duration.
        -- Use selected tier first, then standard.
        else
          coalesce(
            public.yoga_parse_hold_seconds(st.hold_json ->> pi.hold_tier),
            public.yoga_parse_hold_seconds(a.hold_json ->> pi.hold_tier),
            public.yoga_parse_hold_seconds(st.hold_json ->> 'standard'),
            public.yoga_parse_hold_seconds(a.hold_json ->> 'standard'),
            0
          )
      end as base_duration_seconds,

      case
        -- Savasana should not decide the teaching theme.
        when pi.pose_id_raw = '200' then true

        -- Inversions should not dominate the teaching-theme classification unless
        -- the course title explicitly indicates an inversion theme.
        when coalesce(ac_stage.name, ac_base.name) = 'Inversions'
        and pi.course_title !~* '(inverted|inversion|sirsasana|sarvangasana)'
        then true

        -- Standard finishing inversions should remain in all_theme_profile and total duration,
        -- but should not dominate the teaching-theme classification when they appear
        -- immediately before Savasana.
        when pi.pose_id_raw in ('074', '087', '091', '234')
        and cpp.last_savasana_pose_index is not null
        and pi.pose_index between cpp.last_savasana_pose_index - 5
                                and cpp.last_savasana_pose_index - 1
        then true

        else false
      end as exclude_from_teaching_theme

    from pose_items pi
    left join course_pose_positions cpp
      on cpp.course_id = pi.course_id
    left join public.asanas a
      on a.id::text = pi.pose_id_raw::text
    left join public.asana_categories ac_base
      on ac_base.id = a.category_id
    left join public.stages st
      on st.id = pi.stage_id
    left join public.asana_categories ac_stage
      on ac_stage.id = st.category_id_override
  ),

  resolved as (
    select
      rb.*,
      rb.base_duration_seconds
      * rb.loop_multiplier
      * rb.side_multiplier
      * rb.macro_multiplier as duration_seconds
    from resolved_base rb
  ),


  course_totals as (
    select
      course_id,
      course_title,

      sum(duration_seconds)::integer as total_duration_seconds,
      count(*)::integer as pose_count,

      sum(duration_seconds) filter (
        where exclude_from_teaching_theme = false
      )::integer as theme_classification_seconds,

      sum(duration_seconds) filter (
        where effective_is_restorative
      )::integer as restorative_seconds,

      sum(duration_seconds * effective_intensity)
        / nullif(
            sum(duration_seconds) filter (where effective_intensity is not null),
            0
          ) as weighted_intensity,

      max(effective_intensity) as max_intensity

    from resolved
    group by course_id, course_title
  ),

  theme_category_totals as (
    select
      course_id,
      course_title,
      effective_category_name,
      sum(duration_seconds)::integer as category_seconds
    from resolved
    where effective_category_name is not null
      and exclude_from_teaching_theme = false
    group by course_id, course_title, effective_category_name
  ),

  ranked_theme_categories as (
    select
      tct.*,
      ctot.theme_classification_seconds,
      round(
        100.0 * tct.category_seconds
        / nullif(ctot.theme_classification_seconds, 0),
        2
      ) as category_share_pct,
      row_number() over (
        partition by tct.course_id
        order by tct.category_seconds desc, tct.effective_category_name
      ) as rn
    from theme_category_totals tct
    join course_totals ctot
      on ctot.course_id = tct.course_id
  ),

  theme_summary as (
    select
      course_id,
      max(case when rn = 1 then effective_category_name end) as top_theme,
      max(case when rn = 1 then category_share_pct end) as top_theme_share,
      max(case when rn = 2 then effective_category_name end) as second_theme,
      max(case when rn = 2 then category_share_pct end) as second_theme_share,

      jsonb_object_agg(
        effective_category_name,
        jsonb_build_object(
          'seconds', category_seconds,
          'share_pct', category_share_pct
        )
        order by category_seconds desc
      ) as theme_profile
    from ranked_theme_categories
    group by course_id
  ),

  all_category_totals as (
    select
      course_id,
      effective_category_name,
      sum(duration_seconds)::integer as category_seconds
    from resolved
    where effective_category_name is not null
    group by course_id, effective_category_name
  ),

  all_theme_profile as (
    select
      act.course_id,
      jsonb_object_agg(
        act.effective_category_name,
        jsonb_build_object(
          'seconds', act.category_seconds,
          'share_pct', round(
            100.0 * act.category_seconds
            / nullif(ctot.total_duration_seconds, 0),
            2
          )
        )
        order by act.category_seconds desc
      ) as all_theme_profile
    from all_category_totals act
    join course_totals ctot
      on ctot.course_id = act.course_id
    group by act.course_id
  ),

  restorative_category_totals as (
    select
      course_id,
      effective_category_name,
      sum(duration_seconds)::integer as category_seconds
    from resolved
    where effective_category_name is not null
      and effective_is_restorative
    group by course_id, effective_category_name
  ),

  restorative_theme_profile as (
    select
      rct.course_id,
      jsonb_object_agg(
        rct.effective_category_name,
        jsonb_build_object(
          'seconds', rct.category_seconds,
          'share_pct', round(
            100.0 * rct.category_seconds
            / nullif(ctot.restorative_seconds, 0),
            2
          )
        )
        order by rct.category_seconds desc
      ) as restorative_theme_profile
    from restorative_category_totals rct
    join course_totals ctot
      on ctot.course_id = rct.course_id
    group by rct.course_id
  ),

  missing_pose_ids as (
    select
      course_id,
      jsonb_agg(distinct pose_id_raw order by pose_id_raw) as missing_pose_ids
    from resolved
    where pose_id_raw is not null
      and asana_id is null
    group by course_id
  ),

  missing_stage_ids as (
    select
      course_id,
      jsonb_agg(distinct stage_id order by stage_id) as missing_stage_ids
    from resolved
    where stage_id is not null
      and resolved_stage_id is null
    group by course_id
  ),

  -- ============================================================
  -- Backbends Focus-Block Correction
  -- ============================================================

  -- Course metadata for sub_category filtering
  course_meta as (
    select
      c.id as course_id,
      c.sub_category_id
    from public.courses c
    where c.id = p_course_id
  ),

  -- Identify contiguous category blocks (only non-excluded poses)
  category_blocks as (
    select
      r.*,
      case
        when r.pose_index = 1 then 1
        when lag(r.effective_category_name) over (
          partition by r.course_id order by r.pose_index
        ) = r.effective_category_name then 0
        else 1
      end as block_start
    from resolved r
    where r.exclude_from_teaching_theme = false
  ),

  category_blocks_numbered as (
    select
      cb.*,
      sum(cb.block_start) over (
        partition by cb.course_id
        order by cb.pose_index
        rows between unbounded preceding and current row
      ) as category_block_id
    from category_blocks cb
  ),

  block_summary as (
    select
      cbn.course_id,
      cbn.category_block_id,
      cbn.effective_category_name,
      min(cbn.pose_index) as block_start_index,
      max(cbn.pose_index) as block_end_index,
      count(*)::integer as block_pose_count,
      sum(cbn.duration_seconds)::integer as block_seconds,
      bool_and(cbn.effective_is_restorative) as block_entirely_restorative
    from category_blocks_numbered cbn
    group by cbn.course_id, cbn.category_block_id, cbn.effective_category_name
  ),

  -- Initial Standing block (if starts at pose_index = 1)
  initial_standing_block as (
    select
      course_id,
      category_block_id,
      block_pose_count,
      block_seconds
    from block_summary
    where block_start_index = 1
      and effective_category_name = 'Standing and Basic'
  ),

  -- Backbends blocks
  backbend_blocks as (
    select
      bs.course_id,
      bs.category_block_id,
      bs.block_start_index,
      bs.block_end_index,
      bs.block_pose_count,
      bs.block_seconds,
      bs.block_entirely_restorative,
      row_number() over (
        partition by bs.course_id
        order by bs.block_start_index
      ) as bb_block_seq
    from block_summary bs
    where bs.effective_category_name = 'Backbends'
  ),

  -- Forward Bends blocks
  forward_bend_blocks as (
    select
      bs.course_id,
      bs.category_block_id,
      bs.block_start_index,
      bs.block_end_index,
      bs.block_pose_count,
      bs.block_seconds,
      bs.block_entirely_restorative,
      row_number() over (
        partition by bs.course_id
        order by bs.block_start_index
      ) as fb_block_seq
    from block_summary bs
    where bs.effective_category_name = 'Forward Bends'
  ),

  -- Main Backbends block (first substantial one)
  main_backbend_block as (
    select
      course_id,
      block_start_index,
      block_end_index,
      block_pose_count,
      block_seconds
    from backbend_blocks
    where bb_block_seq = 1
      and block_pose_count >= 3
      and block_seconds >= 90
      and not block_entirely_restorative
  ),

  -- Main Forward Bends block (first substantial one)
  main_forward_bend_block as (
    select
      course_id,
      block_start_index,
      block_pose_count,
      block_seconds
    from forward_bend_blocks
    where fb_block_seq = 1
  )

  select
    ctot.course_id,
    ctot.course_title,

    case
      when ts.top_theme is null then null
      when ts.top_theme_share < 45 then 'Mixed'

      -- Backbends focus-block correction:
      -- Override to Backbends when the sequence structure clearly indicates
      -- Backbends is the actual teaching focus, not the duration-dominant category.
      when (
        -- Only apply to non-excluded sub_categories
        cm.sub_category_id not in (5, 55, 233, 235, 236, 560)
        -- Current primary must be Standing and Basic or Forward Bends
        and ts.top_theme in ('Standing and Basic', 'Forward Bends')
        -- Backbends must have at least 15% share
        and coalesce(
          (ts.theme_profile->'Backbends'->>'share_pct')::numeric,
          0
        ) >= 15
        -- Must have a coherent Backbends block
        and mbb.course_id is not null
        and (
          -- Standing and Basic case: initial Standing block is 5-7 poses, <= 650s,
          -- followed by Backbends block
          (
            ts.top_theme = 'Standing and Basic'
            and isb.course_id is not null
            and isb.block_pose_count between 5 and 7
            and isb.block_seconds <= 650
            and mbb.block_start_index > (
              select coalesce(max(bs.block_end_index), 0)
              from block_summary bs
              where bs.course_id = ctot.course_id
                and bs.category_block_id < (
                  select min(bs2.category_block_id)
                  from block_summary bs2
                  where bs2.course_id = ctot.course_id
                    and bs2.effective_category_name = 'Backbends'
                    and bs2.block_pose_count >= 3
                )
            )
          )
          or
          -- Forward Bends case: Backbends is secondary or within 10pp,
          -- and Backbends block precedes Forward Bends block
          (
            ts.top_theme = 'Forward Bends'
            and (
              ts.second_theme = 'Backbends'
              or (
                coalesce(
                  (ts.theme_profile->'Backbends'->>'share_pct')::numeric,
                  0
                )
                >= coalesce(
                  (ts.theme_profile->'Forward Bends'->>'share_pct')::numeric,
                  0
                ) - 10
              )
            )
            and mbb.block_start_index < mfbb.block_start_index
          )
        )
      ) then 'Backbends'

      else ts.top_theme
    end as primary_theme,

    case
      when ts.second_theme_share >= 20 then ts.second_theme
      else null
    end as secondary_theme,

    ts.top_theme_share,
    ts.second_theme_share,

    round(ctot.weighted_intensity, 2) as weighted_intensity,
    ctot.max_intensity,

    case
      when ctot.weighted_intensity is null then null
      when ctot.weighted_intensity <= 1.5 then 'restorative'
      when ctot.weighted_intensity <= 4 then 'light'
      when ctot.weighted_intensity <= 8 then 'moderate'
      when ctot.weighted_intensity <= 15 then 'strong'
      else 'advanced'
    end as intensity_band,

    ctot.total_duration_seconds,
    round(ctot.total_duration_seconds / 60.0, 2) as total_duration_minutes,

    ctot.theme_classification_seconds,
    round(ctot.theme_classification_seconds / 60.0, 2) as theme_classification_minutes,

    ctot.pose_count,

    coalesce(ctot.restorative_seconds, 0) as restorative_seconds,
    round(coalesce(ctot.restorative_seconds, 0) / 60.0, 2) as restorative_minutes,
    round(
      100.0 * coalesce(ctot.restorative_seconds, 0)
      / nullif(ctot.total_duration_seconds, 0),
      2
    ) as restorative_share,

    ts.theme_profile,
    atp.all_theme_profile,
    rtp.restorative_theme_profile,

    mpi.missing_pose_ids,
    msi.missing_stage_ids,

    now() as analysed_at

  from course_totals ctot
  left join theme_summary ts
    on ts.course_id = ctot.course_id
  left join all_theme_profile atp
    on atp.course_id = ctot.course_id
  left join restorative_theme_profile rtp
    on rtp.course_id = ctot.course_id
  left join missing_pose_ids mpi
    on mpi.course_id = ctot.course_id
  left join missing_stage_ids msi
    on msi.course_id = ctot.course_id
  left join course_meta cm
    on cm.course_id = ctot.course_id
  left join initial_standing_block isb
    on isb.course_id = ctot.course_id
  left join main_backbend_block mbb
    on mbb.course_id = ctot.course_id
  left join main_forward_bend_block mfbb
    on mfbb.course_id = ctot.course_id

  on conflict (course_id) do update set
    course_title = excluded.course_title,

    primary_theme = excluded.primary_theme,
    secondary_theme = excluded.secondary_theme,
    top_theme_share = excluded.top_theme_share,
    second_theme_share = excluded.second_theme_share,

    weighted_intensity = excluded.weighted_intensity,
    max_intensity = excluded.max_intensity,
    intensity_band = excluded.intensity_band,

    total_duration_seconds = excluded.total_duration_seconds,
    total_duration_minutes = excluded.total_duration_minutes,

    theme_classification_seconds = excluded.theme_classification_seconds,
    theme_classification_minutes = excluded.theme_classification_minutes,

    pose_count = excluded.pose_count,

    restorative_seconds = excluded.restorative_seconds,
    restorative_minutes = excluded.restorative_minutes,
    restorative_share = excluded.restorative_share,

    theme_profile = excluded.theme_profile,
    all_theme_profile = excluded.all_theme_profile,
    restorative_theme_profile = excluded.restorative_theme_profile,

    missing_pose_ids = excluded.missing_pose_ids,
    missing_stage_ids = excluded.missing_stage_ids,

    analysed_at = excluded.analysed_at;

end;
$_$;


ALTER FUNCTION "public"."refresh_course_sequence_analysis_for_course"("p_course_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_course_sequence_analysis_for_course"("p_course_id" bigint) IS 'Admin/server-only maintenance RPC. Recomputes cached course sequence analysis for one course; call from service-role maintenance.';



CREATE OR REPLACE FUNCTION "public"."register_trusted_auth_device"("p_token" "text", "p_label" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  token_hash_value text;
  expiry timestamptz := now() + interval '30 days';
  strong_authentication boolean;
begin
  strong_authentication := (auth.jwt() ->> 'aal') = 'aal2'
    or exists (
      select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as method(value)
      where method.value ->> 'method' = 'passkey'
         or method.value = to_jsonb('passkey'::text)
    );
  if auth.uid() is null or not strong_authentication then
    raise exception 'Recent MFA or passkey authentication is required';
  end if;
  if length(coalesce(p_token, '')) < 43 then
    raise exception 'Invalid trusted-device token';
  end if;

  token_hash_value := encode(extensions.digest(p_token, 'sha256'), 'hex');
  delete from public.trusted_auth_devices
   where expires_at <= now() or revoked_at is not null;
  delete from public.trusted_auth_devices where token_hash = token_hash_value;
  insert into public.trusted_auth_devices (
    user_id, token_hash, device_label, expires_at
  ) values (
    auth.uid(), token_hash_value, left(nullif(trim(p_label), ''), 120), expiry
  );

  delete from public.trusted_auth_devices
   where id in (
     select id
       from public.trusted_auth_devices
      where user_id = auth.uid() and revoked_at is null
      order by created_at desc
      offset 5
   );
  return jsonb_build_object('expires_at', expiry);
end;
$$;


ALTER FUNCTION "public"."register_trusted_auth_device"("p_token" "text", "p_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_revision_curriculum_node"("p_curriculum_node_id" bigint, "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS TABLE("resolved_sequence_id" bigint, "resolved_course_title" "text", "reason" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  with target as (
    select
      pc.id,
      pc.curriculum_slug,
      pc.order_index,
      pc.source_policy
    from public.program_curriculum pc
    where pc.id = p_curriculum_node_id
    limit 1
  ),

  user_completion as (
    select
      sc.sequence_id,
      c.title,
      case
        when sc.rating is not null and sc.rating <= 2
        then 'Adaptive review resolved to a lower-rated completed practice.'
        else 'Adaptive review resolved to a recent completed practice.'
      end as reason,
      case
        when sc.rating is not null and sc.rating <= 2 then 0
        else 1
      end as priority,
      sc.completed_at,
      null::numeric as order_index
    from target t
    join public.sequence_completions sc
      on sc.curriculum_node_id is not null
     and sc.sequence_id is not null
     and coalesce(sc.completed, true) = true
     and (p_user_id is null or sc.user_id is null or sc.user_id = p_user_id)
    join public.program_curriculum completed_node
      on completed_node.id = sc.curriculum_node_id
     and completed_node.curriculum_slug = t.curriculum_slug
     and completed_node.order_index < t.order_index
    left join public.courses c
      on c.id = sc.sequence_id
    order by priority, sc.completed_at desc
    limit 1
  ),

  previous_source_node as (
    select
      coalesce(
        (pc.curriculum_payload->'practice_composition'->0->>'sequence_id')::bigint,
        pc.sequence_id
      ) as sequence_id,
      coalesce(c_comp.title, c.title) as title,
      'Adaptive review fell back to the previous source-backed curriculum practice.'::text as reason,
      2 as priority,
      null::timestamptz as completed_at,
      pc.order_index
    from target t
    join public.program_curriculum pc
      on pc.curriculum_slug = t.curriculum_slug
     and pc.order_index < t.order_index
     and pc.is_active = true
     and pc.is_visible = true
     and (
       pc.sequence_id is not null
       or jsonb_array_length(coalesce(pc.curriculum_payload->'practice_composition', '[]'::jsonb)) > 0
     )
    left join public.courses c
      on c.id = pc.sequence_id
    left join public.courses c_comp
      on c_comp.id = (pc.curriculum_payload->'practice_composition'->0->>'sequence_id')::bigint
    order by pc.order_index desc
    limit 1
  ),

  candidates as (
    select * from user_completion
    union all
    select * from previous_source_node
  )

  select
    candidates.sequence_id as resolved_sequence_id,
    candidates.title as resolved_course_title,
    candidates.reason
  from candidates
  where candidates.sequence_id is not null
  order by candidates.priority, candidates.completed_at desc nulls last, candidates.order_index desc nulls last
  limit 1;
$$;


ALTER FUNCTION "public"."resolve_revision_curriculum_node"("p_curriculum_node_id" bigint, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_trusted_auth_device"("p_token" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  update public.trusted_auth_devices
     set revoked_at = now()
   where user_id = auth.uid()
     and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;


ALTER FUNCTION "public"."revoke_trusted_auth_device"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."service_revoke_user_sessions"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."service_revoke_user_sessions"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."service_revoke_user_sessions"("p_user_id" "uuid") IS 'Service-role-only session revocation used after approved account recovery.';



CREATE OR REPLACE FUNCTION "public"."sync_has_conflict"("target_table" "text", "target_pk" "jsonb", "base_server_version" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
    (
      select server_version > coalesce(base_server_version, 0)
      from public.sync_entities
      where table_name = target_table
        and pk = target_pk
    ),
    false
  );
$$;


ALTER FUNCTION "public"."sync_has_conflict"("target_table" "text", "target_pk" "jsonb", "base_server_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pk_for_row"("target_table" "text", "row_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  pk_columns text[];
  pk jsonb := '{}'::jsonb;
  column_name text;
begin
  select primary_key_columns
    into pk_columns
    from public.sync_tables
   where sync_tables.table_name = sync_pk_for_row.target_table;

  if pk_columns is null or array_length(pk_columns, 1) is null then
    raise exception 'Table % is not registered for sync', target_table;
  end if;

  foreach column_name in array pk_columns loop
    pk := pk || jsonb_build_object(column_name, row_data -> column_name);
  end loop;

  return pk;
end;
$$;


ALTER FUNCTION "public"."sync_pk_for_row"("target_table" "text", "row_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_register_table"("target_table" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  pk_columns text[];
  trigger_name text;
begin
  select array_agg(a.attname order by a.attnum)
    into pk_columns
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid
     and a.attnum = any(i.indkey)
   where i.indrelid = format('public.%I', target_table)::regclass
     and i.indisprimary;

  if pk_columns is null or array_length(pk_columns, 1) is null then
    raise exception 'Cannot register %. It has no primary key.', target_table;
  end if;

  insert into public.sync_tables(table_name, primary_key_columns)
  values (target_table, pk_columns)
  on conflict (table_name) do update
  set primary_key_columns = excluded.primary_key_columns,
      updated_at = now();

  trigger_name := format('sync_touch_%s', target_table);
  execute format('drop trigger if exists %I on public.%I', trigger_name, target_table);
  execute format(
    'create trigger %I after insert or update or delete on public.%I for each row execute function public.sync_touch_entity()',
    trigger_name,
    target_table
  );
end;
$$;


ALTER FUNCTION "public"."sync_register_table"("target_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_touch_entity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  row_data jsonb;
  entity_pk jsonb;
  owner uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_pk := public.sync_pk_for_row(tg_table_name, row_data);
  owner := nullif(row_data ->> 'user_id', '')::uuid;

  insert into public.sync_entities (
    table_name,
    pk,
    operation,
    row_hash,
    user_id,
    changed_at,
    deleted_at
  )
  values (
    tg_table_name,
    entity_pk,
    lower(tg_op),
    case when tg_op = 'DELETE' then null else encode(digest(row_data::text, 'sha256'), 'hex') end,
    owner,
    now(),
    case when tg_op = 'DELETE' then now() else null end
  )
  on conflict (table_name, pk) do update
  set operation = excluded.operation,
      row_hash = excluded.row_hash,
      user_id = excluded.user_id,
      changed_at = excluded.changed_at,
      deleted_at = excluded.deleted_at;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."sync_touch_entity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_curriculum_drafts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_curriculum_drafts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_trusted_auth_device"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  matched public.trusted_auth_devices%rowtype;
begin
  if auth.uid() is null or length(coalesce(p_token, '')) < 43 then
    return jsonb_build_object('valid', false);
  end if;
  select * into matched
    from public.trusted_auth_devices
   where user_id = auth.uid()
     and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
     and expires_at > now();
  if not found then
    return jsonb_build_object('valid', false);
  end if;
  update public.trusted_auth_devices set last_used_at = now() where id = matched.id;
  return jsonb_build_object('valid', true, 'expires_at', matched.expires_at);
end;
$$;


ALTER FUNCTION "public"."verify_trusted_auth_device"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."yoga_parse_hold_seconds"("p_hold" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $_$
declare
    normalized text := lower(btrim(p_hold));
    matched text[];
    total_seconds numeric := 0;
begin
    if normalized is null or normalized = '' or normalized = '-' then
        return null;
    end if;

    -- Existing hold_json values are authored as seconds.
    if normalized ~ '^\d+(\.\d+)?$' then
        return round(normalized::numeric)::integer;
    end if;

    -- Also accept clock notation and common unit labels for compatibility
    -- with manually authored sequence durations.
    matched := regexp_match(normalized, '^(\d+):(\d{1,2})(?::(\d{1,2}))?$');
    if matched is not null then
        if matched[3] is null then
            return matched[1]::integer * 60 + matched[2]::integer;
        end if;

        return matched[1]::integer * 3600
            + matched[2]::integer * 60
            + matched[3]::integer;
    end if;

    matched := regexp_match(
        normalized,
        '(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?:\s|$)'
    );
    if matched is not null then
        total_seconds := total_seconds + matched[1]::numeric * 3600;
    end if;

    matched := regexp_match(
        normalized,
        '(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)(?:\s|$)'
    );
    if matched is not null then
        total_seconds := total_seconds + matched[1]::numeric * 60;
    end if;

    matched := regexp_match(
        normalized,
        '(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)(?:\s|$)'
    );
    if matched is not null then
        total_seconds := total_seconds + matched[1]::numeric;
    end if;

    if total_seconds > 0 then
        return round(total_seconds)::integer;
    end if;

    return null;
exception
    when invalid_text_representation then
        return null;
end;
$_$;


ALTER FUNCTION "public"."yoga_parse_hold_seconds"("p_hold" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_recovery_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "public_reference" "text" NOT NULL,
    "requested_email" "text" NOT NULL,
    "user_id" "uuid",
    "requester_hash" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "code_hash" "text",
    "reset_mfa" boolean DEFAULT false NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "expires_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "account_recovery_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'completed'::"text", 'expired'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."account_recovery_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."account_recovery_requests" IS 'Service-role-only audit records for administrator-approved, no-email account recovery.';



CREATE TABLE IF NOT EXISTS "public"."asana_categories" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "color_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asana_categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."asana_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."asana_categories_id_seq" OWNER TO "postgres";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'asana_categories'
      AND a.attname = 'id'
      AND a.attidentity = ''
  ) THEN
    ALTER SEQUENCE "public"."asana_categories_id_seq"
      OWNED BY "public"."asana_categories"."id";
  END IF;
END $$;





CREATE TABLE IF NOT EXISTS "public"."asanas" (
    "id" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "iast" "text" DEFAULT ''::"text",
    "english_name" "text" DEFAULT ''::"text",
    "technique" "text" DEFAULT ''::"text",
    "plate_numbers" "text" DEFAULT ''::"text",
    "requires_sides" boolean DEFAULT false,
    "page_2001" "text" DEFAULT ''::"text",
    "page_2015" "text" DEFAULT ''::"text",
    "intensity" "text" DEFAULT ''::"text",
    "note" "text" DEFAULT ''::"text",
    "category" "text" DEFAULT ''::"text",
    "description" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category_id" bigint,
    "image_url" "text",
    "page_primary" numeric(6,2),
    "is_restorative" boolean DEFAULT false,
    "hold_json" "jsonb",
    "category_legacy" "text",
    "last_edited" "text",
    "is_system" boolean DEFAULT true,
    "stages" "text",
    "recovery_pose_id" "text",
    "preparatory_pose_id" "text",
    "how_to_use_yoga_id" "text",
    "yoga_the_iyengar_way_id" "text",
    "devanagari" "text",
    "translation" "text",
    "oracle_lore" "text",
    "symbol_prompt" "text",
    "is_curated" boolean DEFAULT false,
    "audio_url" "text",
    "variation_code" "text",
    "gem_plate" "text"
);


ALTER TABLE "public"."asanas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."completion_rating_options" (
    "rating" integer NOT NULL,
    "feedback_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "subtitle" "text",
    "emoji" "text",
    "progression_score" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."completion_rating_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_analysis_refresh_queue" (
    "course_id" bigint NOT NULL,
    "reason" "text" DEFAULT 'trigger'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text"
);


ALTER TABLE "public"."course_analysis_refresh_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_categories" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."course_categories" OWNER TO "postgres";


ALTER TABLE "public"."course_categories" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."course_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."course_pose_index" (
    "course_id" bigint NOT NULL,
    "pose_id" "text" NOT NULL,
    "occurrence_count" integer DEFAULT 1 NOT NULL,
    "first_order_index" integer,
    "source_type" "text" DEFAULT 'direct'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_pose_index_occurrence_count_check" CHECK (("occurrence_count" > 0)),
    CONSTRAINT "course_pose_index_pose_id_not_blank" CHECK (("btrim"("pose_id") <> ''::"text")),
    CONSTRAINT "course_pose_index_source_type_not_blank" CHECK (("btrim"("source_type") <> ''::"text"))
);


ALTER TABLE "public"."course_pose_index" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_sequence_analysis" (
    "course_id" bigint NOT NULL,
    "course_title" "text",
    "primary_theme" "text",
    "secondary_theme" "text",
    "top_theme_share" numeric,
    "second_theme_share" numeric,
    "weighted_intensity" numeric,
    "max_intensity" numeric,
    "intensity_band" "text",
    "intensity_profile" "jsonb",
    "total_duration_seconds" integer,
    "total_duration_minutes" numeric,
    "theme_classification_seconds" integer,
    "theme_classification_minutes" numeric,
    "pose_count" integer,
    "restorative_seconds" integer,
    "restorative_minutes" numeric,
    "restorative_share" numeric,
    "theme_profile" "jsonb",
    "all_theme_profile" "jsonb",
    "restorative_theme_profile" "jsonb",
    "missing_pose_ids" "jsonb",
    "missing_stage_ids" "jsonb",
    "analysed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_sequence_analysis" OWNER TO "postgres";


COMMENT ON TABLE "public"."course_sequence_analysis" IS 'Derived course sequence analysis cache populated by refresh_course_sequence_analysis_for_course().';



CREATE TABLE IF NOT EXISTS "public"."course_stage_variants" (
    "id" bigint NOT NULL,
    "parent_course_id" bigint NOT NULL,
    "variant_course_id" bigint NOT NULL,
    "stage_key" "text" NOT NULL,
    "phase_week_start" integer NOT NULL,
    "phase_week_end" integer NOT NULL,
    "source_rule" "text" NOT NULL,
    "approved_parent_sha256" "text" NOT NULL,
    "is_authored_source" boolean DEFAULT false NOT NULL,
    "approved_on" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "manifest_version" "text",
    "approved_variant_sha256" "text",
    CONSTRAINT "course_stage_variants_approved_parent_sha256_check" CHECK (("approved_parent_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "course_stage_variants_check" CHECK (("phase_week_end" >= "phase_week_start")),
    CONSTRAINT "course_stage_variants_check1" CHECK (((("stage_key" = 'full'::"text") AND "is_authored_source") OR (("stage_key" <> 'full'::"text") AND (NOT "is_authored_source")))),
    CONSTRAINT "course_stage_variants_manifest_version_not_blank" CHECK ((("manifest_version" IS NULL) OR ("btrim"("manifest_version") <> ''::"text"))),
    CONSTRAINT "course_stage_variants_phase_week_start_check" CHECK (("phase_week_start" >= 1)),
    CONSTRAINT "course_stage_variants_source_rule_check" CHECK (("btrim"("source_rule") <> ''::"text")),
    CONSTRAINT "course_stage_variants_stage_key_check" CHECK (("stage_key" = ANY (ARRAY['early'::"text", 'developing'::"text", 'full'::"text"]))),
    CONSTRAINT "course_stage_variants_variant_sha256_format" CHECK ((("approved_variant_sha256" IS NULL) OR ("approved_variant_sha256" ~ '^[0-9a-f]{64}$'::"text")))
);


ALTER TABLE "public"."course_stage_variants" OWNER TO "postgres";


COMMENT ON TABLE "public"."course_stage_variants" IS 'Approved Gem parent/stage mappings. Early and Developing courses are derived variants and must not be counted as additional authored source courses.';



COMMENT ON COLUMN "public"."course_stage_variants"."is_authored_source" IS 'True only for the unchanged Full parent mapping; false marks generated variants for source-inventory audits.';



COMMENT ON COLUMN "public"."course_stage_variants"."manifest_version" IS 'Reviewed manifest version that produced this mapping and variant sequence.';



COMMENT ON COLUMN "public"."course_stage_variants"."approved_variant_sha256" IS 'SHA-256 of the approved variant sequence_json text for drift detection.';



ALTER TABLE "public"."course_stage_variants" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."course_stage_variants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."course_sub_categories" (
    "id" bigint NOT NULL,
    "category_id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."course_sub_categories" OWNER TO "postgres";


ALTER TABLE "public"."course_sub_categories" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."course_sub_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" integer NOT NULL,
    "course_id" integer,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text",
    "sequence_text" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "is_system" boolean DEFAULT false,
    "sequence_json" "jsonb",
    "sequence_text_ARCHIVED" "text",
    "last_edited" timestamp with time zone,
    "sub_category_id" bigint,
    "redirect_id" bigint,
    "is_alias" boolean DEFAULT false,
    "condition_notes" "text",
    "source_sequence_id" "text"
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."courses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."courses_id_seq" OWNER TO "postgres";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'courses'
      AND a.attname = 'id'
      AND a.attidentity = ''
  ) THEN
    ALTER SEQUENCE "public"."courses_id_seq"
      OWNED BY "public"."courses"."id";
  END IF;
END $$;





CREATE TABLE IF NOT EXISTS "public"."curriculum_drafts" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "curriculum_slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "draft_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."curriculum_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."curriculum_mastery_decisions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "curriculum_slug" "text" NOT NULL,
    "repeat_group" "text" NOT NULL,
    "easy_rating_count" integer NOT NULL,
    "mastered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "curriculum_mastery_decisions_easy_rating_count_check" CHECK (("easy_rating_count" >= 3))
);


ALTER TABLE "public"."curriculum_mastery_decisions" OWNER TO "postgres";


ALTER TABLE "public"."curriculum_mastery_decisions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."curriculum_mastery_decisions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."curriculum_optional_stage_enrollments" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "curriculum_slug" "text" NOT NULL,
    "stage_key" "text" NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "curriculum_optional_stage_enrollments_stage_key_check" CHECK (("btrim"("stage_key") <> ''::"text"))
);


ALTER TABLE "public"."curriculum_optional_stage_enrollments" OWNER TO "postgres";


COMMENT ON TABLE "public"."curriculum_optional_stage_enrollments" IS 'Explicit user opt-ins for optional curriculum continuations. Absence leaves the user at the stage gate.';



ALTER TABLE "public"."curriculum_optional_stage_enrollments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."curriculum_optional_stage_enrollments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."media_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text",
    "source_pk" "jsonb",
    "source_column" "text",
    "media_type" "text" NOT NULL,
    "original_bucket" "text" NOT NULL,
    "original_path" "text" NOT NULL,
    "offline_bucket" "text",
    "offline_path" "text",
    "content_hash" "text",
    "byte_size" bigint,
    "width" integer,
    "height" integer,
    "duration_seconds" numeric,
    "variant_format" "text",
    "variant_quality" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "media_assets_media_type_check" CHECK (("media_type" = ANY (ARRAY['image'::"text", 'audio'::"text"])))
);


ALTER TABLE "public"."media_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offline_download_packs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "pack_type" "text" NOT NULL,
    "pack_key" "text" NOT NULL,
    "title" "text",
    "manifest" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."offline_download_packs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_curriculum" (
    "id" bigint NOT NULL,
    "curriculum_slug" "text" NOT NULL,
    "program_name" "text",
    "week_number" integer,
    "day_number" integer,
    "order_index" numeric,
    "node_type" "text",
    "sequence_id" bigint,
    "source_name" "text",
    "source_key" "text",
    "source_course" "text",
    "source_reference" "text",
    "practice_track" "text",
    "curriculum_phase" "text",
    "intensity" "text",
    "primary_focus" "text",
    "special_instructions" "text",
    "requires_user_selection" boolean DEFAULT false NOT NULL,
    "is_rest_day" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_revision_node" boolean DEFAULT false NOT NULL,
    "completion_requirement" "text",
    "level_number" integer,
    "curriculum_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "day_role" "text",
    "recovery_type" "text",
    "is_visible" boolean DEFAULT true NOT NULL,
    "source_policy" "text",
    "source_sequence_order" integer,
    "estimated_minutes" integer,
    "curriculum_unit_id" "text",
    "adaptive_behavior" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_rule_id" "text",
    "generated_from_rule" boolean DEFAULT false,
    "is_optional" boolean DEFAULT false,
    "mastery_gate_required" boolean DEFAULT false,
    CONSTRAINT "program_curriculum_completion_requirement_check" CHECK (("completion_requirement" = ANY (ARRAY['none'::"text", 'attempt'::"text", 'complete'::"text", 'complete_all_parts'::"text", 'repeat_until_ready'::"text", 'optional'::"text", 'choose_one'::"text", 'acknowledge'::"text"]))),
    CONSTRAINT "program_curriculum_node_type_check" CHECK (("node_type" = ANY (ARRAY['sequence'::"text", 'composed_sequence'::"text", 'revision'::"text", 'choice'::"text", 'recovery'::"text", 'consolidation'::"text", 'mastery_gate'::"text", 'instruction'::"text", 'assessment'::"text", 'reserve'::"text", 'rest'::"text"])))
);


ALTER TABLE "public"."program_curriculum" OWNER TO "postgres";


ALTER TABLE "public"."program_curriculum" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."program_curriculum_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."props" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text",
    "color" "text",
    "audio_cue" "text",
    "banner_title" "text",
    "banner_html" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."props" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stages" (
    "parent_id" "text"[] DEFAULT '{}'::"text"[],
    "stage_name" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text",
    "full_technique" "text" DEFAULT ''::"text",
    "shorthand" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "asana_id" "text",
    "image_url" "text",
    "devanagari" "text",
    "page_primary" numeric(6,2),
    "recovery_pose_id" "text",
    "id" bigint NOT NULL,
    "plate_number" "text",
    "hold_legacy" "text",
    "preparatory_pose_id" "text",
    "translation" "text",
    "oracle_lore" "text",
    "symbol_prompt" "text",
    "is_curated" boolean DEFAULT false,
    "audio_url" "text",
    "audio_title" "text",
    "sort_order" integer,
    "hold_json" "jsonb",
    "intensity_override" "text",
    "category_id_override" bigint,
    "is_restorative" boolean DEFAULT false,
    "analysis_notes" "text"
);


ALTER TABLE "public"."stages" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."searchable_asanas_view" AS
 SELECT "a"."id" AS "source_id",
    "a"."id" AS "asana_id",
    "a"."english_name" AS "display_name",
    "a"."iast",
    "a"."name",
    "ac"."name" AS "category",
    "a"."image_url",
    "a"."page_primary",
    NULL::"text" AS "stage_name",
    NULL::"text" AS "stage_title",
    NULL::"text" AS "stage_shorthand",
    'asana'::"text" AS "source_type"
   FROM ("public"."asanas" "a"
     LEFT JOIN "public"."asana_categories" "ac" ON (("ac"."id" = "a"."category_id")))
UNION ALL
 SELECT ("s"."id")::"text" AS "source_id",
    "s"."asana_id",
    COALESCE("s"."title", "a"."english_name") AS "display_name",
    "s"."devanagari" AS "iast",
    COALESCE("s"."title", "a"."name") AS "name",
    "ac"."name" AS "category",
    COALESCE("s"."image_url", "a"."image_url") AS "image_url",
    "s"."page_primary",
    "s"."stage_name",
    "s"."title" AS "stage_title",
    "s"."shorthand" AS "stage_shorthand",
    'stage'::"text" AS "source_type"
   FROM (("public"."stages" "s"
     LEFT JOIN "public"."asanas" "a" ON (("a"."id" = "s"."asana_id")))
     LEFT JOIN "public"."asana_categories" "ac" ON (("ac"."id" = "a"."category_id")));


ALTER VIEW "public"."searchable_asanas_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sequence_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text",
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration_seconds" integer DEFAULT 0,
    "notes" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed" boolean DEFAULT true NOT NULL,
    "user_id" "uuid",
    "sequence_id" bigint,
    "curriculum_node_id" bigint,
    "status" "text",
    "rating" integer,
    "difficulty_feedback" "text",
    "duration_scale_used" numeric(6,3),
    "planned_duration_minutes" numeric(8,2),
    "actual_adjusted_duration_minutes" numeric(8,2),
    "source_type" "text" DEFAULT 'manual'::"text",
    "source_sequence_id" "text",
    "profile_sequence_id" "text",
    "sequence_hash" "text",
    "sequence_snapshot" "jsonb"
);


ALTER TABLE "public"."sequence_completions" OWNER TO "postgres";


ALTER TABLE "public"."stages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sync_entities" (
    "table_name" "text" NOT NULL,
    "pk" "jsonb" NOT NULL,
    "operation" "text" NOT NULL,
    "server_version" bigint NOT NULL,
    "row_hash" "text",
    "user_id" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "sync_entities_operation_check" CHECK (("operation" = ANY (ARRAY['insert'::"text", 'update'::"text", 'delete'::"text"])))
);


ALTER TABLE "public"."sync_entities" OWNER TO "postgres";


ALTER TABLE "public"."sync_entities" ALTER COLUMN "server_version" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sync_entities_server_version_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sync_mutations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_mutation_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "pk" "jsonb",
    "operation" "text" NOT NULL,
    "base_server_version" bigint,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "conflict" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_at" timestamp with time zone,
    CONSTRAINT "sync_mutations_operation_check" CHECK (("operation" = ANY (ARRAY['insert'::"text", 'update'::"text", 'delete'::"text"]))),
    CONSTRAINT "sync_mutations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'applied'::"text", 'conflicted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."sync_mutations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_tables" (
    "table_name" "text" NOT NULL,
    "primary_key_columns" "text"[] NOT NULL,
    "readable_offline" boolean DEFAULT true NOT NULL,
    "writable_offline" boolean DEFAULT true NOT NULL,
    "registered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sync_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trusted_auth_devices" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "device_label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."trusted_auth_devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_asana_overrides" (
    "user_id" "uuid" NOT NULL,
    "asana_id" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_asana_overrides_payload_check" CHECK (("jsonb_typeof"("payload") = 'object'::"text"))
);


ALTER TABLE "public"."user_asana_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_asanas" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text",
    "iast" "text" DEFAULT ''::"text",
    "english_name" "text" DEFAULT ''::"text",
    "technique" "text" DEFAULT ''::"text",
    "plate_numbers" "text" DEFAULT ''::"text",
    "requires_sides" boolean DEFAULT false,
    "page_2001" "text" DEFAULT ''::"text",
    "page_2015" "text" DEFAULT ''::"text",
    "intensity" "text" DEFAULT ''::"text",
    "note" "text" DEFAULT ''::"text",
    "category" "text" DEFAULT ''::"text",
    "description" "text" DEFAULT ''::"text",
    "hold" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_asanas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "preferences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "preferences_object" CHECK (("jsonb_typeof"("preferences") = 'object'::"text"))
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_prop_overrides" (
    "user_id" "uuid" NOT NULL,
    "prop_id" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_prop_overrides_payload_check" CHECK (("jsonb_typeof"("payload") = 'object'::"text"))
);


ALTER TABLE "public"."user_prop_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_sequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text",
    "sequence_text" "text" DEFAULT ''::"text" NOT NULL,
    "pose_count" integer DEFAULT 0,
    "total_seconds" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "parent_id" "text"[] NOT NULL,
    "stage_name" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text",
    "full_technique" "text" DEFAULT ''::"text",
    "shorthand" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "hold" "text"
);


ALTER TABLE "public"."user_stages" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_asanas_admin" AS
 SELECT "a"."id",
    "a"."name",
    "a"."iast",
    "a"."english_name",
    "a"."technique",
    "a"."description",
    "ac"."name" AS "category",
    "a"."category_id",
    "a"."gem_plate",
    "a"."plate_numbers",
    "a"."hold_json",
    "a"."page_primary",
    "a"."requires_sides",
    "a"."preparatory_pose_id",
    "a"."recovery_pose_id",
    "a"."audio_url",
    "a"."image_url",
    "a"."intensity",
    "a"."is_system",
    "a"."is_curated",
    NULL::"uuid" AS "user_id"
   FROM ("public"."asanas" "a"
     LEFT JOIN "public"."asana_categories" "ac" ON (("ac"."id" = "a"."category_id")));


ALTER VIEW "public"."view_asanas_admin" OWNER TO "postgres";


ALTER TABLE ONLY "public"."asana_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."asana_categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."courses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."courses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."account_recovery_requests"
    ADD CONSTRAINT "account_recovery_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_recovery_requests"
    ADD CONSTRAINT "account_recovery_requests_public_reference_key" UNIQUE ("public_reference");



ALTER TABLE ONLY "public"."asana_categories"
    ADD CONSTRAINT "asana_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."asana_categories"
    ADD CONSTRAINT "asana_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asanas"
    ADD CONSTRAINT "asanas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."completion_rating_options"
    ADD CONSTRAINT "completion_rating_options_pkey" PRIMARY KEY ("rating");



ALTER TABLE ONLY "public"."course_analysis_refresh_queue"
    ADD CONSTRAINT "course_analysis_refresh_queue_pkey" PRIMARY KEY ("course_id");



ALTER TABLE ONLY "public"."course_categories"
    ADD CONSTRAINT "course_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."course_categories"
    ADD CONSTRAINT "course_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_pose_index"
    ADD CONSTRAINT "course_pose_index_pkey" PRIMARY KEY ("course_id", "pose_id", "source_type");



ALTER TABLE ONLY "public"."course_sequence_analysis"
    ADD CONSTRAINT "course_sequence_analysis_pkey" PRIMARY KEY ("course_id");



ALTER TABLE ONLY "public"."course_stage_variants"
    ADD CONSTRAINT "course_stage_variants_parent_course_id_stage_key_key" UNIQUE ("parent_course_id", "stage_key");



ALTER TABLE ONLY "public"."course_stage_variants"
    ADD CONSTRAINT "course_stage_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_stage_variants"
    ADD CONSTRAINT "course_stage_variants_variant_course_id_key" UNIQUE ("variant_course_id");



ALTER TABLE ONLY "public"."course_sub_categories"
    ADD CONSTRAINT "course_sub_categories_category_id_name_key" UNIQUE ("category_id", "name");



ALTER TABLE ONLY "public"."course_sub_categories"
    ADD CONSTRAINT "course_sub_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."curriculum_drafts"
    ADD CONSTRAINT "curriculum_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."curriculum_drafts"
    ADD CONSTRAINT "curriculum_drafts_user_slug_unique" UNIQUE ("user_id", "curriculum_slug");



ALTER TABLE ONLY "public"."curriculum_mastery_decisions"
    ADD CONSTRAINT "curriculum_mastery_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."curriculum_mastery_decisions"
    ADD CONSTRAINT "curriculum_mastery_decisions_user_id_curriculum_slug_repeat_key" UNIQUE ("user_id", "curriculum_slug", "repeat_group");



ALTER TABLE ONLY "public"."curriculum_optional_stage_enrollments"
    ADD CONSTRAINT "curriculum_optional_stage_enr_user_id_curriculum_slug_stage_key" UNIQUE ("user_id", "curriculum_slug", "stage_key");



ALTER TABLE ONLY "public"."curriculum_optional_stage_enrollments"
    ADD CONSTRAINT "curriculum_optional_stage_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."media_assets"
    ADD CONSTRAINT "media_assets_media_type_original_bucket_original_path_key" UNIQUE ("media_type", "original_bucket", "original_path");



ALTER TABLE ONLY "public"."media_assets"
    ADD CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offline_download_packs"
    ADD CONSTRAINT "offline_download_packs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offline_download_packs"
    ADD CONSTRAINT "offline_download_packs_user_id_pack_type_pack_key_key" UNIQUE ("user_id", "pack_type", "pack_key");



ALTER TABLE ONLY "public"."program_curriculum"
    ADD CONSTRAINT "program_curriculum_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."props"
    ADD CONSTRAINT "props_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sequence_completions"
    ADD CONSTRAINT "sequence_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stages"
    ADD CONSTRAINT "stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_entities"
    ADD CONSTRAINT "sync_entities_pkey" PRIMARY KEY ("table_name", "pk");



ALTER TABLE ONLY "public"."sync_mutations"
    ADD CONSTRAINT "sync_mutations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_mutations"
    ADD CONSTRAINT "sync_mutations_user_id_client_mutation_id_key" UNIQUE ("user_id", "client_mutation_id");



ALTER TABLE ONLY "public"."sync_tables"
    ADD CONSTRAINT "sync_tables_pkey" PRIMARY KEY ("table_name");



ALTER TABLE ONLY "public"."trusted_auth_devices"
    ADD CONSTRAINT "trusted_auth_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trusted_auth_devices"
    ADD CONSTRAINT "trusted_auth_devices_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."user_asana_overrides"
    ADD CONSTRAINT "user_asana_overrides_pkey" PRIMARY KEY ("user_id", "asana_id");



ALTER TABLE ONLY "public"."user_asanas"
    ADD CONSTRAINT "user_asanas_pkey" PRIMARY KEY ("id", "user_id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_prop_overrides"
    ADD CONSTRAINT "user_prop_overrides_pkey" PRIMARY KEY ("user_id", "prop_id");



ALTER TABLE ONLY "public"."user_sequences"
    ADD CONSTRAINT "user_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_stages"
    ADD CONSTRAINT "user_stages_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_recovery_requests_email_time_idx" ON "public"."account_recovery_requests" USING "btree" ("requested_email", "requested_at" DESC);



CREATE INDEX "account_recovery_requests_status_time_idx" ON "public"."account_recovery_requests" USING "btree" ("status", "requested_at" DESC);



CREATE INDEX "course_pose_index_course_id_idx" ON "public"."course_pose_index" USING "btree" ("course_id");



CREATE INDEX "course_pose_index_pose_id_idx" ON "public"."course_pose_index" USING "btree" ("pose_id");



CREATE INDEX "course_pose_index_pose_source_idx" ON "public"."course_pose_index" USING "btree" ("pose_id", "source_type");



CREATE INDEX "courses_user_source_sequence_idx" ON "public"."courses" USING "btree" ("user_id", "source_sequence_id");



CREATE INDEX "idx_courses_course_id" ON "public"."courses" USING "btree" ("course_id");



CREATE INDEX "idx_curriculum_drafts_user_updated_at" ON "public"."curriculum_drafts" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "idx_media_assets_source" ON "public"."media_assets" USING "btree" ("source_table", "source_pk");



CREATE INDEX "idx_media_assets_updated_at" ON "public"."media_assets" USING "btree" ("updated_at");



CREATE INDEX "idx_program_curriculum_slug_order" ON "public"."program_curriculum" USING "btree" ("curriculum_slug", "order_index") WHERE ("is_active" = true);



CREATE INDEX "idx_program_curriculum_slug_visible_order" ON "public"."program_curriculum" USING "btree" ("curriculum_slug", "order_index") WHERE (("is_active" = true) AND ("is_visible" = true));



CREATE INDEX "idx_seq_completions_completed_at" ON "public"."sequence_completions" USING "btree" ("completed_at" DESC);



CREATE INDEX "idx_seq_completions_curriculum_completed" ON "public"."sequence_completions" USING "btree" ("curriculum_node_id", "completed_at" DESC) WHERE (("curriculum_node_id" IS NOT NULL) AND ("completed" = true));



CREATE INDEX "idx_seq_completions_title" ON "public"."sequence_completions" USING "btree" ("title");



CREATE INDEX "idx_seq_completions_user_completed_at" ON "public"."sequence_completions" USING "btree" ("user_id", "completed_at" DESC);



CREATE INDEX "idx_sync_entities_changed_at" ON "public"."sync_entities" USING "btree" ("changed_at");



CREATE INDEX "idx_sync_entities_version" ON "public"."sync_entities" USING "btree" ("server_version");



CREATE INDEX "idx_sync_mutations_user_status" ON "public"."sync_mutations" USING "btree" ("user_id", "status", "created_at");



CREATE INDEX "idx_user_sequences_created" ON "public"."user_sequences" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_user_sequences_title" ON "public"."user_sequences" USING "btree" ("title");



CREATE INDEX "sequence_completions_curriculum_node_idx" ON "public"."sequence_completions" USING "btree" ("user_id", "curriculum_node_id") WHERE ("curriculum_node_id" IS NOT NULL);



CREATE INDEX "trusted_auth_devices_user_expiry_idx" ON "public"."trusted_auth_devices" USING "btree" ("user_id", "expires_at" DESC);



CREATE OR REPLACE TRIGGER "curriculum_drafts_touch_updated_at" BEFORE UPDATE ON "public"."curriculum_drafts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_curriculum_drafts_updated_at"();



CREATE OR REPLACE TRIGGER "refresh_course_pose_index_on_courses" AFTER INSERT OR UPDATE OF "sequence_json" ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_course_pose_index_trigger"();



CREATE OR REPLACE TRIGGER "sync_touch_asana_categories" AFTER INSERT OR DELETE OR UPDATE ON "public"."asana_categories" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_asanas" AFTER INSERT OR DELETE OR UPDATE ON "public"."asanas" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_completion_rating_options" AFTER INSERT OR DELETE OR UPDATE ON "public"."completion_rating_options" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_course_analysis_refresh_queue" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_analysis_refresh_queue" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_course_categories" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_categories" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_course_pose_index" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_pose_index" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_course_sub_categories" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_sub_categories" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_courses" AFTER INSERT OR DELETE OR UPDATE ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_program_curriculum" AFTER INSERT OR DELETE OR UPDATE ON "public"."program_curriculum" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_props" AFTER INSERT OR DELETE OR UPDATE ON "public"."props" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_sequence_completions" AFTER INSERT OR DELETE OR UPDATE ON "public"."sequence_completions" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_stages" AFTER INSERT OR DELETE OR UPDATE ON "public"."stages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_user_asanas" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_asanas" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_user_sequences" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_sequences" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "sync_touch_user_stages" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_stages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_touch_entity"();



CREATE OR REPLACE TRIGGER "trg_queue_course_on_self_change" AFTER UPDATE OF "sequence_json", "title" ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."queue_course_for_self_change"();



CREATE OR REPLACE TRIGGER "trg_queue_courses_on_asana_change" AFTER INSERT OR UPDATE OF "intensity", "category_id", "is_restorative", "hold_json" ON "public"."asanas" FOR EACH ROW EXECUTE FUNCTION "public"."queue_courses_for_asana_change"();



CREATE OR REPLACE TRIGGER "trg_queue_courses_on_stage_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."stages" FOR EACH ROW EXECUTE FUNCTION "public"."queue_courses_for_stage_change"();



ALTER TABLE ONLY "public"."account_recovery_requests"
    ADD CONSTRAINT "account_recovery_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_recovery_requests"
    ADD CONSTRAINT "account_recovery_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asanas"
    ADD CONSTRAINT "asanas_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."asana_categories"("id");



ALTER TABLE ONLY "public"."course_analysis_refresh_queue"
    ADD CONSTRAINT "course_analysis_refresh_queue_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_pose_index"
    ADD CONSTRAINT "course_pose_index_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_sequence_analysis"
    ADD CONSTRAINT "course_sequence_analysis_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_stage_variants"
    ADD CONSTRAINT "course_stage_variants_parent_course_id_fkey" FOREIGN KEY ("parent_course_id") REFERENCES "public"."courses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_stage_variants"
    ADD CONSTRAINT "course_stage_variants_variant_course_id_fkey" FOREIGN KEY ("variant_course_id") REFERENCES "public"."courses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_sub_categories"
    ADD CONSTRAINT "course_sub_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."course_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "public"."course_sub_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."curriculum_drafts"
    ADD CONSTRAINT "curriculum_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."curriculum_mastery_decisions"
    ADD CONSTRAINT "curriculum_mastery_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."curriculum_optional_stage_enrollments"
    ADD CONSTRAINT "curriculum_optional_stage_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sequence_completions"
    ADD CONSTRAINT "sequence_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."sync_mutations"
    ADD CONSTRAINT "sync_mutations_table_name_fkey" FOREIGN KEY ("table_name") REFERENCES "public"."sync_tables"("table_name");



ALTER TABLE ONLY "public"."trusted_auth_devices"
    ADD CONSTRAINT "trusted_auth_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_asana_overrides"
    ADD CONSTRAINT "user_asana_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_prop_overrides"
    ADD CONSTRAINT "user_prop_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow anon delete user_sequences" ON "public"."user_sequences" FOR DELETE TO "anon" USING (true);



CREATE POLICY "Allow anon insert user_sequences" ON "public"."user_sequences" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Allow anon read user_sequences" ON "public"."user_sequences" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow anon update user_sequences" ON "public"."user_sequences" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow auth delete user_sequences" ON "public"."user_sequences" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow auth insert user_sequences" ON "public"."user_sequences" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow auth read user_sequences" ON "public"."user_sequences" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow auth update user_sequences" ON "public"."user_sequences" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Anyone can read active rating options" ON "public"."completion_rating_options" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Authenticated users can delete user_asanas" ON "public"."user_asanas" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can delete user_stages" ON "public"."user_stages" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can insert user_asanas" ON "public"."user_asanas" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can insert user_stages" ON "public"."user_stages" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can read user_asanas" ON "public"."user_asanas" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can read user_stages" ON "public"."user_stages" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can update user_asanas" ON "public"."user_asanas" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can update user_stages" ON "public"."user_stages" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users read media asset manifest" ON "public"."media_assets" FOR SELECT TO "authenticated" USING (("deleted_at" IS NULL));



CREATE POLICY "Authenticated users read sync entity versions" ON "public"."sync_entities" FOR SELECT TO "authenticated" USING ((("user_id" IS NULL) OR ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Authenticated users read sync table registry" ON "public"."sync_tables" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Guests read shared sequences" ON "public"."courses" FOR SELECT TO "anon" USING (COALESCE("is_system", false));



CREATE POLICY "Only authenticated users can delete rating options" ON "public"."completion_rating_options" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Only authenticated users can insert rating options" ON "public"."completion_rating_options" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Only authenticated users can update rating options" ON "public"."completion_rating_options" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Public can read course categories" ON "public"."course_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can read course subcategories" ON "public"."course_sub_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can read official curriculum" ON "public"."program_curriculum" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can read shared asanas" ON "public"."asanas" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can read shared props" ON "public"."props" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can read shared stages" ON "public"."stages" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read access to asana categories" ON "public"."asana_categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Require strong auth for own asana overrides" ON "public"."user_asana_overrides" AS RESTRICTIVE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (( SELECT ("auth"."jwt"() ->> 'aal'::"text")) = 'aal2'::"text"))) WITH CHECK ((("auth"."uid"() = "user_id") AND (( SELECT ("auth"."jwt"() ->> 'aal'::"text")) = 'aal2'::"text")));



CREATE POLICY "Require strong auth for own prop overrides" ON "public"."user_prop_overrides" AS RESTRICTIVE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (( SELECT ("auth"."jwt"() ->> 'aal'::"text")) = 'aal2'::"text"))) WITH CHECK ((("auth"."uid"() = "user_id") AND (( SELECT ("auth"."jwt"() ->> 'aal'::"text")) = 'aal2'::"text")));



CREATE POLICY "Users can create their own curriculum drafts" ON "public"."curriculum_drafts" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete their own curriculum drafts" ON "public"."curriculum_drafts" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read their own curriculum drafts" ON "public"."curriculum_drafts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update their own curriculum drafts" ON "public"."curriculum_drafts" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users create own sequences" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND (NOT COALESCE("is_system", false))));



CREATE POLICY "Users delete own completions" ON "public"."sequence_completions" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users delete own curriculum mastery" ON "public"."curriculum_mastery_decisions" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users delete own optional curriculum enrollments" ON "public"."curriculum_optional_stage_enrollments" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users delete own sequences" ON "public"."courses" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (NOT COALESCE("is_system", false))));



CREATE POLICY "Users insert own completions" ON "public"."sequence_completions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own curriculum mastery" ON "public"."curriculum_mastery_decisions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own optional curriculum enrollments" ON "public"."curriculum_optional_stage_enrollments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own offline download packs" ON "public"."offline_download_packs" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users manage own sync mutations" ON "public"."sync_mutations" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users manage their own asana overrides" ON "public"."user_asana_overrides" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage their own preferences" ON "public"."user_preferences" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users manage their own prop overrides" ON "public"."user_prop_overrides" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own completions" ON "public"."sequence_completions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own curriculum mastery" ON "public"."curriculum_mastery_decisions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own optional curriculum enrollments" ON "public"."curriculum_optional_stage_enrollments" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read shared and own sequences" ON "public"."courses" FOR SELECT TO "authenticated" USING ((COALESCE("is_system", false) OR ("auth"."uid"() = "user_id")));



CREATE POLICY "Users read visible course pose index" ON "public"."course_pose_index" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_pose_index"."course_id") AND ((COALESCE("c"."is_system", false) = true) OR ("auth"."uid"() = "c"."user_id"))))));



CREATE POLICY "Users read visible course stage variants" ON "public"."course_stage_variants" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."courses" "parent"
  WHERE (("parent"."id" = "course_stage_variants"."parent_course_id") AND (("parent"."is_system" = true) OR ("parent"."user_id" = "auth"."uid"()))))) AND (EXISTS ( SELECT 1
   FROM "public"."courses" "variant"
  WHERE (("variant"."id" = "course_stage_variants"."variant_course_id") AND (("variant"."is_system" = true) OR ("variant"."user_id" = "auth"."uid"())))))));



CREATE POLICY "Users update own completions" ON "public"."sequence_completions" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own optional curriculum enrollments" ON "public"."curriculum_optional_stage_enrollments" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own sequences" ON "public"."courses" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND (NOT COALESCE("is_system", false)))) WITH CHECK ((("auth"."uid"() = "user_id") AND (NOT COALESCE("is_system", false))));



ALTER TABLE "public"."account_recovery_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asana_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asanas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."completion_rating_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_analysis_refresh_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_pose_index" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_stage_variants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_sub_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."curriculum_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."curriculum_mastery_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."curriculum_optional_stage_enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."media_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offline_download_packs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."program_curriculum" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."props" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sequence_completions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_entities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_mutations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trusted_auth_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_asana_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_asanas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_prop_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_stages" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































GRANT ALL ON FUNCTION "public"."digest"("p_data" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."digest"("p_data" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."digest"("p_data" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_curriculum_node"("p_curriculum_slug" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_curriculum_node"("p_curriculum_slug" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_curriculum_node"("p_curriculum_slug" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_today_curriculum_practice"("p_curriculum_slug" "text", "p_user_id" "uuid", "p_repeat_node_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_today_curriculum_practice"("p_curriculum_slug" "text", "p_user_id" "uuid", "p_repeat_node_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_today_curriculum_practice"("p_curriculum_slug" "text", "p_user_id" "uuid", "p_repeat_node_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_trusted_auth_device_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_trusted_auth_device_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_trusted_auth_device_access"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_device_profile"("p_backup" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_device_profile"("p_backup" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_device_profile"("p_backup" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_course_pose_id"("p_pose_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_course_pose_id"("p_pose_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_course_pose_id"("p_pose_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_course_analysis_refresh_queue"("limit_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_course_analysis_refresh_queue"("limit_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_course_analysis_refresh"("p_course_id" bigint, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_course_analysis_refresh"("p_course_id" bigint, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_course_for_self_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_course_for_self_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_courses_for_asana_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_courses_for_asana_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_courses_for_stage_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_courses_for_stage_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_course_pose_index"("p_course_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_course_pose_index"("p_course_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_course_pose_index_trigger"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_course_pose_index_trigger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_course_sequence_analysis_for_course"("p_course_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_course_sequence_analysis_for_course"("p_course_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_trusted_auth_device"("p_token" "text", "p_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_trusted_auth_device"("p_token" "text", "p_label" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_trusted_auth_device"("p_token" "text", "p_label" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_revision_curriculum_node"("p_curriculum_node_id" bigint, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_revision_curriculum_node"("p_curriculum_node_id" bigint, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_revision_curriculum_node"("p_curriculum_node_id" bigint, "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_trusted_auth_device"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_trusted_auth_device"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."revoke_trusted_auth_device"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."service_revoke_user_sessions"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."service_revoke_user_sessions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_has_conflict"("target_table" "text", "target_pk" "jsonb", "base_server_version" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."sync_has_conflict"("target_table" "text", "target_pk" "jsonb", "base_server_version" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_has_conflict"("target_table" "text", "target_pk" "jsonb", "base_server_version" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_pk_for_row"("target_table" "text", "row_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_pk_for_row"("target_table" "text", "row_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_pk_for_row"("target_table" "text", "row_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_register_table"("target_table" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_register_table"("target_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_register_table"("target_table" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_touch_entity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_touch_entity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_curriculum_drafts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_curriculum_drafts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_curriculum_drafts_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_trusted_auth_device"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_trusted_auth_device"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_trusted_auth_device"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."yoga_parse_hold_seconds"("p_hold" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."yoga_parse_hold_seconds"("p_hold" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."yoga_parse_hold_seconds"("p_hold" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."account_recovery_requests" TO "service_role";



GRANT ALL ON TABLE "public"."asana_categories" TO "anon";
GRANT ALL ON TABLE "public"."asana_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."asana_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."asana_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."asana_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."asana_categories_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."asanas" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."asanas" TO "authenticated";
GRANT ALL ON TABLE "public"."asanas" TO "service_role";



GRANT ALL ON TABLE "public"."completion_rating_options" TO "anon";
GRANT ALL ON TABLE "public"."completion_rating_options" TO "authenticated";
GRANT ALL ON TABLE "public"."completion_rating_options" TO "service_role";



GRANT ALL ON TABLE "public"."course_analysis_refresh_queue" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."course_categories" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."course_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."course_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."course_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."course_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."course_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."course_pose_index" TO "anon";
GRANT ALL ON TABLE "public"."course_pose_index" TO "authenticated";
GRANT ALL ON TABLE "public"."course_pose_index" TO "service_role";



GRANT ALL ON TABLE "public"."course_sequence_analysis" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."course_sequence_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."course_sequence_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."course_stage_variants" TO "anon";
GRANT ALL ON TABLE "public"."course_stage_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."course_stage_variants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."course_stage_variants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."course_stage_variants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."course_stage_variants_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."course_sub_categories" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."course_sub_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."course_sub_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."course_sub_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."course_sub_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."course_sub_categories_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."courses" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."curriculum_drafts" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."curriculum_drafts" TO "authenticated";



GRANT ALL ON TABLE "public"."curriculum_mastery_decisions" TO "anon";
GRANT ALL ON TABLE "public"."curriculum_mastery_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."curriculum_mastery_decisions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."curriculum_mastery_decisions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."curriculum_mastery_decisions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."curriculum_mastery_decisions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."curriculum_optional_stage_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."curriculum_optional_stage_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."curriculum_optional_stage_enrollments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."curriculum_optional_stage_enrollments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."curriculum_optional_stage_enrollments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."curriculum_optional_stage_enrollments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."media_assets" TO "anon";
GRANT ALL ON TABLE "public"."media_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."media_assets" TO "service_role";



GRANT ALL ON TABLE "public"."offline_download_packs" TO "anon";
GRANT ALL ON TABLE "public"."offline_download_packs" TO "authenticated";
GRANT ALL ON TABLE "public"."offline_download_packs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."program_curriculum" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."program_curriculum" TO "authenticated";
GRANT ALL ON TABLE "public"."program_curriculum" TO "service_role";



GRANT ALL ON SEQUENCE "public"."program_curriculum_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."program_curriculum_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."program_curriculum_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."props" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."props" TO "authenticated";
GRANT ALL ON TABLE "public"."props" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stages" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stages" TO "authenticated";
GRANT ALL ON TABLE "public"."stages" TO "service_role";



GRANT ALL ON TABLE "public"."searchable_asanas_view" TO "anon";
GRANT ALL ON TABLE "public"."searchable_asanas_view" TO "authenticated";
GRANT ALL ON TABLE "public"."searchable_asanas_view" TO "service_role";



GRANT ALL ON TABLE "public"."sequence_completions" TO "anon";
GRANT ALL ON TABLE "public"."sequence_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."sequence_completions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sync_entities" TO "anon";
GRANT ALL ON TABLE "public"."sync_entities" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_entities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sync_entities_server_version_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sync_entities_server_version_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sync_entities_server_version_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sync_mutations" TO "anon";
GRANT ALL ON TABLE "public"."sync_mutations" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_mutations" TO "service_role";



GRANT ALL ON TABLE "public"."sync_tables" TO "anon";
GRANT ALL ON TABLE "public"."sync_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_tables" TO "service_role";



GRANT ALL ON TABLE "public"."trusted_auth_devices" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."user_asana_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."user_asana_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."user_asanas" TO "anon";
GRANT ALL ON TABLE "public"."user_asanas" TO "authenticated";
GRANT ALL ON TABLE "public"."user_asanas" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."user_prop_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."user_prop_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."user_sequences" TO "anon";
GRANT ALL ON TABLE "public"."user_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."user_stages" TO "anon";
GRANT ALL ON TABLE "public"."user_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."user_stages" TO "service_role";



GRANT ALL ON TABLE "public"."view_asanas_admin" TO "anon";
GRANT ALL ON TABLE "public"."view_asanas_admin" TO "authenticated";
GRANT ALL ON TABLE "public"."view_asanas_admin" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop policy "Public read access to asana categories" on "public"."asana_categories";

drop policy "Public can read shared asanas" on "public"."asanas";

drop policy "Public can read course categories" on "public"."course_categories";

drop policy "Users read visible course pose index" on "public"."course_pose_index";

drop policy "Public can read course subcategories" on "public"."course_sub_categories";

drop policy "Public can read official curriculum" on "public"."program_curriculum";

drop policy "Public can read shared props" on "public"."props";

drop policy "Public can read shared stages" on "public"."stages";

revoke delete on table "public"."account_recovery_requests" from "anon";

revoke insert on table "public"."account_recovery_requests" from "anon";

revoke references on table "public"."account_recovery_requests" from "anon";

revoke select on table "public"."account_recovery_requests" from "anon";

revoke trigger on table "public"."account_recovery_requests" from "anon";

revoke truncate on table "public"."account_recovery_requests" from "anon";

revoke update on table "public"."account_recovery_requests" from "anon";

revoke delete on table "public"."account_recovery_requests" from "authenticated";

revoke insert on table "public"."account_recovery_requests" from "authenticated";

revoke references on table "public"."account_recovery_requests" from "authenticated";

revoke select on table "public"."account_recovery_requests" from "authenticated";

revoke trigger on table "public"."account_recovery_requests" from "authenticated";

revoke truncate on table "public"."account_recovery_requests" from "authenticated";

revoke update on table "public"."account_recovery_requests" from "authenticated";

revoke delete on table "public"."asanas" from "anon";

revoke insert on table "public"."asanas" from "anon";

revoke truncate on table "public"."asanas" from "anon";

revoke update on table "public"."asanas" from "anon";

revoke delete on table "public"."asanas" from "authenticated";

revoke insert on table "public"."asanas" from "authenticated";

revoke truncate on table "public"."asanas" from "authenticated";

revoke update on table "public"."asanas" from "authenticated";

revoke delete on table "public"."course_analysis_refresh_queue" from "anon";

revoke insert on table "public"."course_analysis_refresh_queue" from "anon";

revoke references on table "public"."course_analysis_refresh_queue" from "anon";

revoke select on table "public"."course_analysis_refresh_queue" from "anon";

revoke trigger on table "public"."course_analysis_refresh_queue" from "anon";

revoke truncate on table "public"."course_analysis_refresh_queue" from "anon";

revoke update on table "public"."course_analysis_refresh_queue" from "anon";

revoke delete on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke insert on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke references on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke select on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke trigger on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke truncate on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke update on table "public"."course_analysis_refresh_queue" from "authenticated";

revoke delete on table "public"."course_categories" from "anon";

revoke insert on table "public"."course_categories" from "anon";

revoke truncate on table "public"."course_categories" from "anon";

revoke update on table "public"."course_categories" from "anon";

revoke delete on table "public"."course_categories" from "authenticated";

revoke insert on table "public"."course_categories" from "authenticated";

revoke truncate on table "public"."course_categories" from "authenticated";

revoke update on table "public"."course_categories" from "authenticated";

revoke delete on table "public"."course_sequence_analysis" from "authenticated";

revoke insert on table "public"."course_sequence_analysis" from "authenticated";

revoke update on table "public"."course_sequence_analysis" from "authenticated";

revoke delete on table "public"."course_sub_categories" from "anon";

revoke insert on table "public"."course_sub_categories" from "anon";

revoke truncate on table "public"."course_sub_categories" from "anon";

revoke update on table "public"."course_sub_categories" from "anon";

revoke delete on table "public"."course_sub_categories" from "authenticated";

revoke insert on table "public"."course_sub_categories" from "authenticated";

revoke truncate on table "public"."course_sub_categories" from "authenticated";

revoke update on table "public"."course_sub_categories" from "authenticated";

revoke delete on table "public"."courses" from "anon";

revoke insert on table "public"."courses" from "anon";

revoke truncate on table "public"."courses" from "anon";

revoke update on table "public"."courses" from "anon";

revoke truncate on table "public"."courses" from "authenticated";

revoke delete on table "public"."curriculum_drafts" from "anon";

revoke insert on table "public"."curriculum_drafts" from "anon";

revoke references on table "public"."curriculum_drafts" from "anon";

revoke select on table "public"."curriculum_drafts" from "anon";

revoke trigger on table "public"."curriculum_drafts" from "anon";

revoke truncate on table "public"."curriculum_drafts" from "anon";

revoke update on table "public"."curriculum_drafts" from "anon";

revoke references on table "public"."curriculum_drafts" from "authenticated";

revoke trigger on table "public"."curriculum_drafts" from "authenticated";

revoke truncate on table "public"."curriculum_drafts" from "authenticated";

revoke delete on table "public"."program_curriculum" from "anon";

revoke insert on table "public"."program_curriculum" from "anon";

revoke truncate on table "public"."program_curriculum" from "anon";

revoke update on table "public"."program_curriculum" from "anon";

revoke delete on table "public"."program_curriculum" from "authenticated";

revoke insert on table "public"."program_curriculum" from "authenticated";

revoke truncate on table "public"."program_curriculum" from "authenticated";

revoke update on table "public"."program_curriculum" from "authenticated";

revoke delete on table "public"."props" from "anon";

revoke insert on table "public"."props" from "anon";

revoke truncate on table "public"."props" from "anon";

revoke update on table "public"."props" from "anon";

revoke delete on table "public"."props" from "authenticated";

revoke insert on table "public"."props" from "authenticated";

revoke truncate on table "public"."props" from "authenticated";

revoke update on table "public"."props" from "authenticated";

revoke delete on table "public"."stages" from "anon";

revoke insert on table "public"."stages" from "anon";

revoke truncate on table "public"."stages" from "anon";

revoke update on table "public"."stages" from "anon";

revoke delete on table "public"."stages" from "authenticated";

revoke insert on table "public"."stages" from "authenticated";

revoke truncate on table "public"."stages" from "authenticated";

revoke update on table "public"."stages" from "authenticated";

revoke delete on table "public"."trusted_auth_devices" from "anon";

revoke insert on table "public"."trusted_auth_devices" from "anon";

revoke references on table "public"."trusted_auth_devices" from "anon";

revoke select on table "public"."trusted_auth_devices" from "anon";

revoke trigger on table "public"."trusted_auth_devices" from "anon";

revoke truncate on table "public"."trusted_auth_devices" from "anon";

revoke update on table "public"."trusted_auth_devices" from "anon";

revoke delete on table "public"."trusted_auth_devices" from "authenticated";

revoke insert on table "public"."trusted_auth_devices" from "authenticated";

revoke references on table "public"."trusted_auth_devices" from "authenticated";

revoke select on table "public"."trusted_auth_devices" from "authenticated";

revoke trigger on table "public"."trusted_auth_devices" from "authenticated";

revoke truncate on table "public"."trusted_auth_devices" from "authenticated";

revoke update on table "public"."trusted_auth_devices" from "authenticated";

revoke delete on table "public"."user_asana_overrides" from "anon";

revoke insert on table "public"."user_asana_overrides" from "anon";

revoke references on table "public"."user_asana_overrides" from "anon";

revoke select on table "public"."user_asana_overrides" from "anon";

revoke trigger on table "public"."user_asana_overrides" from "anon";

revoke truncate on table "public"."user_asana_overrides" from "anon";

revoke update on table "public"."user_asana_overrides" from "anon";

revoke truncate on table "public"."user_asana_overrides" from "authenticated";

revoke delete on table "public"."user_preferences" from "anon";

revoke insert on table "public"."user_preferences" from "anon";

revoke references on table "public"."user_preferences" from "anon";

revoke select on table "public"."user_preferences" from "anon";

revoke trigger on table "public"."user_preferences" from "anon";

revoke truncate on table "public"."user_preferences" from "anon";

revoke update on table "public"."user_preferences" from "anon";

revoke delete on table "public"."user_prop_overrides" from "anon";

revoke insert on table "public"."user_prop_overrides" from "anon";

revoke references on table "public"."user_prop_overrides" from "anon";

revoke select on table "public"."user_prop_overrides" from "anon";

revoke trigger on table "public"."user_prop_overrides" from "anon";

revoke truncate on table "public"."user_prop_overrides" from "anon";

revoke update on table "public"."user_prop_overrides" from "anon";

revoke truncate on table "public"."user_prop_overrides" from "authenticated";


  create policy "Public read access to asana categories"
  on "public"."asana_categories"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Public can read shared asanas"
  on "public"."asanas"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Public can read course categories"
  on "public"."course_categories"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Users read visible course pose index"
  on "public"."course_pose_index"
  as permissive
  for select
  to anon, authenticated
using ((EXISTS ( SELECT 1
   FROM public.courses c
  WHERE ((c.id = course_pose_index.course_id) AND ((COALESCE(c.is_system, false) = true) OR (auth.uid() = c.user_id))))));



  create policy "Public can read course subcategories"
  on "public"."course_sub_categories"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Public can read official curriculum"
  on "public"."program_curriculum"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Public can read shared props"
  on "public"."props"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Public can read shared stages"
  on "public"."stages"
  as permissive
  for select
  to anon, authenticated
using (true);

  create policy "Public read access to audio assets"
  on "storage"."objects"
  as permissive
  for select
  to anon, authenticated
using ((bucket_id = 'audio-assets'::text));



  create policy "Public read access to yoga cards"
  on "storage"."objects"
  as permissive
  for select
  to anon, authenticated
using ((bucket_id = 'yoga-cards'::text));
