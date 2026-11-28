// src/services/coachService.js — AI coach client (Phase 1 MVP).
// Talks to the yoga-coach edge function; secrets never reach the browser.
import { supabase } from './supabaseClient.js';
import { readPreference } from './profilePreferences.js';

export const COACH_RECOMMENDATION_KEY = 'yogaCoachRecommendationV1';

export function coachUnavailableReason() {
    if (!supabase) return 'The coach service is not configured.';
    if (!navigator.onLine) return 'The coach needs an internet connection.';
    if (!import.meta.env.VITE_SUPABASE_URL) return 'The coach service is not configured.';
    return null;
}

export function defaultCoachProfile() {
    return {
        experienceLevel: readPreference('coachExperienceLevel', '') || '',
        goals: readPreference('coachGoals', '') || '',
        sessionMinutes: readPreference('coachSessionMinutes', '') || '',
        daysPerWeek: readPreference('coachDaysPerWeek', '') || '',
        injuries: readPreference('coachInjuries', '') || '',
    };
}

async function authedFetch(path, options = {}) {
    if (!supabase) throw new Error(coachUnavailableReason() || 'Coach unavailable');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Open a profile to use the coach.');
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload?.error || `The coach is unavailable right now (${response.status}).`);
    }
    return payload;
}

export async function requestCoachRecommendation(checkIn) {
    return authedFetch('yoga-coach', {
        method: 'POST',
        body: JSON.stringify({ checkIn, coachProfile: defaultCoachProfile() }),
    });
}

export async function submitCoachFeedback(recommendationId, traceId, feedback) {
    if (!recommendationId) return;
    try {
        await supabase
            .from('coach_recommendations')
            .update({ feedback })
            .eq('id', recommendationId);
    } catch (error) {
        console.warn('[Coach] Feedback save failed:', error);
    }
    if (!traceId || !supabase) return;
    try {
        await authedFetch('yoga-coach', {
            method: 'POST',
            headers: { 'X-Coach-Action': 'feedback' },
            body: JSON.stringify({
                feedback: { traceId, value: feedback, recommendationId },
            }),
        });
    } catch (error) {
        console.warn('[Coach] Feedback trace failed:', error);
    }
}

export function saveLocalRecommendation(payload) {
    try { localStorage.setItem(COACH_RECOMMENDATION_KEY, JSON.stringify(payload)); } catch { /* best effort */ }
}

export function loadLocalRecommendation() {
    try {
        const parsed = JSON.parse(localStorage.getItem(COACH_RECOMMENDATION_KEY) || 'null');
        return parsed && Array.isArray(parsed.recommended_sessions) ? parsed : null;
    } catch { return null; }
}
