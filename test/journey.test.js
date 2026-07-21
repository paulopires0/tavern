import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyIsLive } from '../client/src/journey.js';
import { setMoveFlag, wasTeleport, movePathOf } from '../server/moveFlags.js';

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

test('a walk animates once, then the token just stands there', () => {
  const road = [[0, 0], [50, 50]];
  setMoveFlag('character', 4242, false, road);
  assert.equal(wasTeleport('character', 4242), false, 'the move just happened: walk it');
  assert.deepEqual(movePathOf('character', 4242), road);

  // the same move, now history: re-opening its map must not replay the walk
  setMoveFlag('character', 4242, false, road, Date.now() - 60000);
  assert.equal(wasTeleport('character', 4242), true, 'an old move snaps instead of re-walking');
  assert.equal(movePathOf('character', 4242), null, 'and carries no route to animate');
});

test('an unknown token snaps', () => {
  assert.equal(wasTeleport('character', 999999), true);
  assert.equal(movePathOf('character', 999999), null);
});

test('malformed cues are ignored', () => {
  assert.equal(journeyIsLive(null), false);
  assert.equal(journeyIsLive({}), false);
  assert.equal(journeyIsLive({ nonce: Date.now() }), false, 'no path');
  assert.equal(journeyIsLive({ path: [[0, 0]], nonce: Date.now() }), false, 'a single point is not a road');
});
