import test from 'node:test';
import assert from 'node:assert/strict';
import { sfxIsLive, SFX_FRESH_MS } from '../client/src/sfx.js';

const cue = (age) => ({ url: '/uploads/music/boom.wav', name: 'Boom', nonce: Date.now() - age });

test('a sound just fired plays', () => {
  assert.equal(sfxIsLive(cue(0)), true);
  assert.equal(sfxIsLive(cue(SFX_FRESH_MS - 500)), true, 'still inside the window');
});

test('a left-over cue never plays', () => {
  assert.equal(sfxIsLive(cue(SFX_FRESH_MS + 500)), false, 'fired a moment too long ago');
  assert.equal(sfxIsLive(cue(86400000)), false, 'left in the config from an earlier session');
});

test('malformed cues are ignored', () => {
  assert.equal(sfxIsLive(null), false);
  assert.equal(sfxIsLive({}), false);
  assert.equal(sfxIsLive({ nonce: Date.now() }), false, 'no url');
  assert.equal(sfxIsLive({ url: '/x.wav' }), false, 'no nonce');
});
