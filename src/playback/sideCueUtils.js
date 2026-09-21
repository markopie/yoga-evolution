const TRUE_VALUES = new Set(['true', '1', 'yes']);

export function requiresBilateralSides(asana) {
    if (!asana) return false;
    const value = asana.requires_sides ?? asana.requiresSides ?? false;
    return value === true || TRUE_VALUES.has(String(value).trim().toLowerCase());
}

export function normalizePlaybackSide(side, isSecondSide = false) {
    const value = String(side || '').trim().toLowerCase();
    if (value === 'left' || value === 'l') return 'left';
    if (value === 'right' || value === 'r') return 'right';
    return isSecondSide ? 'left' : null;
}

export function sideCueSpeech(side) {
    const normalized = normalizePlaybackSide(side);
    return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)} side` : '';
}
