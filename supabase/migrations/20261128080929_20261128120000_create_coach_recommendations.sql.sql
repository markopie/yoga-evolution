/*
# Create coach_recommendations table (AI coach, Phase 1)

1. New Tables
- `coach_recommendations`
  - `id` (uuid, primary key) — stable reference for feedback writes.
  - `user_id` (uuid, not null, defaults to the authenticated user) — owner.
  - `trace_id` (text) — Langfuse trace id so thumbs up/down feedback can be
    linked back to the exact AI run that produced the recommendation.
  - `model_used` (text, default 'fallback') — which brain produced the answer:
    'gemini', 'groq', or 'fallback' (deterministic, no AI call).
  - `coach_message` (text, default '') — the coach's short note to the user.
  - `recommended_sessions` (jsonb, default '[]') — validated list of course
    recommendations (course_id, title, reason, modification_tip).
  - `check_in` (jsonb, default '{}') — the daily check-in answers that led to
    this recommendation (energy, soreness, focus).
  - `feedback` (smallint, default 0) — user feedback: 1 = thumbs up,
    -1 = thumbs down, 0 = not yet given.
  - `created_at` (timestamptz, default now())

2. Security
- Enable RLS on `coach_recommendations`.
- Grant SELECT + INSERT to `authenticated`; UPDATE restricted to the
  `feedback` column only, so a user can never rewrite their AI history.
- Owner-scoped policies: users see and give feedback only on their own rows.
- Grant full access to `service_role` because the `yoga-coach` edge function
  writes rows (recommendations) server-side on the user's behalf.

3. Notes
- The user's coach profile (experience, goals, injuries) reuses the existing
  `user_preferences` table, so no additional table is needed.
*/

CREATE TABLE IF NOT EXISTS coach_recommendations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    trace_id text,
    model_used text NOT NULL DEFAULT 'fallback',
    coach_message text NOT NULL DEFAULT '',
    recommended_sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
    check_in jsonb NOT NULL DEFAULT '{}'::jsonb,
    feedback smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_recommendations_user_created_idx
    ON coach_recommendations (user_id, created_at DESC);

ALTER TABLE coach_recommendations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON coach_recommendations TO authenticated;
GRANT UPDATE (feedback) ON coach_recommendations TO authenticated;
GRANT ALL ON coach_recommendations TO service_role;

DROP POLICY IF EXISTS "select_own_coach_recommendations" ON coach_recommendations;
CREATE POLICY "select_own_coach_recommendations"
ON coach_recommendations FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_coach_recommendations" ON coach_recommendations;
CREATE POLICY "insert_own_coach_recommendations"
ON coach_recommendations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_coach_feedback" ON coach_recommendations;
CREATE POLICY "update_own_coach_feedback"
ON coach_recommendations FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_coach_recommendations" ON coach_recommendations;
CREATE POLICY "delete_own_coach_recommendations"
ON coach_recommendations FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
