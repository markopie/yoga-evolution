-- Restrict service_revoke_user_sessions to authenticated users only,
-- and require the caller to target their own user_id (self-service session
-- revocation). Admin-driven recovery flows use the service role key which
-- bypasses RLS and is not subject to this policy.
REVOKE EXECUTE ON FUNCTION public.service_revoke_user_sessions(uuid) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.service_revoke_user_sessions(uuid) TO authenticated;
