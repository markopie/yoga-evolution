// src/services/historyService.js

import { supabase } from "./supabaseClient.js";
import { liveProfileSession } from "./deviceProfiles.js";
import {
   listQueuedCompletions,
   queueCompletionRows,
   removeQueuedCompletion,
   pendingRatingOperation,
   updateQueuedCompletion,
   updateQueuedCompletionRating,
} from "./offlineStore.js";
import { setSyncStatus, SYNC_STATES } from './syncStatus.js';
import { sequenceHash, sequenceSnapshot } from './sequenceOwnership.js';

const COMPLETION_KEY = "yogaCompletionLog_v2";

function completionStorageKey(userId = window.currentUserId) {
   return `${COMPLETION_KEY}:${userId || 'anonymous'}`;
}

export function safeGetLocalStorage(key, defaultValue = null) {
   try {
      const item = localStorage.getItem(key);
      if (!item) return defaultValue;
      return JSON.parse(item);
   } catch (e) {
      console.error(`Corrupted localStorage for key: ${key}`, e);
      localStorage.removeItem(key);
      return defaultValue;
   }
}

export function safeSetLocalStorage(key, value) {
   try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
   } catch (e) {
      console.error(`Failed to save to localStorage: ${key}`, e);
      return false;
   }
}

export function loadCompletionLog(userId = window.currentUserId) {
   const key = completionStorageKey(userId);
   const scoped = safeGetLocalStorage(key, null);
   if (Array.isArray(scoped)) return scoped;
   return [];
}

export function saveCompletionLog(log, userId = window.currentUserId) {
   safeSetLocalStorage(completionStorageKey(userId), log);
}

export function addCompletion(title, whenDate, category = null) {
   const log = loadCompletionLog();
   const localStr = whenDate.toLocaleString("en-AU", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
   });
   log.push({ title, category, ts: whenDate.getTime(), local: localStr });
   saveCompletionLog(log);
}

export function lastCompletionFor(title) {
   const log = loadCompletionLog().filter(x => x && x.title === title && typeof x.ts === "number");
   if (!log.length) return null;
   return log.sort((a, b) => b.ts - a.ts)[0];
}

export function seedManualCompletionsOnce() {
   const log = loadCompletionLog();
   const have = new Set(log.filter(x => x?.title).map(x => x.title + "::" + x.ts));
   const seeds = [
      { title: "Course 1: Short Course, Day 1", d: new Date(2025, 11, 31, 10, 0, 0) },
      { title: "Course 1: Short Course, Day 2", d: new Date(2026, 0, 1, 9, 30, 0) },
      { title: "Course 1: Short Course, Day 3", d: new Date(2026, 0, 2, 10, 0, 0) }
   ];
   let changed = false;
   seeds.forEach(s => {
      const key = s.title + "::" + s.d.getTime();
      if (!have.has(key)) {
         log.push({
            title: s.title, ts: s.d.getTime(),
            local: s.d.toLocaleString("en-AU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
         });
         changed = true;
      }
   });
   if (changed) saveCompletionLog(log);
}

let serverHistoryCache = null; // array of unified entries, newest first
Object.defineProperty(window, 'serverHistoryCache', {
   configurable: true,
   get: () => serverHistoryCache,
});

function sumPoseMinutes(poses = []) {
   if (!Array.isArray(poses) || !poses.length) return null;
   const totalSeconds = poses.reduce((acc, pose) => {
      const seconds = typeof window.getPosePillTime === 'function'
         ? window.getPosePillTime(pose)
         : Number(pose?.[1] || 0);
      return acc + (Number.isFinite(seconds) ? seconds : 0);
   }, 0);
   return Math.round((totalSeconds / 60) * 100) / 100;
}

function buildDurationDialCompletionMetadata() {
   const sequence = window.currentSequence || null;
   const plannedList = sequence && typeof window.getExpandedPoses === 'function'
      ? window.getExpandedPoses(sequence)
      : sequence?.poses;
   const adjustedList = typeof window.getActivePlaybackList === 'function'
      ? window.getActivePlaybackList()
      : window.activePlaybackList;

   const plannedMinutes = sumPoseMinutes(plannedList);
   const adjustedMinutes = sumPoseMinutes(adjustedList);
   const scale = plannedMinutes && adjustedMinutes
      ? Math.round((adjustedMinutes / plannedMinutes) * 1000) / 1000
      : null;

   return {
      completed: true,
      duration_scale_used: scale,
      planned_duration_minutes: plannedMinutes,
      actual_adjusted_duration_minutes: adjustedMinutes,
   };
}

function stripDurationMetadata(payload) {
   const {
      completed,
      duration_scale_used,
      planned_duration_minutes,
      actual_adjusted_duration_minutes,
      source_type,
      source_sequence_id,
      profile_sequence_id,
      sequence_hash,
      sequence_snapshot,
      ...legacyPayload
   } = payload;
   void completed;
   void duration_scale_used;
   void planned_duration_minutes;
   void actual_adjusted_duration_minutes;
   void source_type;
   void source_sequence_id;
   void profile_sequence_id;
   void sequence_hash;
   void sequence_snapshot;
   return legacyPayload;
}

function isMissingDurationMetadataColumnError(error) {
   const message = String(error?.message || error?.details || '');
   return [
      'completed',
      'duration_scale_used',
      'planned_duration_minutes',
      'actual_adjusted_duration_minutes',
      'source_type',
      'source_sequence_id',
      'profile_sequence_id',
      'sequence_hash',
      'sequence_snapshot',
   ].some(column => message.includes(column));
}

// Build window.completionHistory (legacy format) from the unified cache
function _rebuildLegacyHistory(entries) {
   const hist = {};
   entries.forEach(e => {
      if (!e.title) return;
      if (!hist[e.title]) hist[e.title] = [];
      hist[e.title].push(e.iso || new Date(e.ts).toISOString());
   });
   window.completionHistory = hist;
}

export async function fetchServerHistory() {
    try {
       if (!supabase || !navigator.onLine || window.hasLiveProfileSession !== true) {
          serverHistoryCache = loadCompletionLog();
          _rebuildLegacyHistory(serverHistoryCache);
          return serverHistoryCache;
       }

       if (!window.currentUserId) {
          serverHistoryCache = [];
          _rebuildLegacyHistory(serverHistoryCache);
          return serverHistoryCache;
       }

       let query = supabase
          .from('sequence_completions')
          .select('id, title, category, completed_at, source_type, curriculum_node_id, status, rating, duration_seconds, sequence_id, notes')
          .eq('user_id', window.currentUserId);

       const { data, error } = await query;

       if (error) throw error;

       serverHistoryCache = data.map(r => ({
          id: r.id,
          title: r.title,
          category: r.category || '',
          ts: new Date(r.completed_at).getTime(),
          local: new Date(r.completed_at).toLocaleString("en-AU", {
             year: "numeric", month: "2-digit", day: "2-digit",
             hour: "2-digit", minute: "2-digit"
          }),
          iso: r.completed_at,
          source_type: r.source_type || (r.curriculum_node_id != null ? 'curriculum' : 'manual'),
          curriculum_node_id: r.curriculum_node_id ?? null,
          status: r.status || null,
          rating: r.rating ?? null,
          duration_seconds: r.duration_seconds ?? null,
          sequence_id: r.sequence_id ?? null,
          notes: r.notes ?? null,
       }));

       _rebuildLegacyHistory(serverHistoryCache);
       return serverHistoryCache;

    } catch (e) {
       console.error("Failed to fetch server history:", e);
       serverHistoryCache = loadCompletionLog();
       _rebuildLegacyHistory(serverHistoryCache);
       return serverHistoryCache;
    }
}

function buildCompletionRows(title, whenDate, category, durationSeconds, options) {
      const completionOptions = typeof options === 'string' ? { status: options } : (options || {});
      const completionItems = Array.isArray(completionOptions.completion_items)
         ? completionOptions.completion_items.filter(item => item && item.counts_for_source_completion !== false)
         : [];
      const durationMetadata = {
         ...buildDurationDialCompletionMetadata(),
         ...(completionOptions.duration_metadata || {}),
      };
      const snapshot = options?.sequence_snapshot || sequenceSnapshot(window.currentSequence);

      const buildPayload = (item = {}) => {
         const payload = {
            id: crypto.randomUUID(),
            title: item.title || title,
            category: item.category || category,
            completed_at: whenDate.toISOString(),
            status: item.status || completionOptions.status || 'Completed',
            completed: durationMetadata.completed !== false,
         };
         payload.source_type = completionOptions.source_type
            || (completionOptions.curriculum_node_id != null ? 'curriculum' : 'manual');

         const itemDuration = item.duration_seconds ?? durationSeconds;
         if (itemDuration !== null && itemDuration !== undefined && !isNaN(itemDuration)) {
            payload.duration_seconds = itemDuration;
         }
         if (completionOptions.notes !== undefined) payload.notes = completionOptions.notes;
         if (completionOptions.rating !== undefined) payload.rating = completionOptions.rating;
         if (completionOptions.difficulty_feedback !== undefined) payload.difficulty_feedback = completionOptions.difficulty_feedback;
         if (durationMetadata.duration_scale_used !== null && durationMetadata.duration_scale_used !== undefined) {
            payload.duration_scale_used = durationMetadata.duration_scale_used;
         }
         if (durationMetadata.planned_duration_minutes !== null && durationMetadata.planned_duration_minutes !== undefined) {
            payload.planned_duration_minutes = durationMetadata.planned_duration_minutes;
         }
         if (durationMetadata.actual_adjusted_duration_minutes !== null && durationMetadata.actual_adjusted_duration_minutes !== undefined) {
            payload.actual_adjusted_duration_minutes = durationMetadata.actual_adjusted_duration_minutes;
         }

         const sequenceId = item.sequence_id ?? completionOptions.sequence_id;
         if (sequenceId !== undefined && sequenceId !== null) {
            payload.sequence_id = sequenceId;
         }
         if (completionOptions.curriculum_node_id !== undefined && completionOptions.curriculum_node_id !== null) {
            payload.curriculum_node_id = completionOptions.curriculum_node_id;
         }
         for (const field of ['source_sequence_id', 'sequence_hash', 'sequence_snapshot', 'pose_durations', 'profile_sequence_id']) {
            if (completionOptions[field] !== undefined) payload[field] = completionOptions[field];
         }
         if (snapshot && payload.sequence_snapshot === undefined) {
            payload.sequence_snapshot = snapshot;
            payload.sequence_hash = completionOptions.sequence_hash || sequenceHash(snapshot);
            payload.source_sequence_id ||= snapshot.source_sequence_id;
            payload.profile_sequence_id ||= snapshot.profile_sequence_id;
         }
         payload.user_id = window.currentUserId;
         return payload;
      };

      const rows = completionItems.length
         ? completionItems.map(buildPayload)
         : [buildPayload()];
      return rows;
}

async function insertCompletionRows(rows) {
   let { data, error } = await supabase
      .from('sequence_completions')
      .insert(rows)
      .select();

   if (error && isMissingDurationMetadataColumnError(error)) {
      const legacyRows = rows.map(stripDurationMetadata);
      const retry = await supabase
         .from('sequence_completions')
         .insert(legacyRows)
         .select();
      data = retry.data;
      error = retry.error;
   }
   return { data, error };
}

let queueFlushPromise = null;
let queueFlushAgain = false;
let retryTimer = null;

function permanentSyncError(error) {
   const code = String(error?.code || '');
   const message = String(error?.message || error?.details || '');
   return ['42501', '23503', '23514', '22P02'].includes(code)
      || /permission|row-level security|foreign key|invalid input/i.test(message);
}

function retryDelay(attempts) {
   return Math.min(60_000, 1_000 * (2 ** Math.min(Number(attempts || 0), 6)));
}

function scheduleRetry(delayMs) {
   clearTimeout(retryTimer);
   retryTimer = setTimeout(() => {
      void flushCompletionQueue().catch((error) =>
         console.warn('[Offline] Scheduled completion replay failed:', error));
   }, delayMs);
}

async function performQueueFlush() {
   const userId = window.currentUserId;
   const queued = await listQueuedCompletions(userId).catch(() => []);
   const unsynced = queued.filter((item) => !item.remoteSaved || !item.ratingPending);
   if (!supabase || !userId || !navigator.onLine) {
      setSyncStatus({
         state: navigator.onLine === false ? SYNC_STATES.OFFLINE : SYNC_STATES.PENDING,
         pending: unsynced.length,
      });
      return { synced: 0, remaining: unsynced.length };
   }
   const assurance = await liveProfileSession(supabase, userId);
   if (!assurance.valid) {
      setSyncStatus({ state: unsynced.length ? SYNC_STATES.PENDING : SYNC_STATES.HEALTHY, pending: unsynced.length });
      return { synced: 0, remaining: unsynced.length, blocked: assurance.reason };
   }
   setSyncStatus({ state: SYNC_STATES.SYNCING, pending: unsynced.length });
   let synced = 0;
   let needsAttention = false;
   let nearestRetry = null;
   for (const original of queued) {
      let item = original;
      const rows = item.rows || [];
      if (!rows.length || rows.some((row) => String(row.user_id || '') !== String(userId))) continue;
      if (item.status === 'needs_attention') {
         needsAttention = true;
         continue;
      }
      if (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now()) {
         const remaining = Date.parse(item.nextRetryAt) - Date.now();
         nearestRetry = nearestRetry == null ? remaining : Math.min(nearestRetry, remaining);
         continue;
      }
      try {
         if (!item.remoteSaved) {
            const { error } = await insertCompletionRows(rows);
            if (error && error.code !== '23505') throw error;
            item = await updateQueuedCompletion(item.id, {
               remoteSaved: true,
               status: item.ratingPending ? 'awaiting_rating' : 'pending',
               attempts: 0,
               nextRetryAt: null,
               lastError: null,
            });
         } else if (!item.ratingPending && item.rating != null) {
            const { error } = await supabase
               .from('sequence_completions')
               .update({ rating: item.rating })
               .in('id', item.rowIds)
               .eq('user_id', userId);
            if (error) throw error;
         }

         const { refreshCurriculumSnapshot } = await import('./curriculumOffline.js');
         await refreshCurriculumSnapshot({ userId });
         if (!item.ratingPending) {
            await removeQueuedCompletion(item.id);
            synced += 1;
         }
      } catch (error) {
         const attempts = Number(item.attempts || 0) + 1;
         if (permanentSyncError(error)) {
            needsAttention = true;
            await updateQueuedCompletion(item.id, {
               status: 'needs_attention',
               attempts,
               lastError: String(error?.message || error),
               nextRetryAt: null,
            });
         } else {
            const delay = retryDelay(attempts);
            nearestRetry = nearestRetry == null ? delay : Math.min(nearestRetry, delay);
            await updateQueuedCompletion(item.id, {
               status: 'pending',
               attempts,
               lastError: String(error?.message || error),
               nextRetryAt: new Date(Date.now() + delay).toISOString(),
            });
         }
      }
   }
   const remainingItems = await listQueuedCompletions(userId).catch(() => []);
   const remaining = remainingItems.filter((item) => !item.remoteSaved || !item.ratingPending).length;
   const awaitingUserRating = remainingItems.length > 0
      && remainingItems.every((item) => item.remoteSaved && item.ratingPending);
   if (nearestRetry != null) scheduleRetry(Math.max(250, nearestRetry));
   setSyncStatus({
      state: queueFlushAgain
         ? SYNC_STATES.SYNCING
         : needsAttention
         ? SYNC_STATES.NEEDS_ATTENTION
         : awaitingUserRating
            ? SYNC_STATES.HEALTHY
         : remaining
            ? SYNC_STATES.PENDING
            : SYNC_STATES.HEALTHY,
      pending: awaitingUserRating ? 0 : remaining,
      lastSyncAt: synced ? new Date().toISOString() : undefined,
   });
   if (synced) {
      // Reconcile the optimistic local history after the server accepts the
      // queued rows. The history view was already usable before this point.
      await fetchServerHistory();
      window.dispatchEvent(new CustomEvent('yoga:progress-synced', { detail: { synced } }));
   }
   return { synced, remaining };
}

export async function flushCompletionQueue() {
   if (queueFlushPromise) {
      // A rating can be saved while the initial completion insert is still
      // flushing. Remember the request so the same promise performs a second
      // pass after the first pass sees the updated queue item.
      queueFlushAgain = true;
      return queueFlushPromise;
   }
   queueFlushPromise = (async () => {
      do {
         queueFlushAgain = false;
         await performQueueFlush();
      } while (queueFlushAgain);
   })().finally(() => {
      queueFlushPromise = null;
      queueFlushAgain = false;
   });
   return queueFlushPromise;
}

export async function appendServerHistory(title, whenDate, category = null, durationSeconds = null, options = {}) {
   addCompletion(title, whenDate, category);

   if (!window.currentUserId) {
      console.error("Cannot save or queue completion without a signed-in user.");
      return false;
   }

   const rows = buildCompletionRows(title, whenDate, category, durationSeconds, options);
   const isCompleted = rows.every((row) => String(row.status || '').toLowerCase() === 'completed');
   const operation = await queueCompletionRows(rows, {
      userId: window.currentUserId,
      awaitingRating: isCompleted && options?.rating === undefined,
      rating: options?.rating,
   });
   const optimisticEntries = rows.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category || '',
      ts: new Date(row.completed_at).getTime(),
      local: new Date(row.completed_at).toLocaleString('en-AU', {
         year: 'numeric', month: '2-digit', day: '2-digit',
         hour: '2-digit', minute: '2-digit',
      }),
      iso: row.completed_at,
      source_type: row.source_type || (row.curriculum_node_id != null ? 'curriculum' : 'manual'),
      curriculum_node_id: row.curriculum_node_id ?? null,
      status: row.status || null,
      rating: row.rating ?? null,
      duration_seconds: row.duration_seconds ?? null,
      sequence_id: row.sequence_id ?? null,
      notes: row.notes ?? null,
   }));
   serverHistoryCache = [...(serverHistoryCache || []), ...optimisticEntries]
      .sort((left, right) => right.ts - left.ts);
   _rebuildLegacyHistory(serverHistoryCache);
   window.pendingRatingCompletionIds = rows.map((row) => row.id);
   setSyncStatus({
      state: navigator.onLine === false ? SYNC_STATES.OFFLINE : SYNC_STATES.SYNCING,
      pending: 1,
   });
   window.dispatchEvent(new CustomEvent('yoga:progress-saved-locally', {
      detail: { operationId: operation.id },
   }));
   void flushCompletionQueue().catch((error) =>
      console.warn('[Offline] Completion queue replay failed:', error));
   return rows[0].id;
}

export async function updateCompletionRating(id, rating) {
   if (!id || !window.currentUserId) return false;
   const ratingIds = Array.isArray(window.pendingRatingCompletionIds) && window.pendingRatingCompletionIds.includes(id)
      ? window.pendingRatingCompletionIds
      : [id];
   const results = await Promise.all(
      ratingIds.map((ratingId) => updateQueuedCompletionRating(ratingId, rating)),
   );
   if (!results.some(Boolean)) throw new Error('The saved completion could not be found on this device.');
   if (Array.isArray(serverHistoryCache)) {
      const idSet = new Set(ratingIds.map(String));
      serverHistoryCache = serverHistoryCache.map((entry) =>
         idSet.has(String(entry.id)) ? { ...entry, rating } : entry);
      _rebuildLegacyHistory(serverHistoryCache);
   }
   window.pendingRatingCompletionIds = null;
   void flushCompletionQueue().catch((error) =>
      console.warn('[Offline] Rated completion replay failed:', error));
   return true;
}

export async function restorePendingCompletionRating() {
   if (!window.currentUserId) return false;
   const operation = await pendingRatingOperation(window.currentUserId).catch(() => null);
   if (!operation?.rowIds?.length || typeof window.showCompletionRatingOverlay !== 'function') return false;
   window.pendingRatingCompletionIds = operation.rowIds;
   return window.showCompletionRatingOverlay(operation.rowIds[0], {
      title: 'How did your body feel?',
      note: 'This saved practice still needs its feeling rating.',
      resetAfterRating: false,
   });
}

export async function deleteCompletionById(id) {
   if (!supabase || !id || !window.currentUserId || !navigator.onLine || window.hasLiveProfileSession !== true) return false;
   try {
      const { error } = await supabase
         .from('sequence_completions')
         .delete()
         .eq('id', id)
         .eq('user_id', window.currentUserId);
      if (error) throw error;
      await fetchServerHistory();
      return true;
   } catch (e) {
      console.error("Failed to delete completion:", e);
      return false;
   }
}

export async function cancelCompletion(ids) {
   const rowIds = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))];
   if (!rowIds.length || !window.currentUserId) return false;

   const queued = await listQueuedCompletions(window.currentUserId).catch(() => []);
   const queuedOperation = queued.find((item) =>
      item.rowIds.some((rowId) => rowIds.includes(String(rowId))));

   if (navigator.onLine && supabase) {
      const { error } = await supabase
         .from('sequence_completions')
         .delete()
         .in('id', rowIds)
         .eq('user_id', window.currentUserId);
      if (error) throw error;
      if (queuedOperation) await removeQueuedCompletion(queuedOperation.id);
      await fetchServerHistory();
   } else if (queuedOperation) {
      await removeQueuedCompletion(queuedOperation.id);
   } else {
      throw new Error('Reconnect before undoing this completion.');
   }

   if (Array.isArray(window.pendingRatingCompletionIds)) {
      window.pendingRatingCompletionIds = window.pendingRatingCompletionIds
         .filter((id) => !rowIds.includes(String(id)));
      if (!window.pendingRatingCompletionIds.length) window.pendingRatingCompletionIds = null;
   }
   if (Array.isArray(serverHistoryCache)) {
      const idSet = new Set(rowIds);
      serverHistoryCache = serverHistoryCache.filter((entry) => !idSet.has(String(entry.id)));
      _rebuildLegacyHistory(serverHistoryCache);
   }
   return true;
}

export async function deleteAllCompletionsForTitle(title) {
   if (!supabase || !title || !window.currentUserId || !navigator.onLine || window.hasLiveProfileSession !== true) return false;
   try {
      const { error } = await supabase
         .from('sequence_completions')
         .delete()
         .eq('title', title)
         .eq('user_id', window.currentUserId);
      if (error) throw error;
      await fetchServerHistory();
      return true;
   } catch (e) {
      console.error("Failed to delete completions for title:", e);
      return false;
   }
}

// Calculate consecutive day streak from a sorted array of ISO date strings (newest first)
export function calculateStreak(isoStrings) {
   if (!isoStrings || !isoStrings.length) return 0;
   const days = [...new Set(
      isoStrings.map(s => new Date(s).toLocaleDateString("en-AU"))
   )].map(d => {
      const [dd, mm, yyyy] = d.split('/');
      return new Date(yyyy, mm - 1, dd).getTime();
   }).sort((a, b) => b - a);

   const MS_PER_DAY = 86400000;
   const today = new Date(); today.setHours(0,0,0,0);
   const todayMs = today.getTime();
   const yesterdayMs = todayMs - MS_PER_DAY;

   if (days[0] !== todayMs && days[0] !== yesterdayMs) return 0;

   let streak = 1;
   for (let i = 1; i < days.length; i++) {
      if (days[i - 1] - days[i] === MS_PER_DAY) {
         streak++;
      } else {
         break;
      }
   }
   return streak;
}

// Global exposure
// We only expose a few functions to window that are used directly in on-clicks in index.html (if any)
// or by legacy wiring that expects them on window
window.deleteCompletionById = deleteCompletionById;
window.deleteAllCompletionsForTitle = deleteAllCompletionsForTitle;
window.cancelCompletion = cancelCompletion;
window.calculateStreak = calculateStreak;
window.appendServerHistory = appendServerHistory;
window.seedManualCompletionsOnce = seedManualCompletionsOnce;
window.fetchServerHistory = fetchServerHistory;
window.updateCompletionRating = updateCompletionRating;
window.flushCompletionQueue = flushCompletionQueue;
window.restorePendingCompletionRating = restorePendingCompletionRating;

window.addEventListener('online', () => {
   void flushCompletionQueue().catch((error) =>
      console.warn('[Offline] Completion queue replay failed:', error));
});
window.addEventListener('focus', () => {
   void flushCompletionQueue().catch((error) =>
      console.warn('[Offline] Focus-triggered completion replay failed:', error));
});
document.addEventListener('visibilitychange', () => {
   if (document.visibilityState === 'visible') {
      void flushCompletionQueue().catch((error) =>
         console.warn('[Offline] Foreground completion replay failed:', error));
   }
});

// To allow UI components access
export { COMPLETION_KEY };
