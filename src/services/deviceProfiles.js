const env = import.meta.env || {};
export const PROFILE_NAMESPACE = env.VITE_BROWSER_TEST_MOCKS === '1'
    ? 'browser-test' : (env.VITE_SUPABASE_TARGET || 'local');
export const PROFILES_KEY = `yoga-${PROFILE_NAMESPACE}-device-profiles-v1`;
export const SELECTED_PROFILE_KEY = `yoga-${PROFILE_NAMESPACE}-selected-profile-v1`;

export function readProfiles(storage = localStorage) {
    try {
        const profiles = JSON.parse(storage.getItem(PROFILES_KEY) || '[]');
        return Array.isArray(profiles) ? profiles.filter((profile) =>
            typeof profile?.id === 'string' && typeof profile?.name === 'string') : [];
    } catch { return []; }
}

export function rememberProfile(session, storage = localStorage) {
    if (!session?.user?.id || !session.access_token || !session.refresh_token) {
        throw new Error('This profile session is unavailable. Import your saved profile file to make a new copy.');
    }
    const profiles = readProfiles(storage);
    const previous = profiles.find((profile) => profile.id === session.user.id);
    // Assign older browser-wide preferences once, only to an existing account.
    // Newly created/imported profiles must never inherit someone else's settings.
    const migrationKey = `yoga-${PROFILE_NAMESPACE}-legacy-preferences-owner`;
    if (!session.user.is_anonymous && !storage.getItem(migrationKey)) {
        const key = profileStorageKey('preferences-v1', session.user.id);
        if (!storage.getItem(key)) {
            const theme = storage.getItem('yoga-app-theme');
            const iast = storage.getItem('yoga_prefer_iast');
            const values = {};
            if (['light', 'dark'].includes(theme)) values.theme = theme;
            if (iast !== null) values.preferIast = iast !== 'false';
            storage.setItem(key, JSON.stringify({ values, dirty: true }));
        }
        storage.setItem(migrationKey, session.user.id);
    }
    const profile = {
        id: session.user.id,
        name: previous?.name || session.user.user_metadata?.display_name
            || session.user.email?.split('@')[0] || 'My profile',
        email: session.user.email || '',
        session,
    };
    storage.setItem(PROFILES_KEY, JSON.stringify([
        ...profiles.filter((item) => item.id !== profile.id), profile,
    ]));
    return profile;
}

export function forgetProfile(id, storage = localStorage) {
    storage.setItem(PROFILES_KEY, JSON.stringify(readProfiles(storage).filter((profile) => profile.id !== id)));
}

export function renameProfile(id, name, storage = localStorage) {
    const trimmed = String(name || '').trim().slice(0, 60);
    if (!trimmed) throw new Error('Enter a profile name.');
    storage.setItem(PROFILES_KEY, JSON.stringify(readProfiles(storage).map((profile) =>
        profile.id === id ? { ...profile, name: trimmed } : profile)));
}

export function profileStorageKey(key, userId = globalThis.window?.currentUserId) {
    return `${key}:${PROFILE_NAMESPACE}:${userId || 'picker'}`;
}

export async function liveProfileSession(client, expectedUserId) {
    if (!client || !expectedUserId) return { valid: false };
    try {
        const { data, error } = await client.auth.getUser();
        return { valid: !error && data?.user?.id === expectedUserId, user: data?.user };
    } catch { return { valid: false }; }
}
