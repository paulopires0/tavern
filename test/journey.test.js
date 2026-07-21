import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyIsLive } from '../client/src/journey.js';

const road = [[0, 0], [100, 100]];

test('a kingdom journey cue plays once, while it is fresh', () => {
  assert.equal(journeyIsLive({ path: road, nonce: Date.now(), durationMs: 4000 }), true,
    'a cue issued just now plays');
  assert.equal(journeyIsLive({ path: road, nonce: Date.now() - 2000, durationMs: 4000 }), true,
    'still walking halfway through');
});

test('a finished or left-over cue never replays', () => {
  // the trip is over: re-opening the kingdom map must NOT animate again
  assert.equal(journeyIsLive({ path: road, nonce: Date.now() - 9000, durationMs: 4000 }), false,
    'cue older than the walk is stale');
  assert.equal(journeyIsLive({ path: road, nonce: Date.now() - 86400000, durationMs: 4000 }), false,
    'a cue left in the config from an earlier session is stale');
});

test('malformed cues are ignored', () => {
  assert.equal(journeyIsLive(null), false);
  assert.equal(journeyIsLive({}), false);
  assert.equal(journeyIsLive({ nonce: Date.now() }), false, 'no path');
  assert.equal(journeyIsLive({ path: [[0, 0]], nonce: Date.now() }), false, 'a single point is not a road');
});
