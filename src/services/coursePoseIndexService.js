import { supabase } from './supabaseClient.js';
import { normalisePoseId } from '../utils/poseId.js';

const MAX_POSE_FILTER_IDS = 20;

export function parsePoseFilterIds(raw) {
    const tokens = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    return [...new Set(tokens
        .map(token => normalisePoseId(String(token).trim().replace(/^#+/, '')))
        .filter(Boolean))].slice(0, MAX_POSE_FILTER_IDS);
}

export async function fetchCourseIdsByPoseIds(poseIds) {
    const targets = parsePoseFilterIds(poseIds);
    if (!targets.length) return new Set();

    if (!supabase) {
        throw new Error('Supabase client is not available.');
    }

    const { data, error } = await supabase
        .from('course_pose_index')
        .select('course_id')
        .in('pose_id', targets)
        .eq('source_type', 'direct');

    if (error) {
        throw new Error(`Failed to fetch course pose index: ${error.message}`);
    }

    return new Set((data || []).map(row => String(row.course_id)));
}
