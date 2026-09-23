import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { origin: 'https://app.test' } };
const { missingManifestAudioReferences, referencedAudioAssets } = await import('./offlineMedia.js');

test('finds main, variation, relative and full storage audio references', () => {
    const refs = referencedAudioAssets({
        courses: [{ poses: [['001', 30, 'Mountain']] }],
        asanaLibrary: {
            '001': {
                id: '001', name: 'Mountain', audio: 'https://qrcpiyncvfmpmeuyhsha.supabase.co/storage/v1/object/public/audio-assets/001_main.mp3',
                variations: { supported: { audio_url: 'variations/001_supported.mp3' } },
            },
        },
    });
    assert.ok(refs.some((ref) => ref.objectPath === '001_main.mp3'));
    assert.ok(refs.some((ref) => ref.objectPath === 'variations/001_supported.mp3'));
    assert.ok(refs.some((ref) => ref.objectPath === 'left_side.mp3'));
});

test('reports referenced audio missing from the manifest', () => {
    const refs = [{ bucket: 'audio-assets', objectPath: 'missing.mp3' }];
    assert.deepEqual(missingManifestAudioReferences([], refs), refs);
    assert.deepEqual(missingManifestAudioReferences([{ bucket: 'audio-assets', objectPath: 'missing.mp3' }], refs), []);
});

test('matches audio references case-insensitively to storage manifest paths', () => {
    const refs = [{ bucket: 'audio-assets', objectPath: '034_ParipurnaNavasana.mp3' }];
    const manifest = [{ bucket: 'audio-assets', objectPath: '034_paripurnanavasana.mp3', mediaType: 'audio' }];
    assert.deepEqual(missingManifestAudioReferences(manifest, refs), []);
});
