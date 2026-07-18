// Fog-of-war bookkeeping on top of vision.js (continuous map, cell lattice).
//
// Per character:
//   * "observing"  — computed live from position + vision, never stored
//   * "seen"       — persistent fog_seen rows (cell coords): ever observed
// Cell states: 0 = Unknown, 1 = Previously seen (memory), 2 = Observing.
// A cell never drops back to Unknown once seen.
//
// Party aggregation (TV): state = 2 if ANY character on the map currently
// observes the cell, else 1 if ANY has ever seen it, else 0 — then the map's
// reversible overrides apply: reveal_vision forces 2, reveal_map floors at 1.
import { db, parseChar, strokesOf } from './db.js';
import { getGridMap, cellKey } from './grid.js';
import { WORLD_REVEAL_METERS } from '../shared/gameRules.js';
import { visibleCells } from './vision.js';
import { pointSegDist } from '../shared/geometry.js';

export function charactersOnMap(mapId) {
  return db.prepare('SELECT * FROM characters WHERE map_id = ?').all(mapId).map(parseChar);
}

// The map's visibility (luminosity) scales every character's vision radius:
// 1 = clear daylight, 0.3 = a dark night, 2 = a watchtower's view.
export function visibleFor(character, map = null, strokes = null) {
  if (!character?.map_id) return new Set();
  map ??= getGridMap(character.map_id);
  strokes ??= strokesOf(character.map_id);
  return visibleCells(map, strokes, character.x, character.y,
    character.vision_radius * (map.visibility ?? 1));
}

const insertSeen = db.prepare(
  'INSERT OR IGNORE INTO fog_seen (character_id, map_id, q, r) VALUES (?,?,?,?)'
);
const persistSeenTx = db.transaction((characterId, mapId, keys) => {
  for (const k of keys) {
    const [cx, cy] = k.split(',').map(Number);
    insertSeen.run(characterId, mapId, cx, cy);
  }
});

// Call whenever a character's position or the map's strokes change:
// persists newly seen cells and flags newly observed chests as discovered.
export function refreshFogFor(character) {
  if (!character?.map_id) return new Set();
  const map = getGridMap(character.map_id);
  const visible = visibleFor(character, map);
  persistSeenTx(character.id, character.map_id, [...visible]);
  const chests = db.prepare('SELECT * FROM chests WHERE map_id = ? AND discovered = 0')
    .all(character.map_id);
  for (const chest of chests) {
    const ck = cellKey(Math.floor(chest.x / map.cell_px), Math.floor(chest.y / map.cell_px));
    if (visible.has(ck)) {
      db.prepare('UPDATE chests SET discovered = 1 WHERE id = ?').run(chest.id);
    }
  }
  return visible;
}

export function refreshFogForMap(mapId) {
  for (const c of charactersOnMap(mapId)) refreshFogFor(c);
}

// A character who WALKS somewhere sees the whole way, not just the arrival
// point: sample the walked path every few meters and persist everything
// visible from each sample. (Teleports skip this — nothing was walked.)
export function revealAlongPath(character, map, path) {
  if (!character || !path || path.length < 2) return;
  const strokes = strokesOf(map.id);
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  if (total < 1) return;
  const stepPx = Math.max(3 * map.scale, total / 40); // ~every 3 m, capped samples
  const seen = new Set();
  let carry = 0; // distance into the segment where the next sample falls
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (!segLen) continue;
    let d = carry;
    for (; d < segLen; d += stepPx) {
      const t = d / segLen;
      const cells = visibleCells(map, strokes, ax + (bx - ax) * t, ay + (by - ay) * t,
        character.vision_radius * (map.visibility ?? 1));
      for (const k of cells) seen.add(k);
    }
    carry = d - segLen;
  }
  persistSeenTx(character.id, map.id, [...seen]);
}

export function seenKeysFor(characterId, mapId) {
  const rows = db.prepare('SELECT q, r FROM fog_seen WHERE character_id = ? AND map_id = ?')
    .all(characterId, mapId);
  return new Set(rows.map((row) => cellKey(row.q, row.r)));
}

// Aggregated party fog for one map: { observing: Set, seen: Set } (before the
// reveal overrides — those are applied where states are read).
export function partyFog(mapId) {
  const map = getGridMap(mapId);
  // Nobody ever STANDS on the world map — its reveals come from every
  // character's travel history, not from anyone's position.
  if (map?.is_world) {
    const seen = new Set(
      db.prepare('SELECT DISTINCT q, r FROM fog_seen WHERE map_id = ?').all(mapId)
        .map((row) => cellKey(row.q, row.r)),
    );
    return { observing: new Set(), seen };
  }
  const strokes = strokesOf(mapId);
  const observing = new Set();
  const seen = new Set();
  for (const c of charactersOnMap(mapId)) {
    for (const k of visibleFor(c, map, strokes)) observing.add(k);
    for (const k of seenKeysFor(c.id, mapId)) seen.add(k);
  }
  return { observing, seen };
}

export function fogStateOf(fog, map, cx, cy) {
  if (map.reveal_vision) return 2;
  const k = cellKey(cx, cy);
  // The world map has no memory-dimming: uncovered ground stays fully visible.
  if (map.is_world) return (map.reveal_map || fog.seen.has(k)) ? 2 : 0;
  if (fog.observing.has(k)) return 2;
  if (map.reveal_map || fog.seen.has(k)) return 1;
  return 0;
}

export function worldMap() {
  const worldRow = db.prepare('SELECT * FROM maps WHERE is_world = 1').get();
  return worldRow ? getGridMap(worldRow.id) : null;
}

// The kingdom cells within rPx of a polyline `points` (world-map px). A single
// point reveals a circle; a multi-point path reveals a corridor.
function worldCellsNear(world, points, rPx) {
  if (!points.length) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minCx = Math.max(0, Math.floor((Math.min(...xs) - rPx) / world.cell_px));
  const maxCx = Math.min(world.cells_x - 1, Math.floor((Math.max(...xs) + rPx) / world.cell_px));
  const minCy = Math.max(0, Math.floor((Math.min(...ys) - rPx) / world.cell_px));
  const maxCy = Math.min(world.cells_y - 1, Math.floor((Math.max(...ys) + rPx) / world.cell_px));
  const segs = points.length === 1
    ? [[{ x: points[0][0], y: points[0][1] }, { x: points[0][0], y: points[0][1] }]]
    : points.slice(1).map((p, i) => [{ x: points[i][0], y: points[i][1] }, { x: p[0], y: p[1] }]);
  const keys = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const c = { x: (cx + 0.5) * world.cell_px, y: (cy + 0.5) * world.cell_px };
      if (segs.some(([a, b]) => pointSegDist(c, a, b) <= rPx)) keys.push(cellKey(cx, cy));
    }
  }
  return keys;
}

// Entering a located map permanently uncovers the kingdom around its marker AND
// the corridor travelled from wherever the character just came (so far trips
// fill in the route). Reveal size scales with the destination's light and the
// kingdom's own visibility — dial those up if the circles feel too small.
export function revealWorldFor(characterId, enteredMap, fromMap = null) {
  if (enteredMap.world_x == null || enteredMap.is_world) return;
  const world = worldMap();
  if (!world) return;
  const rPx = WORLD_REVEAL_METERS * (enteredMap.visibility ?? 1) * (world.visibility ?? 1) * world.scale;
  const points = [[enteredMap.world_x, enteredMap.world_y]];
  if (fromMap && fromMap.world_x != null && !fromMap.is_world
      && (fromMap.world_x !== enteredMap.world_x || fromMap.world_y !== enteredMap.world_y)) {
    points.unshift([fromMap.world_x, fromMap.world_y]);
  }
  persistSeenTx(characterId, world.id, worldCellsNear(world, points, rPx));
}

// Party-wide reveal along a DM-drawn kingdom path ("simulate travel").
export function revealWorldPath(path, radiusMeters = WORLD_REVEAL_METERS) {
  const world = worldMap();
  if (!world || !Array.isArray(path) || !path.length) return;
  const rPx = radiusMeters * (world.visibility ?? 1) * world.scale;
  const keys = worldCellsNear(world, path, rPx);
  for (const c of db.prepare('SELECT id FROM characters').all()) {
    persistSeenTx(c.id, world.id, keys);
  }
}
