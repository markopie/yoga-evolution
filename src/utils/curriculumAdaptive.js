export function latestLowRatedCurriculumNode(nodes, completions) {
    const nodesById = new Map((nodes || []).map((node) => [String(node.id), node]));
    const latest = (completions || [])
        .filter((row) =>
            row.completed !== false
            && row.curriculum_node_id != null
            && nodesById.has(String(row.curriculum_node_id)))
        .sort((left, right) => {
            const time = new Date(right.completed_at || 0).getTime()
                - new Date(left.completed_at || 0).getTime();
            if (time !== 0) return time;
            return String(right.id || '').localeCompare(String(left.id || ''));
        })[0];

    if (!latest || Number(latest.rating) > 2 || Number(latest.rating) < 1) return null;
    return nodesById.get(String(latest.curriculum_node_id)) || null;
}
