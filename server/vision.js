// Continuous line-of-sight over painted strokes. Pure — unit-testable.
//
// A character at (x, y) currently observes every fog cell whose center lies
// within their vision radius (a CIRCLE, meters) and is not cut off by a
// wall/sight stroke. The viewer's own cell is always visible.
import { blocksSight } from '../shared/geometry.js';
import { cellKey, cellOf, cellCenter } from './grid.js';

export function visibleCells(map, strokes, x, y, radiusMeters) {
  const out = new Set();
  if (x == null || y == null) return out;
  const radiusPx = radiusMeters * (map.scale || 20);
  const from = { x, y };
  const [minCx, minCy] = cellOf(map, Math.max(0, x - radiusPx), Math.max(0, y - radiusPx));
  const [maxCx, maxCy] = cellOf(map,
    Math.min(map.image_w - 1, x + radiusPx), Math.min(map.image_h - 1, y + radiusPx));
  const [ownCx, ownCy] = cellOf(map, x, y);
  for (let cx = Math.max(0, minCx); cx <= Math.min(map.cells_x - 1, maxCx); cx++) {
    for (let cy = Math.max(0, minCy); cy <= Math.min(map.cells_y - 1, maxCy); cy++) {
      const c = cellCenter(map, cx, cy);
      if (Math.hypot(c.x - x, c.y - y) > radiusPx) continue;
      if ((cx !== ownCx || cy !== ownCy) && blocksSight(strokes, from, c)) continue;
      out.add(cellKey(cx, cy));
    }
  }
  out.add(cellKey(ownCx, ownCy));
  return out;
}
