import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph, edgeKey, edgePath, GRAPH } from '../client/src/dm/mapGraphLayout.js';

const M = (id, name, extra = {}) => ({ id, name, is_template: 0, is_world: 0, ...extra });
const E = (a, b) => ({ a, b });

test('an empty set lays out without blowing up', () => {
  const { nodes, view } = layoutGraph([], []);
  assert.equal(nodes.length, 0);
  assert.ok(view.w > 0 && view.h > 0);
});

test('depth is doors-from-the-trunk, and deeper maps sit further right', () => {
  // 1-2-3-4 chain plus a spur, so the trunk is not simply the first map
  const maps = [M(1, 'Town'), M(2, 'Inn'), M(3, 'Cellar'), M(4, 'Vault'), M(5, 'Attic')];
  const edges = [E(1, 2), E(2, 3), E(3, 4), E(2, 5)];
  const { nodes } = layoutGraph(maps, edges);

  // walk the door network from whichever map was chosen as the trunk
  const adj = new Map(maps.map((m) => [m.id, []]));
  for (const e of edges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
  const root = nodes.find((n) => n.depth === 0);
  const dist = new Map([[root.id, 0]]);
  for (const q = [root.id]; q.length;) {
    const cur = q.shift();
    for (const nb of adj.get(cur)) {
      if (dist.has(nb)) continue;
      dist.set(nb, dist.get(cur) + 1);
      q.push(nb);
    }
  }
  for (const n of nodes) assert.equal(n.depth, dist.get(n.id), `${n.name} sits at its door distance`);
  for (const a of nodes) {
    for (const b of nodes) if (a.depth < b.depth) assert.ok(a.x < b.x, 'columns march right');
  }
});

test('a parent sits centred on its children, which never share a row', () => {
  const maps = [M(1, 'Hub'), M(2, 'A'), M(3, 'B')];
  const { nodes } = layoutGraph(maps, [E(1, 2), E(1, 3)]);
  const at = (id) => nodes.find((n) => n.id === id);
  assert.notEqual(at(2).y, at(3).y, 'siblings get their own rows');
  assert.equal(at(1).y, (at(2).y + at(3).y) / 2, 'parent is centred between them');
});

test('the busiest map becomes the trunk', () => {
  // 2 is the hub (3 doors); it should be the root even though 1 has a lower id
  const maps = [M(1, 'Edge'), M(2, 'Hub'), M(3, 'A'), M(4, 'B')];
  const { nodes } = layoutGraph(maps, [E(1, 2), E(2, 3), E(2, 4)]);
  assert.equal(nodes.find((n) => n.id === 2).depth, 0, 'hub is the root');
});

test('the kingdom map is preferred as the trunk when present', () => {
  const maps = [M(1, 'Busy'), M(2, 'Kingdom', { is_world: 1 }), M(3, 'A'), M(4, 'B')];
  const { nodes } = layoutGraph(maps, [E(1, 3), E(1, 4), E(1, 2)]);
  assert.equal(nodes.find((n) => n.id === 2).depth, 0);
});

test('labels never collide with the next column', () => {
  const maps = [M(1, 'A very long map name indeed'), M(2, 'B')];
  const { nodes } = layoutGraph(maps, [E(1, 2)]);
  const [a, b] = [nodes[0], nodes[1]].sort((x, y) => x.depth - y.depth);
  const labelEnds = a.x + a.r + GRAPH.LABEL_PAD + a.labelW;
  assert.ok(b.x - b.r >= labelEnds, 'the child starts after the parent label ends');
});

test('separate door networks stack instead of overlapping', () => {
  const maps = [M(1, 'A'), M(2, 'B'), M(3, 'Island')];
  const { nodes } = layoutGraph(maps, [E(1, 2)]);
  const ys = nodes.map((n) => n.y);
  assert.equal(new Set(ys).size >= 2, true);
  const island = nodes.find((n) => n.id === 3);
  assert.equal(island.depth, 0, 'a doorless map is its own root');
  assert.equal(island.lonely, true, 'and is flagged as unconnected');
});

test('a loop-closing door is left out of the tree but still drawn', () => {
  //triangle: one of the three edges cannot be a tree edge
  const maps = [M(1, 'A'), M(2, 'B'), M(3, 'C')];
  const { treeEdges, nodes } = layoutGraph(maps, [E(1, 2), E(2, 3), E(1, 3)]);
  assert.equal(treeEdges.size, 2, 'a 3-node tree has exactly 2 branches');
  const extra = [[1, 2], [2, 3], [1, 3]].filter(([a, b]) => !treeEdges.has(edgeKey(a, b)));
  assert.equal(extra.length, 1, 'the third door is the shortcut');
  // it still produces a drawable path
  const [a, b] = extra[0].map((id) => nodes.find((n) => n.id === id));
  assert.match(edgePath(a, b), /^M[\d.-]+,[\d.-]+ C/);
});

test('every node lands somewhere finite and inside the view', () => {
  const maps = [M(1, 'A'), M(2, 'B'), M(3, 'C'), M(4, 'D')];
  const { nodes, view } = layoutGraph(maps, [E(1, 2), E(1, 3), E(3, 4)]);
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.name} is placed`);
    assert.ok(n.x - n.r >= view.x && n.y >= view.y, `${n.name} is inside the view`);
    assert.ok(n.y <= view.y + view.h, `${n.name} is inside the view`);
  }
});
