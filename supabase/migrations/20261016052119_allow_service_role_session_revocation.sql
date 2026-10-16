/*
# Restore administrative recovery for service_revoke_user_sessions

1. Summary
- The previous migration added an ownership check (caller must equal p_user_id).
- That check also blocked the service role, which has no user id, breaking the
  documented "approved account recovery" flow.

2. Modified functions
- `public.service_revoke_user_sessions(uuid)`
  - Service role (verified, signed JWT role claim) may revoke any user's sessions.
  - Authenticated users may revoke only their own sessions.
  - Everyone else is rejected with SQLSTATE 42501 (insufficient_privilege).

3. Security
- EXECUTE: authenticated and service_role only. anon and PUBLIC have none.
- SECURITY DEFINER with an empty search_path; all names are schema-qualified.

4. Notes
- No tables, columns, or data are changed by this migration.
*/

CREATE OR REPLACE FUNCTION public.service_revoke_user_sessions(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22004';
  end if;
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'You can only revoke your own sessions' using errcode = '42501';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

ALTER FUNCTION public.service_revoke_user_sessions(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.service_revoke_user_sessions(uuid)
IS 'Revokes all sessions for a user. Authenticated callers may target only themselves; the service role may target any user for approved account recovery.';

REVOKE ALL ON FUNCTION public.service_revoke_user_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_revoke_user_sessions(uuid) TO authenticated, service_role;
