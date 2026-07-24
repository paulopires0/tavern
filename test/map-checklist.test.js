import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSetupIssues } from '../client/src/dm/mapSetup.js';

const base = {
  id: 1, name: 'Keep', scale: 30, default_track_id: 5, world_x: 10, world_y: 20,
  is_template: 0, is_world: 0,
};

test('a fully set-up map raises no issues', () => {
  assert.equal(mapSetupIssues([base]).length, 0);
});

test('each missing piece is flagged', () => {
  const [r] = mapSetupIssues([{ ...base, scale: 20 }]);
  assert.match(r.missing.join(), /Ruler/);
  const [m] = mapSetupIssues([{ ...base, default_track_id: null }]);
  assert.match(m.missing.join(), /music/);
  const [k] = mapSetupIssues([{ ...base, world_x: null }]);
  assert.match(k.missing.join(), /kingdom/);
});

test('several gaps on one map are listed together', () => {
  const [r] = mapSetupIssues([{ ...base, scale: 20, default_track_id: null, world_x: null }]);
  assert.equal(r.missing.length, 3);
});

test('templates are skipped entirely', () => {
  assert.equal(mapSetupIssues([{ ...base, scale: 20, default_track_id: null, world_x: null, is_template: 1 }]).length, 0);
});

test('the world map is exempt from the kingdom-location check', () => {
  // no world_x/y, but it IS the kingdom — only ruler/music can flag it
  const issues = mapSetupIssues([{ ...base, is_world: 1, world_x: null, world_y: null }]);
  assert.equal(issues.length, 0, 'ruler and music are set, so nothing to flag');
  const [w] = mapSetupIssues([{ ...base, is_world: 1, world_x: null, default_track_id: null }]);
  assert.ok(!w.missing.join().match(/kingdom/), 'never asks the kingdom map to place itself');
});
