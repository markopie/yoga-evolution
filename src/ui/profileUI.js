import { exportProfileBackup } from '../services/profileBackup.js';
import { validateProfileBackup, PROFILE_FILE_LIMIT } from '../services/profileFile.js';
import { supabase, supabaseConfig } from '../services/supabaseClient.js';
import {
    PROFILES_KEY, SELECTED_PROFILE_KEY, readProfiles, rememberProfile,
    forgetProfile, renameProfile, liveProfileSession,
} from '../services/deviceProfiles.js';
import { loadCurriculumSnapshot } from '../services/curriculumOffline.js';
import { syncProfilePreferences } from '../services/profilePreferences.js';
import { themeManager } from './themeToggle.js';
import { migrateProfileSequences } from '../services/profileSequenceMigration.js';

const byId = (id) => document.getElementById(id);
const backupNoticeKey = (userId) => `yoga-profile-backup-notice-v1:${userId}`;
const LAST_PROFILE_KEY = `${PROFILES_KEY}-last-used`;

function readLastProfileId() {
    try { return localStorage.getItem(LAST_PROFILE_KEY); } catch { return null; }
}

function rememberLastProfile(id) {
    try { localStorage.setItem(LAST_PROFILE_KEY, id); } catch { /* Non-critical convenience only. */ }
}

export async function setupProfileUI() {
    const showMessage = (message = '') => {
        byId('profileMessage').textContent = message;
        byId('profileMessage').hidden = !message;
    };
    const showPicker = () => {
        byId('loginScreen').style.display = 'flex';
        byId('mainAppContainer').style.display = 'none';
    };
    let busy = false;
    let changingProfile = false;
    const run = async (operation) => {
        if (busy) return;
        busy = true;
        byId('profileControls').disabled = true;
        showMessage();
        try { await operation(); }
        catch (error) { showMessage(error.message || 'Could not open this profile. Please try again.'); }
        finally { busy = false; byId('profileControls').disabled = false; }
    };
    const reloadToPicker = () => {
        window.saveCurrentProgress?.();
        sessionStorage.removeItem(SELECTED_PROFILE_KEY);
        location.reload();
    };

    const render = () => {
        const list = byId('deviceProfileList');
        list.replaceChildren();
        const profiles = readProfiles();
        byId('noProfilesMessage').hidden = profiles.length > 0;
        for (const profile of profiles) {
            const row = document.createElement('div');
            row.className = 'device-profile-row';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'device-profile-card';
            open.textContent = profile.name;
            open.setAttribute('aria-label', profile.name);
            open.title = `Switch to ${profile.name}`;
            open.addEventListener('click', () => run(async () => {
                if (navigator.onLine) {
                    if (!supabase) throw new Error('The profile service is not configured.');
                    const { data, error } = await supabase.auth.setSession(profile.session || {});
                    if (error || data?.session?.user?.id !== profile.id) {
                        throw new Error('This device has lost access to the profile. Import your saved profile file to make a new copy.');
                    }
                    const verified = await liveProfileSession(supabase, profile.id);
                    if (!verified.valid) throw new Error('This device has lost access to the profile. Import your saved profile file to make a new copy.');
                    rememberProfile(data.session);
                } else {
                    const snapshot = await loadCurriculumSnapshot({ userId: profile.id });
                    if (!snapshot?.nodes?.length) throw new Error('Connect once to download this profile for offline use.');
                }
                sessionStorage.setItem(SELECTED_PROFILE_KEY, profile.id);
                rememberLastProfile(profile.id);
                location.reload();
            }));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'secondary';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label', `Remove ${profile.name} from this device`);
            remove.addEventListener('click', () => run(async () => {
                if (!confirm(`Remove ${profile.name} from this device? Their saved progress stays on the server.`)) return;
                const { data } = await supabase?.auth.getSession() || {};
                if (data?.session?.user?.id === profile.id) {
                    const { error } = await supabase.auth.signOut({ scope: 'local' });
                    if (error) throw error;
                }
                forgetProfile(profile.id);
                render();
            }));
            row.append(open, remove);
            list.append(row);
        }
    };

    showPicker();
    render();
    byId('signOutBtn').addEventListener('click', reloadToPicker);
    byId('profileNameForm').addEventListener('submit', (event) => {
        event.preventDefault();
        try {
            renameProfile(window.currentUserId, byId('profileNameInput').value);
            byId('userEmailDisplay').textContent = byId('profileNameInput').value.trim();
            byId('profileSettingsMessage').textContent = 'Profile name saved on this device.';
        } catch (error) { byId('profileSettingsMessage').textContent = error.message; }
    });

    const backupNotice = byId('profileBackupNotice');
    const showBackupNotice = () => {
        if (!backupNotice || !window.currentUserId) return;
        try {
            const dismissedUntil = Number(localStorage.getItem(backupNoticeKey(window.currentUserId)) || 0);
            backupNotice.hidden = dismissedUntil > Date.now();
        } catch { backupNotice.hidden = false; }
    };
    const dismissBackupNotice = () => {
        try { localStorage.setItem(backupNoticeKey(window.currentUserId), String(Date.now() + 30 * 24 * 60 * 60 * 1000)); } catch { /* Continue without the reminder preference. */ }
        if (backupNotice) backupNotice.hidden = true;
    };
    byId('dismissProfileBackupNoticeBtn')?.addEventListener('click', dismissBackupNotice);

    const createProfile = async (name, backup = null) => {
        if (!navigator.onLine || !supabase) throw new Error('An internet connection is required to create or import a profile.');
        const { data: previous } = await supabase.auth.getSession();
        changingProfile = true;
        let newSession;
        try {
            const { data, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name } } });
            if (error) throw error;
            newSession = data.session;
            if (backup) {
                const { error: importError } = await supabase.rpc('import_device_profile', { p_backup: backup });
                if (importError) throw importError;
            }
            const profile = rememberProfile(newSession);
            renameProfile(profile.id, name);
            sessionStorage.setItem(SELECTED_PROFILE_KEY, profile.id);
            location.reload();
        } catch (error) {
            if (newSession) {
                forgetProfile(newSession.user.id);
                await supabase.auth.signOut({ scope: 'local' });
                if (previous?.session) await supabase.auth.setSession(previous.session);
            }
            throw error;
        } finally { changingProfile = false; }
    };
    byId('createProfileForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = byId('newProfileName').value.trim();
        if (name) void run(() => createProfile(name));
    });
    byId('profileImportFile').addEventListener('change', () => run(async () => {
        const file = byId('profileImportFile').files?.[0];
        if (!file) return;
        if (file.size > PROFILE_FILE_LIMIT) throw new Error('This profile file is too large (maximum 10 MB).');
        let parsed;
        try { parsed = JSON.parse(await file.text()); }
        catch { throw new Error('Choose a valid Yoga profile JSON file.'); }
        const backup = validateProfileBackup(parsed);
        await createProfile(`${backup.name.slice(0, 53)} (copy)`, backup);
    }));
    const exportProfile = async () => {
        const button = byId('exportProfileBtn');
        if (button.disabled) return;
        button.disabled = true;
        try {
            const backup = await exportProfileBackup();
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Yoga - ${backup.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)} - Backup.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            byId('profileSettingsMessage').textContent = 'Profile exported. Keep the file somewhere you can find it again.';
            try { localStorage.setItem(backupNoticeKey(window.currentUserId), String(Date.now() + 90 * 24 * 60 * 60 * 1000)); } catch { /* The export itself succeeded. */ }
            if (backupNotice) backupNotice.hidden = true;
        } catch (error) { byId('profileSettingsMessage').textContent = error.message; }
        finally { button.disabled = false; }
    };
    byId('exportProfileBtn').addEventListener('click', exportProfile);
    byId('exportProfileNoticeBtn')?.addEventListener('click', exportProfile);

    // Synchronous bookkeeping only: awaiting Auth methods in this callback can deadlock GoTrue.
    supabase?.auth.onAuthStateChange((event, session) => {
        if (session?.refresh_token && !changingProfile) {
            try { rememberProfile(session); } catch { /* Opening the profile reports storage errors. */ }
        }
        if (event === 'SIGNED_OUT' && !changingProfile && window.currentUserId) reloadToPicker();
    });

    // Supabase's active session is shared by tabs. Never keep another profile's UI
    // open while this tab's requests would be sent using a different user's token.
    window.addEventListener('storage', (event) => {
        if (event.key === PROFILES_KEY && !window.currentUserId) render();
        if (event.key !== supabaseConfig?.storageKey || !window.currentUserId) return;
        let next;
        try { next = JSON.parse(event.newValue || 'null'); } catch { /* Missing session closes the profile. */ }
        if (next?.user?.id !== window.currentUserId) reloadToPicker();
    });

    await run(async () => {
        const result = navigator.onLine ? await supabase?.auth.getSession() : null;
        const session = result?.data?.session;
        // Adopt existing signed-in users without creating a replacement identity.
        if (session?.refresh_token) rememberProfile(session);
        render();
        // The active Supabase session is still the source of truth. The
        // local last-used id only removes the need to click the same profile
        // after a normal reload/browser restart; it is never used to switch a
        // different authenticated tab to another profile.
        const selectedId = sessionStorage.getItem(SELECTED_PROFILE_KEY) || readLastProfileId();
        const profile = readProfiles().find((item) => item.id === selectedId);
        if (!profile) return;
        showMessage('Opening your last-used profile…');
        let online = navigator.onLine;
        if (online) {
            if (session?.user?.id !== profile.id) {
                sessionStorage.removeItem(SELECTED_PROFILE_KEY);
                return;
            }
            const verified = await liveProfileSession(supabase, profile.id);
            if (!verified.valid) throw new Error('Could not open this profile. Check your internet connection, or import your saved profile file.');
        } else {
            const snapshot = await loadCurriculumSnapshot({ userId: profile.id });
            if (!snapshot?.nodes?.length) throw new Error('Connect once to download this profile for offline use.');
        }
        window.currentUserId = profile.id;
        sessionStorage.setItem(SELECTED_PROFILE_KEY, profile.id);
        rememberLastProfile(profile.id);
        window.currentUserEmail = profile.email;
        window.isGuestMode = false;
        window.isTrustedOfflineMode = !online;
        window.hasLiveProfileSession = online;
        window.isAppAdmin = online && session?.user?.app_metadata?.role === 'admin';
        if (online) await syncProfilePreferences(profile.id).catch(() => {});
        // Best-effort additive migration. Offline profiles remain usable and
        // retry this step on the next online profile selection.
        if (online) await migrateProfileSequences(profile.id).catch((error) =>
            console.warn('[Profile] Sequence migration deferred:', error.message));
        themeManager.setUserId(profile.id);
        byId('userEmailDisplay').textContent = profile.name;
        byId('profileNameInput').value = profile.name;
        showBackupNotice();
        byId('loginScreen').style.display = 'none';
        byId('mainAppContainer').style.display = '';
        if (!window.appInitialized) await window.init?.();
        window.dispatchEvent(new CustomEvent('yoga:verified-session', { detail: { user: session?.user || { id: profile.id } } }));
        if (online) {
            const { flushCompletionQueue, restorePendingCompletionRating } = await import('../services/historyService.js');
            await flushCompletionQueue();
            await restorePendingCompletionRating();
        }
    });
    window.addEventListener('online', () => { if (window.currentUserId) location.reload(); });
    window.addEventListener('offline', () => {
        window.hasLiveProfileSession = false;
        window.isTrustedOfflineMode = Boolean(window.currentUserId);
    });
    byId('loginScreen').dataset.ready = 'true';
}
