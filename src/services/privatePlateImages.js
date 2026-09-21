import { supabase } from './supabaseClient.js';
import { hasOfflineAsset, offlineMediaUrl } from './offlineMedia.js';
import { withNetworkTimeout } from './networkTimeout.js';

const PRIVATE_PLATE_BUCKET = 'light-on-yoga-plates';
const PRIVATE_PLATE_PREFIX = 'plates';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function canUsePrivatePlateImages() {
    return window.isAppAdmin === true;
}

export function plateStoragePath(plateLabel) {
    const label = normalizePlateLabel(plateLabel);
    return label ? `${PRIVATE_PLATE_PREFIX}/${label}.webp` : '';
}

export function normalizePlateLabel(value) {
    const match = String(value || '').trim().toLowerCase().match(/^0*(\d+)([a-z]?)$/);
    if (!match) return '';
    return `${String(Number.parseInt(match[1], 10)).padStart(3, '0')}${match[2] || ''}`;
}

export function parsePlateGroups(raw) {
    const groups = { final: [], intermediate: [] };
    const text = String(raw || '').trim();
    if (!text) return groups;

    const finalMatch = text.match(/(?:^|\|)\s*final\s*:\s*([^|]+)/i);
    const intermediateMatch = text.match(/(?:^|\|)\s*(?:int|intermediate)\s*:\s*([^|]+)/i);

    groups.final = extractPlateLabels(finalMatch?.[1]);
    groups.intermediate = extractPlateLabels(intermediateMatch?.[1]);
    return groups;
}

export async function attachPrivatePlateUrls(asanasById) {
    if (!canUsePrivatePlateImages()) return asanasById;

    const pathByPlate = new Map();
    Object.values(asanasById).forEach((asana) => {
        const groups = parsePlateGroups(asana.plate_numbers_raw);
        const labels = [...groups.final, ...groups.intermediate];
        asana.private_plate_labels = labels;
        labels.forEach((label) => pathByPlate.set(label, plateStoragePath(label)));
    });

    const paths = [...new Set([...pathByPlate.values()].filter(Boolean))];
    if (!paths.length) return asanasById;

    const offlineUrlByPath = new Map(
        paths
            .filter((path) => hasOfflineAsset(PRIVATE_PLATE_BUCKET, path))
            .map((path) => [path, offlineMediaUrl(PRIVATE_PLATE_BUCKET, path)]),
    );
    const onlinePaths = paths.filter((path) => !offlineUrlByPath.has(path));
    const signedUrlByPath = supabase && onlinePaths.length
        ? await createSignedUrlMap(onlinePaths)
        : new Map();
    Object.values(asanasById).forEach((asana) => {
        const labels = asana.private_plate_labels || [];
        asana.private_plate_urls = labels
            .map((label) => {
                const path = plateStoragePath(label);
                return offlineUrlByPath.get(path) || signedUrlByPath.get(path);
            })
            .filter(Boolean);
    });

    return asanasById;
}

async function createSignedUrlMap(paths) {
    const out = new Map();
    const chunkSize = 100;

    for (let i = 0; i < paths.length; i += chunkSize) {
        const chunk = paths.slice(i, i + chunkSize);
        let result;
        try {
            result = await withNetworkTimeout(supabase
                .storage
                .from(PRIVATE_PLATE_BUCKET)
                .createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS));
        } catch (error) {
            console.warn('Private plate image signing timed out; saved plates remain available.', error.message);
            return out;
        }
        const { data, error } = result;

        if (error) {
            console.warn('Private plate image signing failed:', error.message);
            return out;
        }

        data?.forEach((item) => {
            if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
        });
    }

    return out;
}

function extractPlateLabels(value) {
    return [...new Set(
        String(value || '')
            .match(/\d+[a-z]?/gi)
            ?.map(normalizePlateLabel)
            .filter(Boolean) || []
    )];
}
