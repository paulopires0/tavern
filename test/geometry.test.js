import test from 'node:test';
import assert from 'node:assert/strict';
import { pointSegDist, segIntersect, segSegDist, strokeSegments, blocksSight, moveBlocked, cliffNormal } from '../shared/geometry.js';
import { visibleCells } from '../server/vision.js';

const P = (x, y) => ({ x, y });

test('pointSegDist basics', () => {
  assert.equal(pointSegDist(P(0, 5), P(-10, 0), P(10, 0)), 5);
  assert.equal(pointSegDist(P(20, 0), P(-10, 0), P(10, 0)), 10, 'beyond the end');
});

test('segIntersect: proper crossings only', () => {
  assert.ok(segIntersect(P(0, -5), P(0, 5), P(-5, 0), P(5, 0)));
  assert.ok(!segIntersect(P(0, 1), P(0, 5), P(-5, 0), P(5, 0)), 'stops short');
  assert.ok(!segIntersect(P(0, 0), P(10, 0), P(0, 5), P(10, 5)), 'parallel');
});

test('segSegDist is zero when crossing, gap otherwise', () => {
  assert.equal(segSegDist(P(0, -5), P(0, 5), P(-5, 0), P(5, 0)), 0);
  assert.equal(segSegDist(P(0, 3), P(10, 3), P(0, 0), P(10, 0)), 3);
});

test('strokeSegments: rect becomes 4 edges, polyline chains', () => {
  const rect = strokeSegments({ tool: 'rect', points: [[0, 0], [10, 6]] });
  assert.equal(rect.length, 4);
  const line = strokeSegments({ tool: 'brush', points: [[0, 0], [5, 0], [5, 5]] });
  assert.equal(line.length, 2);
});

test('walls block sight and movement; width matters', () => {
  const wall = [{ kind: 'wall', tool: 'line', points: [[0, -10], [0, 10]], width: 4, flipped: 0 }];
  assert.ok(blocksSight(wall, P(-5, 0), P(5, 0)), 'looking through the wall');
  assert.ok(!blocksSight(wall, P(-5, 20), P(5, 20)), 'looking past its end');
  assert.deepEqual(moveBlocked(wall, P(-5, 0), P(5, 0)), { blocked: 'wall' });
  assert.equal(moveBlocked(wall, P(-5, 20), P(5, 20)), null);
});

test('sight strokes block vision but not movement', () => {
  const curtain = [{ kind: 'sight', tool: 'line', points: [[0, -10], [0, 10]], width: 4, flipped: 0 }];
  assert.ok(blocksSight(curtain, P(-5, 0), P(5, 0)));
  assert.equal(moveBlocked(curtain, P(-5, 0), P(5, 0)), null);
});

test('cliffs are one-way: crossing with the arrows is fine, against is not', () => {
  const cliff = [{ kind: 'cliff', tool: 'line', points: [[0, -10], [0, 10]], width: 4, flipped: 0 }];
  const n = cliffNormal(P(0, -10), P(0, 10), 0);
  // going along the normal = allowed; against it = blocked
  const withArrows = moveBlocked(cliff, P(-n.x * 5, -n.y * 5), P(n.x * 5, n.y * 5));
  const against = moveBlocked(cliff, P(n.x * 5, n.y * 5), P(-n.x * 5, -n.y * 5));
  assert.equal(withArrows, null, 'jumping down the cliff');
  assert.deepEqual(against, { blocked: 'cliff' }, 'climbing back up');
  // flipping the stroke flips the rule
  const flipped = [{ ...cliff[0], flipped: 1 }];
  assert.deepEqual(moveBlocked(flipped, P(-n.x * 5, -n.y * 5), P(n.x * 5, n.y * 5)), { blocked: 'cliff' });
  assert.equal(moveBlocked(flipped, P(n.x * 5, n.y * 5), P(-n.x * 5, -n.y * 5)), null);
  // walking parallel to the cliff never triggers it
  assert.equal(moveBlocked(cliff, P(5, -20), P(5, 20)), null);
});

test('cliffs block sight one-way too: down is visible, up is not', () => {
  const cliff = [{ kind: 'cliff', tool: 'line', points: [[0, -10], [0, 10]], width: 4, flipped: 0 }];
  const n = cliffNormal(P(0, -10), P(0, 10), 0);
  const top = P(n.x * 5, n.y * 5);      // uphill side (arrows point away from it)
  const bottom = P(-n.x * 5, -n.y * 5);
  assert.ok(!blocksSight(cliff, bottom, top), 'looking down over the edge: fine');
  assert.ok(blocksSight(cliff, top, bottom), 'looking up from below: blocked by the ledge');
});

test('visibleCells: circle radius, walls carve shadows, own cell visible', () => {
  const map = { image_w: 400, image_h: 400, scale: 10, cell_px: 10, cells_x: 40, cells_y: 40 };
  const open = visibleCells(map, [], 200, 200, 5); // 5 m = 50 px radius
  assert.ok(open.has('20,20'), 'own cell');
  assert.ok(open.has('24,20'), '40 px east, inside radius');
  assert.ok(!open.has('26,20'), '65 px east, outside 50 px radius');
  // a wall just east of the viewer shadows the east side
  const wall = [{ kind: 'wall', tool: 'line', points: [[215, 150], [215, 250]], width: 6, flipped: 0 }];
  const shadowed = visibleCells(map, wall, 200, 200, 5);
  assert.ok(!shadowed.has('24,20'), 'east cell behind the wall is hidden');
  assert.ok(shadowed.has('17,20'), 'west side unaffected');
});
