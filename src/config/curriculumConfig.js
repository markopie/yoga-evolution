const curriculumPreview = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('curriculum');

export function curriculumConfigFor(preview) {
    if (preview === 'week1') {
        return {
            slug: 'iyengar_integrated_week_1_review_v1',
            name: 'Iyengar Curriculum — Week 1 Review',
        };
    }
    if (preview === 'testing') {
        return {
            slug: 'iyengar_integrated_master_path_testing_v2',
            name: 'Iyengar Practice Path — 24-week test',
        };
    }
    if (preview === 'v3' || preview === 'previous') {
        return {
            slug: 'iyengar_integrated_source_faithful_v3_repair_review',
            name: 'Iyengar Curriculum — Previous v3 repair',
        };
    }
    return {
        slug: 'iyengar_integrated_source_faithful_v4',
        name: 'Iyengar Curriculum',
    };
}

const activeCurriculum = curriculumConfigFor(curriculumPreview);

export const ACTIVE_CURRICULUM_SLUG = activeCurriculum.slug;
export const ACTIVE_CURRICULUM_NAME = activeCurriculum.name;
