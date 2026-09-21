const HOSTED_STORAGE_PUBLIC_PREFIX = 'https://qrcpiyncvfmpmeuyhsha.supabase.co/storage/v1/object/public/';

function supabaseUrl() {
    const configured = String(import.meta.env?.VITE_SUPABASE_URL || '');
    const value = configured === 'same-origin' && typeof window !== 'undefined'
        ? window.location.origin
        : configured;
    return value.replace(/\/+$/, '');
}

export function storagePublicBase(bucket) {
    const baseUrl = supabaseUrl();
    return baseUrl && bucket
        ? `${baseUrl}/storage/v1/object/public/${bucket}/`
        : '';
}

export function canonicalizeStorageObjectPath(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .join('/');
}

export function resolveSupabaseStorageUrl(value, fallbackBucket = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

    let path = raw;
    if (path.startsWith(HOSTED_STORAGE_PUBLIC_PREFIX)) {
        path = `/storage/v1/object/public/${path.slice(HOSTED_STORAGE_PUBLIC_PREFIX.length)}`;
    }

    if (path.startsWith('/storage/v1/object/public/')) {
        const prefix = '/storage/v1/object/public/';
        const normalizedObject = canonicalizeStorageObjectPath(path.slice(prefix.length));
        path = `${prefix}${normalizedObject}`;
        const baseUrl = supabaseUrl();
        return baseUrl ? `${baseUrl}${path}` : path;
    }

    if (/^https?:\/\//i.test(path)) return path;
    if (!fallbackBucket) return path;

    const normalizedPath = canonicalizeStorageObjectPath(path);
    return `${storagePublicBase(fallbackBucket)}${normalizedPath}`;
}
