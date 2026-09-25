import { displayName } from '../utils/format.js';

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

export function renderTeachingCard({ asana, poseName = '', poseId = '', variation = '', variationOptions = [], onVariationChange = null, side = '', timing = '', props = [], note = '', onPlayAudio = null, compact = false, focusMode = false } = {}) {
    const card = document.createElement('section');
    card.className = `teaching-card${compact ? ' teaching-card--compact' : ''}${focusMode ? ' teaching-card--focus' : ''}`;
    const primary = poseName || displayName(asana) || 'Pose';
    const secondary = asana?.iast && asana.iast !== primary ? asana.iast : '';
    const name = document.createElement('div');
    name.className = 'teaching-card__name';
    name.textContent = primary;
    card.appendChild(name);
    if (secondary && secondary !== primary) {
        const secondaryName = document.createElement('div');
        secondaryName.className = 'teaching-card__secondary teaching-card__iast';
        secondaryName.textContent = secondary;
        card.appendChild(secondaryName);
    }
    if (asana?.devanagari) {
        const devanagari = document.createElement('div');
        devanagari.className = 'teaching-card__devanagari';
        devanagari.textContent = asana.devanagari;
        card.appendChild(devanagari);
    }
    const fields = [[!focusMode && poseId && `ID: ${poseId}`], [side && `Side: ${side}`], [variation && `Variation: ${variation}`], [!focusMode && timing], [props.length && `Props: ${props.join(', ')}`]].flat().filter(Boolean);
    if (fields.length || onPlayAudio) {
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

    if (!focusMode && variationOptions.length) {
        const variationRow = document.createElement('label');
        variationRow.className = 'teaching-card__variation-picker';
        variationRow.append('Image reference for ');
        const picker = document.createElement('div');
        picker.className = 'teaching-card__variation-menu';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'teaching-card__variation-trigger';
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        const menu = document.createElement('div');
        menu.className = 'teaching-card__variation-options';
        menu.hidden = true;
        let selectedKey = variation || '';
        const updateTrigger = () => {
            const selected = variationOptions.find((option) => option.key === selectedKey);
            trigger.textContent = selected?.title || 'Base pose';
        };
        const choose = (key) => {
            selectedKey = key;
            referenceVariation = variationOptions.find((option) => option.key === selectedKey)?.title || selectedKey;
            updateTrigger();
            menu.querySelectorAll('button').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.key === selectedKey)));
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            onVariationChange?.(selectedKey);
        };
        [{ key: '', title: 'Base pose' }, ...variationOptions].forEach(({ key, title }) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.dataset.key = key;
            option.setAttribute('role', 'menuitemradio');
            option.setAttribute('aria-checked', String(key === selectedKey));
            option.textContent = title || key;
            option.addEventListener('click', () => choose(key));
            menu.appendChild(option);
        });
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            menu.hidden = !menu.hidden;
            trigger.setAttribute('aria-expanded', String(!menu.hidden));
        });
        updateTrigger();
        picker.append(trigger, menu);
        variationRow.appendChild(picker);
        card.appendChild(variationRow);
    }
    let referenceVariation = variationOptions.find((option) => option.key === variation)?.title || variation;
    const url = googleImageReferenceUrl(asana || { english: poseName }, referenceVariation);
    if (!focusMode && url && navigator.onLine) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tiny teaching-card__reference';
        button.textContent = 'View image references ↗';
        button.setAttribute('aria-label', 'View image references. Opens Google Images in a new tab');
        button.title = referenceVariation ? `Open Google Images references for ${referenceVariation}` : 'Open Google Images references for this asana';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openImageReferences(asana || { english: poseName }, referenceVariation);
        });
        card.appendChild(button);
    }
    return card;
}
