// Walkable-space search on the fog cell lattice (FOG_CELL_METERS per cell):
// findPath computes the route a token WALKS for the TV animation — straight
// if clear, around walls when possible, null when truly cut off (teleport).
// Edges honour moveBlocked, so walls block both ways and cliffs one-way.
import { moveBlocked } from '../shared/geometry.js';
import { cellKey, cellCenter } from './grid.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];
const MAX_EXPLORED = 25000; // safety bound: give up (teleport) on absurd searches

const inBounds = (map, cx, cy) => cx >= 0 && cy >= 0 && cx < map.cells_x && cy < map.cells_y;

function edgeOpen(map, strokes, ax, ay, bx, by) {
  return !moveBlocked(strokes, cellCenter(map, ax, ay), cellCenter(map, bx, by));
}

// Greedy string-pulling: drop intermediate waypoints while the direct segment
// stays clear, so cell paths become natural-looking walks.
function simplify(strokes, pts) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && moveBlocked(strokes, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// A* from -> to (image px). Returns [[x,y],...] including both ends, or null.
export function findPath(map, strokes, from, to) {
  if (!moveBlocked(strokes, from, to)) return [[from.x, from.y], [to.x, to.y]];
  const start = [Math.floor(from.x / map.cell_px), Math.floor(from.y / map.cell_px)];
  const goal = [Math.floor(to.x / map.cell_px), Math.floor(to.y / map.cell_px)];
  if (!inBounds(map, ...start) || !inBounds(map, ...goal)) return null;

  const h = (cx, cy) => Math.hypot(cx - goal[0], cy - goal[1]);
  const open = [[h(...start), 0, start[0], start[1]]];
  const gScore = new Map([[cellKey(...start), 0]]);
  const cameFrom = new Map();
  let explored = 0;

  while (open.length) {
    let mi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
    const [, g, cx, cy] = open.splice(mi, 1)[0];
    if (g > (gScore.get(cellKey(cx, cy)) ?? Infinity)) continue;
    if (cx === goal[0] && cy === goal[1]) {
      const cells = [[cx, cy]];
      let k = cellKey(cx, cy);
      while (cameFrom.has(k)) {
        const [px, py] = cameFrom.get(k);
        cells.push([px, py]);
        k = cellKey(px, py);
      }
      cells.reverse();
      const pts = [{ x: from.x, y: from.y },
        ...cells.slice(1, -1).map(([a, b]) => cellCenter(map, a, b)),
        { x: to.x, y: to.y }];
      return simplify(strokes, pts).map((p) => [Math.round(p.x), Math.round(p.y)]);
    }
    if (++explored > MAX_EXPLORED) return null;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(map, nx, ny)) continue;
      if (!edgeOpen(map, strokes, cx, cy, nx, ny)) continue;
      const ng = g + cost;
      const nk = cellKey(nx, ny);
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        cameFrom.set(nk, [cx, cy]);
        open.push([ng + h(nx, ny), ng, nx, ny]);
      }
    }
  }
  return null;
}
