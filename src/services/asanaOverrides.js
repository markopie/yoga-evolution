export function mergeAsanaOverrides(library, rows = []) {
    const merged = { ...library };
    for (const row of rows) {
        const id = String(row?.asana_id || row?.payload?.id || '').trim();
        if (!id) continue;
        if (row.is_deleted) {
            delete merged[id];
            continue;
        }
        if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) continue;
        const variations = row.payload.variations || {};
        merged[id] = {
            ...merged[id],
            ...row.payload,
            id,
            asanaNo: id,
            variations,
            inlineVariations: Object.keys(variations).map((key) => ({
                label: key,
                text: variations[key],
            })),
            isCustom: true,
            allPlates: [id],
        };
    }
    return merged;
}

export function makePersonalAsanaId(library = {}, random = Math.random) {
    let id;
    do {
        const suffix = Math.floor(random() * 1_000_000_000).toString().padStart(9, '0');
        id = `9${suffix}`;
    } while (library[id]);
    return id;
}
