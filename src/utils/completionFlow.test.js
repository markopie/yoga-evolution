import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ratingOverlayOptionsForCompletion } from './completionFlow.js';

describe('completion flow helpers', () => {
  test('opens progress history after a manual completion is rated', () => {
    assert.deepStrictEqual(ratingOverlayOptionsForCompletion(null), {
      afterRatingAction: 'openHistory',
      resetAfterRating: false,
    });
  });

  test('loads the next curriculum practice after curriculum completion rating', () => {
    assert.deepStrictEqual(
      ratingOverlayOptionsForCompletion({ curriculum_node_id: 786 }),
      {
        afterRatingAction: 'openHistory',
        resetAfterRating: false,
      },
    );
  });
});
