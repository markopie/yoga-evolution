export function normalisePoseId(value) {
    const token = String(value ?? '').trim();
    if (!token) return '';
    const match = token.match(/^(\d+)([a-z]?)$/i);
    if (!match) return token.toLowerCase();
    return match[1].replace(/^0+(?=\d)/, '').padStart(3, '0') + match[2].toLowerCase();
}

export function poseIdFromSequenceNode(node) {
    const rawId = Array.isArray(node?.[0]) ? node[0][0] : node?.[0];
    if (rawId == null || /^(?:LOOP_START|LOOP_END|GROUP_END|MACRO:.*)$/i.test(String(rawId).trim())) return '';
    return normalisePoseId(rawId);
}
