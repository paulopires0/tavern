// Axial-coordinate hex math for pointy-top hexes.
// Used by both server (vision, movement) and client (rendering, hit-testing).
// Grid layout: a rectangle of `cols` x `rows` hexes ("odd-r" style rectangle
// expressed in axial coords). Pixel placement is controlled per map by
// hex_size (center-to-corner radius, px of the background image) and
// offset_x/offset_y (pixel position of the center of hex q=0,r=0).

export const key = (q, r) => `${q},${r}`;
export const parseKey = (k) => k.split(',').map(Number);

export const DIRECTIONS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function neighbors(q, r) {
  return DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

export function distance(q1, r1, q2, r2) {
  // axial -> cube, then cube distance
  const s1 = -q1 - r1, s2 = -q2 - r2;
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2));
}

// All axial coords within `radius` of center (including center).
export function range(q, r, radius) {
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) out.push([q + dq, r + dr]);
  }
  return out;
}

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx + 0, rz + 0]; // axial (q=x, r=z); +0 normalizes -0
}

// Straight hex line from a to b, inclusive. Standard cube-lerp sampling with
// a tiny epsilon nudge so ties break consistently.
export function line(q1, r1, q2, r2) {
  const n = distance(q1, r1, q2, r2);
  if (n === 0) return [[q1, r1]];
  const x1 = q1, z1 = r1, y1 = -q1 - r1;
  const x2 = q2, z2 = r2, y2 = -q2 - r2;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(cubeRound(
      x1 + (x2 - x1) * t + 1e-6,
      y1 + (y2 - y1) * t + 2e-6,
      z1 + (z2 - z1) * t - 3e-6,
    ));
  }
  return out;
}

// --- pixel conversion (pointy-top) ---
export function hexToPixel(map, q, r) {
  const s = map.hex_size;
  return {
    x: s * Math.sqrt(3) * (q + r / 2) + map.offset_x,
    y: s * 1.5 * r + map.offset_y,
  };
}

export function pixelToHex(map, x, y) {
  const s = map.hex_size;
  const px = x - map.offset_x, py = y - map.offset_y;
  const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / s;
  const r = (2 / 3 * py) / s;
  return cubeRound(q, -q - r, r);
}

export function corners(map, q, r) {
  const { x, y } = hexToPixel(map, q, r);
  const s = map.hex_size;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30); // pointy-top
    pts.push([x + s * Math.cos(angle), y + s * Math.sin(angle)]);
  }
  return pts;
}

export function cornersString(map, q, r) {
  return corners(map, q, r).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

// Axial coords of every hex in the map's cols x rows rectangle.
// Row r spans q = -floor(r/2) .. -floor(r/2) + cols - 1 (keeps the rectangle
// visually straight for pointy-top hexes).
export function rectHexes(cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const q0 = 0 - Math.floor(r / 2); // 0- avoids -0 at r<2
    for (let q = q0; q < q0 + cols; q++) out.push([q, r]);
  }
  return out;
}

export function inRect(cols, rows, q, r) {
  if (r < 0 || r >= rows) return false;
  const q0 = -Math.floor(r / 2);
  return q >= q0 && q < q0 + cols;
}
