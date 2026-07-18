// Continuous-map geometry: painted strokes are the world's physics.
// A stroke is {kind: 'wall'|'sight'|'cliff', tool: 'brush'|'line'|'rect',
// points: [[x,y],...], width: px, flipped: 0|1}.
//   wall   — blocks movement and sight
//   sight  — blocks sight only (curtains, smoke)
//   cliff  — one-way movement barrier: crossing is allowed only along the
//            stroke's arrow side (flip switches it); sight passes freely
// All math is plain segment geometry — no grid anywhere.

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);

export function pointSegDist(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}

// Proper segment intersection (returns true when p1p2 crosses p3p4).
export function segIntersect(p1, p2, p3, p4) {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Minimum distance between two segments.
export function segSegDist(p1, p2, p3, p4) {
  if (segIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(
    pointSegDist(p1, p3, p4), pointSegDist(p2, p3, p4),
    pointSegDist(p3, p1, p2), pointSegDist(p4, p1, p2),
  );
}

// Flatten a stroke into line segments [[a, b], ...].
export function strokeSegments(stroke) {
  const pts = stroke.points.map(([x, y]) => ({ x, y }));
  if (stroke.tool === 'rect' && pts.length >= 2) {
    const [a, c] = [pts[0], pts[pts.length - 1]];
    const b = { x: c.x, y: a.y };
    const d = { x: a.x, y: c.y };
    return [[a, b], [b, c], [c, d], [d, a]];
  }
  if (pts.length === 1) return [[pts[0], pts[0]]];
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  return segs;
}

// Does the segment from->to pass through any sight-stopping stroke?
// Cliffs block sight ONE-WAY, like movement: looking down the cliff (with the
// arrows) is fine; looking up it from below is blocked by the ledge.
export function blocksSight(strokes, from, to) {
  const dir = sub(to, from);
  for (const s of strokes) {
    const half = s.width / 2;
    if (s.kind === 'wall' || s.kind === 'sight') {
      for (const [a, b] of strokeSegments(s)) {
        if (segSegDist(from, to, a, b) < half) return true;
      }
    } else if (s.kind === 'cliff') {
      for (const [a, b] of strokeSegments(s)) {
        if (segIntersect(from, to, a, b) &&
            dot(dir, cliffNormal(a, b, s.flipped)) <= 0) return true;
      }
    }
  }
  return false;
}

// The allowed crossing direction of a cliff segment: the unit normal that its
// arrows point toward. flipped mirrors it.
export function cliffNormal(a, b, flipped) {
  const d = sub(b, a);
  const l = len(d) || 1;
  const n = flipped ? { x: -d.y / l, y: d.x / l } : { x: d.y / l, y: -d.x / l };
  return n;
}

// Movement check. Returns null when the move is fine, otherwise
// {blocked: 'wall' | 'cliff'}.
export function moveBlocked(strokes, from, to) {
  const move = sub(to, from);
  for (const s of strokes) {
    const half = s.width / 2;
    for (const [a, b] of strokeSegments(s)) {
      if (s.kind === 'wall') {
        if (segSegDist(from, to, a, b) < half) return { blocked: 'wall' };
      } else if (s.kind === 'cliff') {
        if (segIntersect(from, to, a, b)) {
          // crossing must go WITH the arrows (down the cliff, not up it)
          if (dot(move, cliffNormal(a, b, s.flipped)) <= 0) return { blocked: 'cliff' };
        }
      }
    }
  }
  return null;
}
