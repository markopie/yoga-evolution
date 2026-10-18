-- Restrict service_revoke_user_sessions to self-service only.
-- The original function (SECURITY DEFINER, no ownership check) accepted any
-- p_user_id, so granting EXECUTE to authenticated would let any user revoke
-- another user's sessions. Add an auth.uid() ownership guard before granting.
CREATE OR REPLACE FUNCTION public.service_revoke_user_sessions(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'You can only revoke your own sessions';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

ALTER FUNCTION public.service_revoke_user_sessions(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.service_revoke_user_sessions(uuid)
IS 'Self-service session revocation. The caller must target their own user_id. Admin-driven recovery flows use the service role key which bypasses RLS.';

REVOKE EXECUTE ON FUNCTION public.service_revoke_user_sessions(uuid) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.service_revoke_user_sessions(uuid) TO authenticated;