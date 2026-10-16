/**
 * Classify an error from a Supabase auth call as either a genuine network
 * failure (offline, timeout, DNS) or an authentication failure (expired
 * session, revoked access, invalid credentials).
 *
 * Network failures legitimately fall back to offline mode when a cached
 * curriculum snapshot exists. Authentication failures must not — they
 * indicate the session is no longer valid and offline access would grant
 * unauthorised access to protected data.
 */
export function isAuthError(error) {
    if (!error) return false;
    const message = String(error.message || '').toLowerCase();
    const status = error.status ?? error.code;
    if (status === 401 || status === 403) return true;
    if (error.name === 'AuthError' || error.name === 'AuthApiError') return true;
    const authSignals = [
        'invalid credentials',
        'session expired',
        'session not found',
        'jwt expired',
        'refresh_token',
        'token is invalid',
        'token has expired',
        'revoked',
        'not authorized',
        'unauthorized',
        'forbidden',
        'email not confirmed',
        'user not found',
    ];
    return authSignals.some(signal => message.includes(signal));
}

export function isNetworkError(error) {
    if (!error) return false;
    if (isAuthError(error)) return false;
    const message = String(error.message || '').toLowerCase();
    const name = String(error.name || '');
    if (name === 'TypeError' && message.includes('fetch')) return true;
    if (name === 'FetchError') return true;
    const networkSignals = [
        'failed to fetch',
        'network',
        'offline',
        'timeout',
        'timed out',
        'connection refused',
        'dns',
        'err_internet_disconnected',
        'internet connection',
    ];
    return networkSignals.some(signal => message.includes(signal));
}
