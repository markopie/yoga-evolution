-- Authorization tests for public.service_revoke_user_sessions.
-- Uses freshly generated user ids that own no sessions, so every delete
-- touches zero rows and no real data is changed. Raises on first failure.
DO $$
DECLARE
  self_id  uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  blocked  boolean;
BEGIN
  -- 1. An authenticated user can revoke their own sessions.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', self_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.service_revoke_user_sessions(self_id);
  RESET ROLE;

  -- 2. An authenticated user cannot revoke another user's sessions.
  blocked := false;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', self_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.service_revoke_user_sessions(other_id);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    blocked := true;
  END;
  RESET ROLE;
  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL case 2: user revoked another user''s sessions';
  END IF;

  -- 3. Authorised administrative recovery (service role) can revoke any user.
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.service_revoke_user_sessions(other_id);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAIL case 3: service role recovery blocked: %', SQLERRM;
  END;
  RESET ROLE;

  -- 4. Anonymous callers cannot execute the function at all.
  blocked := false;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.service_revoke_user_sessions(self_id);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    blocked := true;
  END;
  RESET ROLE;
  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL case 4: anon executed the function';
  END IF;

  RAISE NOTICE 'service_revoke_user_sessions: all authorization tests passed';
END $$;
