// The eraser, shared by the map editor's physics strokes and the DM's ink.
//
// Rubbing does NOT delete whole strokes — it erases only the parts the eraser
// actually passed over, the way a real rubber does. A stroke is resampled into
// fine points, the covered ones are dropped, and each surviving run becomes a
// stroke of its own (rub a hole in a rectangle and you keep the remaining
// three-and-a-bit sides).
import { pointSegDist } from './geometry.js';

// `strokes` are {id, tool, points:[[x,y]…], width}. Returns one entry per
// stroke the eraser TOUCHED: {id, runs}. An empty `runs` means it is gone
// entirely. Untouched strokes are absent, so callers rewrite only what changed.
export function rubStrokes(strokes, eraserPoints, radius) {
  const eraser = eraserPoints.map(([x, y]) => ({ x: Number(x), y: Number(y) }));
  if (!eraser.length) return [];
  // a single tap still erases: treat it as a zero-length segment
  const segs = eraser.length === 1
    ? [[eraser[0], eraser[0]]]
    : eraser.slice(1).map((p, i) => [eraser[i], p]);

  const out = [];
  for (const stroke of strokes) {
    let pts = stroke.points.map(([x, y]) => ({ x, y }));
    if (!pts.length) continue;
    if (stroke.tool === 'rect' && pts.length >= 2) { // rects erase as their outline
      const [a, c] = [pts[0], pts[pts.length - 1]];
      pts = [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }, a];
    }
    const cut = radius + stroke.width / 2;
    const step = Math.max(4, stroke.width / 2);
    const fine = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let j = 1; j <= n; j++) fine.push({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n });
    }
    const hit = (p) => segs.some(([a, b]) => pointSegDist(p, a, b) < cut);
    const runs = [];
    let cur = [];
    let touched = false;
    for (const p of fine) {
      if (hit(p)) { touched = true; if (cur.length > 1) runs.push(cur); cur = []; }
      else cur.push(p);
    }
    if (cur.length > 1) runs.push(cur);
    if (!touched) continue;
    out.push({
      id: stroke.id,
      runs: runs.map((run) => run.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])),
    });
  }
  return out;
}
