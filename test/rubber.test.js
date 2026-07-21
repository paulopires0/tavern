// The eraser rubs out the parts it passes over — it does not delete strokes
// wholesale. Shared by the editor's physics strokes and the DM's ink.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rubStrokes } from '../shared/rubber.js';

const line = { id: 1, tool: 'brush', width: 4, points: [[0, 0], [100, 0]] };

test('a stroke the rubber never touches is left alone', () => {
  assert.deepEqual(rubStrokes([line], [[50, 500]], 10), [],
    'nothing reported means nothing to rewrite');
});

test('rubbing the middle of a line leaves the two ends', () => {
  const [hit] = rubStrokes([line], [[50, 0]], 10);
  assert.equal(hit.id, 1);
  assert.equal(hit.runs.length, 2, 'a gap in the middle makes two strokes');
  assert.ok(hit.runs[0][0][0] < 45, 'the left piece starts at the start');
  assert.ok(hit.runs[1][hit.runs[1].length - 1][0] > 55, 'the right piece runs to the end');
});

test('rubbing along the whole stroke erases it', () => {
  const [hit] = rubStrokes([line], [[0, 0], [100, 0]], 20);
  assert.deepEqual(hit.runs, [], 'no survivors: the stroke is gone');
});

test('a rectangle rubbed on one side keeps the rest of its outline', () => {
  const rect = { id: 7, tool: 'rect', width: 3, points: [[0, 0], [100, 100]] };
  const [hit] = rubStrokes([rect], [[50, 0]], 12);
  assert.ok(hit.runs.length >= 1, 'the other three sides survive');
  const kept = hit.runs.flat();
  assert.ok(kept.some(([, y]) => y > 90), 'the far side is still there');
  assert.ok(!kept.some(([x, y]) => Math.abs(y) < 1 && Math.abs(x - 50) < 8),
    'the rubbed spot is gone');
});

test('a fat stroke is easier to graze than a thin one', () => {
  // eraser at x=40 (a resample point of both) offset 15px off the centreline
  const thin = { id: 1, tool: 'brush', width: 4, points: [[0, 0], [100, 0]] };
  const fat = { id: 2, tool: 'brush', width: 40, points: [[0, 0], [100, 0]] };
  assert.equal(rubStrokes([thin], [[40, 15]], 4).length, 0, 'the thin line is out of reach');
  assert.equal(rubStrokes([fat], [[40, 15]], 4).length, 1, 'the fat one is caught: cut grows with width');
});

test('an empty rub does nothing', () => {
  assert.deepEqual(rubStrokes([line], [], 10), []);
});
