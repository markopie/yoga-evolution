import { displayName, prefersIAST } from '../utils/format.js';

export function googleImageReferenceUrl(asana, variationName = '') {
    const name = String(asana?.iast || asana?.canonical_name || asana?.english || asana?.name || '').trim();
    if (!name) return null;
    const recognisedVariation = String(variationName || '').trim();
    const query = [name, recognisedVariation, 'Iyengar yoga'].filter(Boolean).join(' ');
    return `https://www.google.com/search?${new URLSearchParams({ tbm: 'isch', q: query }).toString()}`;
}

export function openImageReferences(asana, variationName = '', opener = window.open) {
    const url = googleImageReferenceUrl(asana, variationName);
    if (!url) return null;
    opener(url, '_blank', 'noopener,noreferrer');
    return url;
}

export function renderTeachingCard({ asana, poseName = '', poseId = '', variation = '', side = '', timing = '', props = [], note = '', onPlayAudio = null, compact = false } = {}) {
    const card = document.createElement('section');
    card.className = `teaching-card${compact ? ' teaching-card--compact' : ''}`;
    const primary = poseName || displayName(asana) || 'Pose';
    const secondary = asana && (prefersIAST() ? asana.english : asana.iast);
    const name = document.createElement('div');
    name.className = 'teaching-card__name';
    name.textContent = primary;
    card.appendChild(name);
    if (secondary && secondary !== primary) {
        const secondaryName = document.createElement('div');
        secondaryName.className = 'teaching-card__secondary';
        secondaryName.textContent = secondary;
        card.appendChild(secondaryName);
    }
    const fields = [[poseId && `ID: ${poseId}`], [side && `Side: ${side}`], [variation && `Variation: ${variation}`], [timing], [props.length && `Props: ${props.join(', ')}`]].flat().filter(Boolean);
    if (fields.length) {
        const meta = document.createElement('div');
        meta.className = 'teaching-card__meta';
        meta.textContent = fields.join(' • ');
        if (onPlayAudio) {
            const audio = document.createElement('button');
            audio.type = 'button';
            audio.className = 'tiny teaching-card__audio';
            audio.textContent = '🔊';
            audio.setAttribute('aria-label', 'Play pose audio');
            audio.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onPlayAudio();
            });
            meta.append(' ');
            meta.appendChild(audio);
        }
        card.appendChild(meta);
    }
    if (note) {
        const context = document.createElement('div');
        context.className = 'teaching-card__context';
        context.textContent = note;
        card.appendChild(context);
    }
    const url = googleImageReferenceUrl(asana || { english: poseName }, variation);
    if (url && navigator.onLine) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tiny teaching-card__reference';
        button.textContent = 'View image references ↗';
        button.setAttribute('aria-label', 'View image references. Opens Google Images in a new tab');
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openImageReferences(asana || { english: poseName }, variation);
        });
        card.appendChild(button);
    } else if (url) {
        const offline = document.createElement('div');
        offline.className = 'teaching-card__offline';
        offline.textContent = 'Image references require an internet connection.';
        card.appendChild(offline);
    }
    return card;
}
