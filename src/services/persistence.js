import { supabase } from './supabaseClient.js';

/** Resolve an existing shared category without creating global taxonomy rows. */
export async function getOrCreateSubCategoryId(fullCategoryString) {
    if (!fullCategoryString) return null;

    const [authorPart, subPart] = fullCategoryString.split('>').map(s => s.trim());
    const mainName = authorPart || "General";
    const subName = subPart || "General";

    // 1. Get or Create the Main Category (Author/Brand)
    let { data: cat, error: catErr } = await supabase
        .from('course_categories')
        .select('id')
        .eq('name', mainName)
        .maybeSingle();

    if (catErr) throw new Error(`Category lookup failed: ${catErr.message}`);

    if (!cat) return null;

    // 2. Get or Create the Sub-Category (Course/Level)
    let { data: sub, error: subErr } = await supabase
        .from('course_sub_categories')
        .select('id')
        .eq('category_id', cat.id)
        .eq('name', subName)
        .maybeSingle();

    if (subErr) throw new Error(`Sub-category lookup failed: ${subErr.message}`);

    return sub?.id ?? null;
}

/** Save a profile-owned sequence; shared sequences must be copied first. */
export async function saveSequence(payload, knownId = null) {
    const subCategoryId = await getOrCreateSubCategoryId(payload.category);
    
    // Logic Architect Note: Ensure user_id is explicitly present
    if (!payload.user_id) {
        throw new Error("Security Violation: Cannot save sequence without a valid user_id.");
    }

    const dbPayload = {
        title: payload.title,
        sequence_json: payload.sequence_json,
        sub_category_id: subCategoryId, 
        category: payload.category || null,
        last_edited: payload.last_edited,
        user_id: payload.user_id, // Mandatory for the new RLS check
        condition_notes: payload.condition_notes,
        is_alias: payload.is_alias,
        redirect_id: payload.redirect_id
    };

    if (payload.sequence_text !== undefined) dbPayload.sequence_text = payload.sequence_text;
    
    dbPayload.is_system = false;

    // 1. Direct Update via knownId
    if (knownId) {
        const { data, error } = await supabase
            .from('courses')
            .update(dbPayload)
            .eq('id', knownId)
            .eq('user_id', payload.user_id)
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This sequence is not owned by the active profile. Save a personal copy to edit it.');
        return { id: knownId };
    } 

    const { data: inserted, error: insErr } = await supabase
        .from('courses')
        .insert([dbPayload])
        .select('id')
        .single();
        
    if (insErr) throw insErr;
    return { id: inserted.id };
}
/**
 * Finds an existing Asana Category and returns its ID.
 */
export async function findAsanaCategoryId(categoryName) {
    if (!categoryName) return null;
    const cleanName = categoryName.trim();

    const { data: cat, error: catErr } = await supabase
        .from('asana_categories')
        .select('id')
        .eq('name', cleanName)
        .maybeSingle();

    if (catErr) throw new Error(`Asana category lookup failed: ${catErr.message}`);
    if (!cat) {
        throw new Error(`Asana category "${cleanName}" does not exist. Create it through an admin-only database path before assigning it.`);
    }

    return cat.id;
}
