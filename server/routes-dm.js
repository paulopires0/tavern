// Every DM mutation. All handlers finish with ok(res, ...) which broadcasts
// fresh state to every connected client — that single convention is the whole
// realtime-sync story.
import express, { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, getConfig, setConfig, parseChar, parseItem, inventoryOf, addToInventory, removeFromInventory, carriedWeight, strokesOf, getMap } from './db.js';
import { getGridMap } from './grid.js';
import { requireDM } from './auth.js';
import { refreshFogFor, refreshFogForMap, revealAlongPath } from './fog.js';
import { pushAll, getIO } from './state.js';
import { retargetTVs } from './sockets.js';
import { UPLOADS_DIR, UPLOAD_KINDS } from './config.js';
import { defaultUrl } from './defaults.js';
import { parseYoutubeId } from './youtube.js';
import { pointSegDist } from '../shared/geometry.js';
import { setMoveFlag } from './moveFlags.js';
import { findPath } from './pathfind.js';
import { revealWorldFor, revealWorldPath, worldMap } from './fog.js';
import { logInventory } from './activity.js';
import { weaponGen, armorGen, validateGen } from './generation.js';
import {
  defaultCapacity, shopBuyPrice,
  SHOP_DISAPPEAR_CHANCE, RARITY_WEIGHTS, rarityOf, VISION_METERS_DEFAULT,
  ITEM_CATEGORIES, MEASURES, SELLER_TYPES, TRIGGER_RADIUS_METERS, DOOR_TRIGGER_METERS, WEATHERS,
  rollWeapon, rollArmor, pickByRank,
  TOKEN_METERS, TOKEN_MIN_PX, TOKEN_MAX_FRACTION,
} from '../shared/gameRules.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const dmRouter = Router();
dmRouter.use(requireDM);

function ok(res, extra = {}) {
  pushAll();
  res.json({ ok: true, ...extra });
}

function bad(res, msg) {
  res.status(400).json({ error: msg });
}

// ---------------------------------------------------------------------------
// Uploads: raw body, filename via query. Returns the public /uploads path.
// ---------------------------------------------------------------------------
const KIND_SET = new Set(UPLOAD_KINDS);
dmRouter.put('/upload', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const kind = String(req.query.kind || '');
  if (!KIND_SET.has(kind)) return bad(res, 'bad upload kind');
  if (!req.body?.length) return bad(res, 'empty upload');
  const original = path.basename(String(req.query.name || 'file'));
  const safe = original.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${Date.now()}-${safe}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, kind, filename), req.body);
  res.json({ path: `/uploads/${kind}/${filename}` });
});

// ---------------------------------------------------------------------------
// Config / settings
// ---------------------------------------------------------------------------
dmRouter.post('/config', (req, res) => {
  const b = req.body || {};
  if (Array.isArray(b.statBlock)) {
    const clean = b.statBlock
      .filter((s) => s && s.key && s.label)
      .map((s) => ({ key: String(s.key), label: String(s.label) }));
    if (!clean.length) return bad(res, 'stat block cannot be empty');
    setConfig('stat_block', clean);
  }
  // A DM password set here overrides the env one; blank clears it (back to env).
  if ('dmPassword' in b) {
    const pw = String(b.dmPassword || '').trim();
    setConfig('dm_password', pw || null);
  }
  if ('visionDefault' in b) {
    setConfig('vision_default', Math.max(1, Math.round(Number(b.visionDefault) || 0)) || VISION_METERS_DEFAULT);
  }
  // Weapon / armor generation params (profiles + formula constants). Blank/null
  // clears the override, returning to the built-in defaults.
  if ('weaponGen' in b) {
    if (b.weaponGen == null) setConfig('weapon_gen', null);
    else {
      const err = validateGen(b.weaponGen, 'weapon');
      if (err) return bad(res, `weapon generation: ${err}`);
      setConfig('weapon_gen', b.weaponGen);
    }
  }
  if ('armorGen' in b) {
    if (b.armorGen == null) setConfig('armor_gen', null);
    else {
      const err = validateGen(b.armorGen, 'armor');
      if (err) return bad(res, `armor generation: ${err}`);
      setConfig('armor_gen', b.armorGen);
    }
  }
  ok(res);
});

// A fresh spectator (TV) link — the old one stops working and any TV currently
// connected on it is dropped (use if the link leaked).
dmRouter.post('/regenerate-tv-link', (_req, res) => {
  setConfig('spectator_key', crypto.randomBytes(8).toString('hex'));
  const io = getIO();
  if (io) for (const [, s] of io.sockets.sockets) if (s.data?.viewer?.role === 'tv') s.disconnect(true);
  ok(res, { spectatorKey: getConfig('spectator_key') });
});

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
const CHAR_FIELDS = ['name', 'password', 'hp', 'max_hp', 'armor', 'level', 'gold',
  'carry_capacity', 'vision_radius',
  'token_color', 'token_scale', 'token_shape', 'portrait', 'token'];

dmRouter.post('/characters', (req, res) => {
  const { name } = req.body || {};
  if (!name) return bad(res, 'name required');
  const statBlock = getConfig('stat_block');
  const stats = Object.fromEntries(statBlock.map((s) => [s.key, 10]));
  try {
    const info = db.prepare(`
      INSERT INTO characters (name, password, stats, carry_capacity, vision_radius)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, req.body.password || '1234', JSON.stringify(stats),
      defaultCapacity(10), getConfig('vision_default', VISION_METERS_DEFAULT));
    ok(res, { id: info.lastInsertRowid });
  } catch {
    bad(res, 'character name already taken');
  }
});

dmRouter.patch('/characters/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!row) return bad(res, 'no such character');
  const body = req.body || {};
  const sets = [];
  const vals = [];
  for (const f of CHAR_FIELDS) {
    if (f in body) { sets.push(`${f} = ?`); vals.push(body[f]); }
  }
  if (body.stats && typeof body.stats === 'object') {
    sets.push('stats = ?'); vals.push(JSON.stringify(body.stats));
  }
  if (sets.length) {
    db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  // Vision changes alter what the character currently observes.
  if ('vision_radius' in body) {
    refreshFogFor(parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(id)));
  }
  ok(res);
});

dmRouter.delete('/characters/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM inventory_entries WHERE owner_type = 'character' AND owner_id = ?").run(id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  if (getConfig('shop_session', null)?.characterId === id) setConfig('shop_session', null);
  if (getConfig('chest_session', null)?.characterId === id) setConfig('chest_session', null);
  ok(res);
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
function itemFields(b, row = {}) {
  return [
    b.name ?? row.name,
    b.description ?? row.description ?? '',
    ITEM_CATEGORIES.includes(b.category) ? b.category : (row.category ?? 'item'),
    MEASURES.includes(b.measure) ? b.measure : (row.measure ?? 'unit'),
    b.weight ?? row.weight ?? 0,
    b.value ?? row.value ?? 0,
    'damage' in b ? b.damage : (row.damage ?? null),
    'range' in b ? b.range : (row.range ?? null),
    'armor' in b ? b.armor : (row.armor ?? null),
    'lore_text' in b ? b.lore_text : (row.lore_text ?? null),
    'image' in b ? b.image : (row.image ?? null),
    JSON.stringify(b.tags ?? row.tags ?? []),
  ];
}

dmRouter.post('/items', (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'name required');
  const info = db.prepare(`INSERT INTO items
    (name, description, category, measure, weight, value, damage, range, armor, lore_text, image, tags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...itemFields(b));
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/items/:id', (req, res) => {
  const b = req.body || {};
  const row = parseItem(db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id)));
  if (!row) return bad(res, 'no such item');
  db.prepare(`UPDATE items SET name=?, description=?, category=?, measure=?, weight=?, value=?,
    damage=?, range=?, armor=?, lore_text=?, image=?, tags=? WHERE id=?`)
    .run(...itemFields(b, row), row.id);
  ok(res);
});

// Bulk import from items.json (project root) — the file an LLM fills using
// prompts/generate-items.md. Existing names are skipped.
dmRouter.post('/items/import-file', (_req, res) => {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(projectRoot, 'items.json'), 'utf8'));
  } catch (e) {
    return bad(res, `cannot read items.json: ${e.message}`);
  }
  if (!Array.isArray(list)) return bad(res, 'items.json must be a JSON array');
  const existing = new Set(db.prepare('SELECT lower(name) AS n FROM items').all().map((r) => r.n));
  let added = 0, skipped = 0;
  for (const raw of list) {
    if (!raw?.name || existing.has(String(raw.name).toLowerCase())) { skipped++; continue; }
    db.prepare(`INSERT INTO items
      (name, description, category, measure, weight, value, damage, range, armor, lore_text, tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(String(raw.name), raw.description || '',
        ITEM_CATEGORIES.includes(raw.category) ? raw.category : 'item',
        MEASURES.includes(raw.measure) ? raw.measure : 'unit',
        Number(raw.weight) || 0, Math.max(0, Math.round(Number(raw.value) || 0)),
        raw.damage || null, raw.range != null ? Number(raw.range) : null,
        raw.armor != null ? Number(raw.armor) : null, raw.lore_text || null,
        JSON.stringify(Array.isArray(raw.tags) ? raw.tags : []));
    existing.add(String(raw.name).toLowerCase());
    added++;
  }
  ok(res, { added, skipped });
});

// Gear lore import: gear-lore.json (project root) holds [{name, description}]
// written by an LLM (prompts/generate-gear-lore.md). The app keeps rolling the
// weapons and armor; the LLM only dresses them in story. Matches weapons AND
// armor by name (case-insensitive) and overwrites their description.
dmRouter.post('/items/lore-file', (_req, res) => {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(projectRoot, 'gear-lore.json'), 'utf8'));
  } catch (e) {
    return bad(res, `cannot read gear-lore.json: ${e.message}`);
  }
  if (!Array.isArray(list)) return bad(res, 'gear-lore.json must be a JSON array');
  let updated = 0;
  const missing = [];
  for (const raw of list) {
    if (!raw?.name || !raw?.description) continue;
    const info = db.prepare(
      "UPDATE items SET description = ? WHERE category IN ('weapon','armor') AND lower(name) = lower(?)"
    ).run(String(raw.description), String(raw.name));
    if (info.changes) updated += info.changes; else missing.push(String(raw.name));
  }
  ok(res, { updated, missing });
});

dmRouter.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(Number(req.params.id));
  ok(res); // inventory entries cascade via FK
});

// ---------------------------------------------------------------------------
// Inventory (characters, chests, shops share one mechanism)
// ---------------------------------------------------------------------------
dmRouter.post('/inventory/add', (req, res) => {
  const { ownerType, ownerId, itemId, quantity = 1, price = null } = req.body || {};
  if (!['character', 'chest', 'shop'].includes(ownerType)) return bad(res, 'bad ownerType');
  const qty = Number(quantity);
  addToInventory(ownerType, Number(ownerId), Number(itemId), qty, price);
  if (ownerType === 'character') logInventory(ownerId, itemId, qty, 'dm');
  ok(res);
});

dmRouter.post('/inventory/remove', (req, res) => {
  const { entryId, quantity = 1 } = req.body || {};
  const removed = removeFromInventory(Number(entryId), Number(quantity));
  if (removed?.owner_type === 'character') {
    logInventory(removed.owner_id, removed.item_id, -Math.min(Number(quantity), removed.quantity), 'dm');
  }
  ok(res);
});

// Move items between owners (loot chest -> character, stash, restock…).
dmRouter.post('/inventory/transfer', (req, res) => {
  const { entryId, toType, toId, quantity = 1 } = req.body || {};
  const entry = db.prepare('SELECT * FROM inventory_entries WHERE id = ?').get(Number(entryId));
  if (!entry) return bad(res, 'no such entry');
  const qty = Math.min(Number(quantity), entry.quantity);
  removeFromInventory(entry.id, qty);
  addToInventory(toType, Number(toId), entry.item_id, qty);
  if (toType === 'character') logInventory(toId, entry.item_id, qty, 'looted');
  ok(res);
});

// Shop stock entries can have their price edited directly.
dmRouter.post('/inventory/set-price', (req, res) => {
  const { entryId, price } = req.body || {};
  db.prepare('UPDATE inventory_entries SET price = ? WHERE id = ?')
    .run(Math.max(0, Number(price) || 0), Number(entryId));
  ok(res);
});

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------
dmRouter.post('/maps', (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'name required');
  const info = db.prepare(`
    INSERT INTO maps (name, image, image_w, image_h, scale, mobility, token_scale)
    VALUES (?,?,?,?,?,?,?)
  `).run(b.name, b.image || null, b.image_w || 1600, b.image_h || 1000,
    b.scale || 20, b.mobility || 1, b.token_scale || 1);
  if (getConfig('active_map_id', null) === null) {
    setConfig('active_map_id', info.lastInsertRowid);
    retargetTVs(getIO());
  }
  ok(res, { id: info.lastInsertRowid });
});

const MAP_FIELDS = ['name', 'image', 'image_w', 'image_h', 'scale', 'mobility',
  'visibility', 'token_scale', 'icon_scale', 'is_template', 'is_dungeon',
  'reveal_map', 'reveal_vision', 'default_track_id', 'world_x', 'world_y'];
dmRouter.patch('/maps/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = getMap(id);
  if (!row) return bad(res, 'no such map');
  const b = req.body || {};
  // Before the light changes, bank what everyone currently sees — dimming the
  // lamps must not erase the memory of what was in plain view a moment ago.
  if ('visibility' in b && b.visibility !== row.visibility) refreshFogForMap(id);
  const sets = [];
  const vals = [];
  for (const f of MAP_FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]); }
  }
  if (sets.length) db.prepare(`UPDATE maps SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  if ('is_world' in b) {
    // only one kingdom map at a time
    if (b.is_world) db.prepare('UPDATE maps SET is_world = 0 WHERE id != ?').run(id);
    db.prepare('UPDATE maps SET is_world = ? WHERE id = ?').run(b.is_world ? 1 : 0, id);
  }
  // fog cells resize with the ruler; brighter light may uncover new ground
  if ('scale' in b || 'visibility' in b) refreshFogForMap(id);
  ok(res);
});

// ---------------------------------------------------------------------------
// Weather variants: a map's alternate {image, visibility} for a named weather
// (night, snow…). The map's OWN image is its "normal". Variants never mutate
// the base — the look is chosen at render time from the global weather.
// ---------------------------------------------------------------------------
dmRouter.post('/maps/:id/variants', (req, res) => {
  const map = getMap(Number(req.params.id));
  if (!map) return bad(res, 'no such map');
  const name = String(req.body?.name || '').toLowerCase();
  if (!WEATHERS.includes(name) || name === 'normal') {
    return bad(res, `weather must be one of: ${WEATHERS.filter((w) => w !== 'normal').join(', ')}`);
  }
  const b = req.body || {};
  const image = 'image' in b ? b.image : map.image;
  const visibility = b.visibility != null ? Number(b.visibility) : map.visibility;
  // one variant per (map, weather): replace if it already exists
  const existing = db.prepare('SELECT id FROM map_variants WHERE map_id = ? AND lower(name) = ?').get(map.id, name);
  if (existing) {
    db.prepare('UPDATE map_variants SET image = ?, visibility = ? WHERE id = ?').run(image, visibility, existing.id);
    return ok(res, { id: existing.id });
  }
  const info = db.prepare('INSERT INTO map_variants (map_id, name, image, visibility) VALUES (?,?,?,?)')
    .run(map.id, name, image, visibility);
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.delete('/map-variants/:id', (req, res) => {
  db.prepare('DELETE FROM map_variants WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

// Set the campaign-wide weather. Every map re-renders with its matching variant
// (or its normal look if it has none), so the world stays coherent.
dmRouter.post('/weather', (req, res) => {
  const weather = String(req.body?.weather || 'normal').toLowerCase();
  if (!WEATHERS.includes(weather)) return bad(res, `unknown weather "${weather}"`);
  const withParty = db.prepare('SELECT DISTINCT map_id AS id FROM characters WHERE map_id IS NOT NULL').all();
  for (const m of withParty) refreshFogForMap(m.id);  // bank what's in sight under the OLD light
  setConfig('weather', weather);
  for (const m of withParty) refreshFogForMap(m.id);  // …then uncover what the NEW light reveals
  retargetTVs(getIO());
  ok(res);
});

dmRouter.delete('/maps/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM inventory_entries WHERE owner_type = 'chest'
              AND owner_id IN (SELECT id FROM chests WHERE map_id = ?)`).run(id);
  db.prepare('UPDATE characters SET map_id = NULL, x = NULL, y = NULL WHERE map_id = ?').run(id);
  db.prepare('DELETE FROM connections WHERE map_id = ? OR target_map_id = ?').run(id, id);
  db.prepare('DELETE FROM maps WHERE id = ?').run(id);
  if (getConfig('active_map_id', null) === id) {
    setConfig('active_map_id', db.prepare('SELECT id FROM maps ORDER BY id LIMIT 1').get()?.id ?? null);
    retargetTVs(getIO());
  }
  ok(res);
});

// Copy a map (art, scale, painted strokes, chest SPOTS without loot) — the
// template library: mark house/dungeon maps as templates, stamp copies to play.
dmRouter.post('/maps/:id/duplicate', (req, res) => {
  const src = getMap(Number(req.params.id));
  if (!src) return bad(res, 'no such map');
  const b = req.body || {};
  const info = db.prepare(`
    INSERT INTO maps (name, image, image_w, image_h, scale, mobility, visibility, token_scale, icon_scale, is_template)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(b.name || `${src.name} (copy)`, src.image, src.image_w, src.image_h,
    src.scale, src.mobility, src.visibility, src.token_scale, src.icon_scale, b.asTemplate ? 1 : 0);
  const newId = info.lastInsertRowid;
  for (const st of strokesOf(src.id)) {
    db.prepare('INSERT INTO strokes (map_id, kind, tool, points, width, flipped) VALUES (?,?,?,?,?,?)')
      .run(newId, st.kind, st.tool, JSON.stringify(st.points), st.width, st.flipped);
  }
  for (const c of db.prepare('SELECT * FROM chests WHERE map_id = ?').all(src.id)) {
    db.prepare('INSERT INTO chests (map_id, x, y, icon) VALUES (?,?,?,?)').run(newId, c.x, c.y, c.icon);
  }
  ok(res, { id: newId });
});

dmRouter.post('/maps/:id/set-active', (req, res) => {
  const id = Number(req.params.id);
  const map = getMap(id);
  if (!map) return bad(res, 'no such map');
  setConfig('active_map_id', id);
  retargetTVs(getIO());
  // Showing a map on the TV starts its default music, if it has one.
  if (map.default_track_id &&
      db.prepare('SELECT id FROM tracks WHERE id = ?').get(map.default_track_id)) {
    setConfig('music', { trackId: map.default_track_id, playing: true });
  }
  ok(res);
});

// Reversible party-wide fog overrides.
//   reveal { map: true }    -> everyone remembers the whole layout (state >= 1)
//   reveal { vision: true } -> everyone sees everything live (state = 2)
// Turning them off returns to what each character actually observed.
dmRouter.post('/maps/:id/reveal', (req, res) => {
  const id = Number(req.params.id);
  if (!getMap(id)) return bad(res, 'no such map');
  const b = req.body || {};
  if ('map' in b) db.prepare('UPDATE maps SET reveal_map = ? WHERE id = ?').run(b.map ? 1 : 0, id);
  if ('vision' in b) db.prepare('UPDATE maps SET reveal_vision = ? WHERE id = ?').run(b.vision ? 1 : 0, id);
  ok(res);
});

// ---------------------------------------------------------------------------
// Painted physics strokes (wall / sight / cliff)
// ---------------------------------------------------------------------------
dmRouter.post('/strokes', (req, res) => {
  const b = req.body || {};
  if (!getMap(Number(b.mapId))) return bad(res, 'no such map');
  if (!['wall', 'sight', 'cliff'].includes(b.kind)) return bad(res, 'bad stroke kind');
  if (!Array.isArray(b.points) || b.points.length < 1) return bad(res, 'points required');
  const points = b.points.map(([x, y]) => [Number(x), Number(y)]);
  const info = db.prepare(
    'INSERT INTO strokes (map_id, kind, tool, points, width, flipped) VALUES (?,?,?,?,?,?)'
  ).run(Number(b.mapId), b.kind, ['brush', 'line', 'rect'].includes(b.tool) ? b.tool : 'brush',
    JSON.stringify(points), Math.max(1, Number(b.width) || 10), b.flipped ? 1 : 0);
  refreshFogForMap(Number(b.mapId)); // sight blockers may have changed
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/strokes/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM strokes WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such stroke');
  if ('flipped' in (req.body || {})) {
    db.prepare('UPDATE strokes SET flipped = ? WHERE id = ?').run(req.body.flipped ? 1 : 0, row.id);
  }
  ok(res);
});

dmRouter.delete('/strokes/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM strokes WHERE id = ?').get(Number(req.params.id));
  if (row) {
    db.prepare('DELETE FROM strokes WHERE id = ?').run(row.id);
    refreshFogForMap(row.map_id);
  }
  ok(res);
});

dmRouter.delete('/maps/:id/strokes', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM strokes WHERE map_id = ?').run(id);
  refreshFogForMap(id);
  ok(res);
});

// Forget everything the party has ever seen on this map (fresh fog).
dmRouter.post('/maps/:id/reset-fog', (req, res) => {
  const id = Number(req.params.id);
  if (!getMap(id)) return bad(res, 'no such map');
  db.prepare('DELETE FROM fog_seen WHERE map_id = ?').run(id);
  db.prepare('UPDATE chests SET discovered = 0 WHERE map_id = ?').run(id);
  ok(res);
});

// Simulate a journey across the kingdom: the DM draws a path, the party reveals
// it (permanently) and the TV animates a marker walking it. `world_travel` is a
// transient nonce the TV plays once, like a soundboard cue.
dmRouter.post('/world-travel', (req, res) => {
  if (!worldMap()) return bad(res, 'no kingdom map');
  const path = (req.body?.path || [])
    .map((p) => [Number(p[0]), Number(p[1])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (path.length < 1) return bad(res, 'path required');
  const radius = Number(req.body?.radius) > 0 ? Number(req.body.radius) : undefined;
  revealWorldPath(path, radius);
  let lenPx = 0;
  for (let i = 1; i < path.length; i++) {
    lenPx += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  const durationMs = Math.min(11000, Math.max(3000, Math.round(lenPx * 3.6)));
  const nonce = Date.now();
  setConfig('world_travel', { path, nonce, durationMs });
  // the cue is a one-shot: drop it once the walk is over, so re-opening the
  // kingdom map later doesn't replay the trip
  const timer = setTimeout(() => {
    try {
      if (getConfig('world_travel', null)?.nonce === nonce) {
        setConfig('world_travel', null);
        pushAll();
      }
    } catch { /* db closed: nothing to clean up */ }
  }, durationMs + 700);
  timer.unref?.();
  ok(res);
});

// Run a flagged-door journey along the road the DM just drew. The plan comes
// from the move that landed on the door; `path` holds the corners between the
// two towns (empty = a straight road).
dmRouter.post('/world-journey', (req, res) => {
  const b = req.body || {};
  const from = getMap(Number(b.fromMapId));
  const target = getGridMap(Number(b.toMapId));
  if (!from || !target) return bad(res, 'bad map ids');
  const charIds = (b.charIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!charIds.length) return bad(res, 'charIds required');
  const drawn = (b.path || [])
    .map((p) => [Number(p[0]), Number(p[1])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const info = startKingdomTravel(from, target, charIds,
    Number(b.arriveX) || target.image_w / 2, Number(b.arriveY) || target.image_h / 2, drawn);
  if (!info) return bad(res, 'the kingdom map or one of the map markers is missing');
  ok(res, info);
});

// Rubber: erase only the parts of strokes the eraser path touches. Strokes
// are resampled; surviving runs become new strokes (a rectangle you rub a
// hole into becomes the remaining three-and-a-bit sides).
dmRouter.post('/maps/:id/erase', (req, res) => {
  const mapId = Number(req.params.id);
  if (!getMap(mapId)) return bad(res, 'no such map');
  const eraser = (req.body?.points || []).map(([x, y]) => ({ x: Number(x), y: Number(y) }));
  const radius = Math.max(2, Number(req.body?.radius) || 10);
  if (!eraser.length) return bad(res, 'points required');
  const eraserSegs = eraser.length === 1
    ? [[eraser[0], eraser[0]]]
    : eraser.slice(1).map((p, i) => [eraser[i], p]);

  const tx = db.transaction(() => {
    for (const stroke of strokesOf(mapId)) {
      // to polyline (rects become their outline)
      let pts = stroke.points.map(([x, y]) => ({ x, y }));
      if (stroke.tool === 'rect' && pts.length >= 2) {
        const [a, c] = [pts[0], pts[pts.length - 1]];
        pts = [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }, a];
      }
      // resample finely, drop pieces the eraser covers
      const cut = radius + stroke.width / 2;
      const step = Math.max(4, stroke.width / 2);
      const fine = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
        for (let j = 1; j <= n; j++) fine.push({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n });
      }
      const hit = (p) => eraserSegs.some(([a, b]) => pointSegDist(p, a, b) < cut);
      const runs = [];
      let cur = [];
      let touched = false;
      for (const p of fine) {
        if (hit(p)) { touched = true; if (cur.length > 1) runs.push(cur); cur = []; }
        else cur.push(p);
      }
      if (cur.length > 1) runs.push(cur);
      if (!touched) continue;
      db.prepare('DELETE FROM strokes WHERE id = ?').run(stroke.id);
      for (const run of runs) {
        db.prepare('INSERT INTO strokes (map_id, kind, tool, points, width, flipped) VALUES (?,?,?,?,?,?)')
          .run(mapId, stroke.kind, 'brush',
            JSON.stringify(run.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])),
            stroke.width, stroke.flipped);
      }
    }
  });
  tx();
  refreshFogForMap(mapId);
  ok(res);
});

// ---------------------------------------------------------------------------
// Connections (doors)
// ---------------------------------------------------------------------------
dmRouter.post('/connections', (req, res) => {
  const b = req.body || {};
  const from = getMap(Number(b.mapId));
  const to = getMap(Number(b.targetMapId));
  if (!from || !to) return bad(res, 'bad map ids');
  const info = db.prepare(
    'INSERT INTO connections (map_id, x, y, target_map_id, target_x, target_y, label) VALUES (?,?,?,?,?,?,?)'
  ).run(from.id, Number(b.x), Number(b.y), to.id, Number(b.targetX), Number(b.targetY), b.label || '');
  if (b.reverse) {
    db.prepare(
      'INSERT INTO connections (map_id, x, y, target_map_id, target_x, target_y, label) VALUES (?,?,?,?,?,?,?)'
    ).run(to.id, Number(b.targetX), Number(b.targetY), from.id, Number(b.x), Number(b.y), b.label || '');
  }
  ok(res, { id: info.lastInsertRowid });
});

// Toggle "kingdom journey" on every door between two maps (both directions),
// from the map graph. Marked doors play the world-map travel cinematic.
dmRouter.post('/map-travel-link', (req, res) => {
  const a = Number(req.body?.a);
  const b = Number(req.body?.b);
  const on = req.body?.on ? 1 : 0;
  if (!a || !b) return bad(res, 'a and b map ids required');
  db.prepare(`UPDATE connections SET world_travel = ?
    WHERE (map_id = ? AND target_map_id = ?) OR (map_id = ? AND target_map_id = ?)`)
    .run(on, a, b, b, a);
  ok(res);
});

dmRouter.delete('/connections/:id', (req, res) => {
  db.prepare('DELETE FROM connections WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

// ---------------------------------------------------------------------------
// Token movement. Continuous coordinates; painted walls block the path and
// cliffs only allow crossing along their arrows. Dropping near (within
// TRIGGER_RADIUS_METERS):
//   a door  -> travel to the linked map/point (characters AND monsters)
//   a chest -> (characters) open the chest UI
//   a shop  -> (characters) open a shop session
// ---------------------------------------------------------------------------
function nearby(table, mapId, x, y, radiusPx) {
  return db.prepare(`SELECT * FROM ${table} WHERE map_id = ?`).all(mapId)
    .find((o) => o.x != null && Math.hypot(o.x - x, o.y - y) <= radiusPx);
}

// A long-distance journey across the kingdom: put the TV on the world map, walk
// a marker along the road the DM drew (uncovering it), and only AFTER the trip
// drop the party on the destination map. The characters stay put until they
// "arrive". `drawn` are the DM's intermediate corners — the road is always
// anchored to the two towns' markers. Returns the descriptor, or null when the
// kingdom pieces aren't in place.
function startKingdomTravel(fromMap, target, charIds, arriveX, arriveY, drawn = []) {
  const world = worldMap();
  if (!world || fromMap?.world_x == null || target?.world_x == null) return null;
  const sameSpot = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < (world.cell_px || 8);
  const path = [[fromMap.world_x, fromMap.world_y]];
  for (const p of drawn) if (!sameSpot(p, path[path.length - 1])) path.push(p);
  const dest = [target.world_x, target.world_y];
  if (!sameSpot(dest, path[path.length - 1])) path.push(dest);

  revealWorldPath(path); // uncover the road as they set out
  let lenPx = 0;
  for (let i = 1; i < path.length; i++) {
    lenPx += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  // slower than a normal-map walk (~2.2 px/ms, capped 2.6 s); scales with the
  // length of the ACTUAL road, so a winding detour takes longer
  const durationMs = Math.min(11000, Math.max(3000, Math.round(lenPx * 3.6)));
  const nonce = Date.now();
  setConfig('world_travel', { path, nonce, durationMs, arriveMapId: target.id });
  setConfig('active_map_id', world.id); // the TV watches the journey
  retargetTVs(getIO());
  const tokenPx = Math.min(
    Math.max(TOKEN_METERS * (target.scale || 20), TOKEN_MIN_PX),
    target.image_w * TOKEN_MAX_FRACTION,
  );
  const timer = setTimeout(() => {
    try {
      const wt = getConfig('world_travel', null);
      if (!wt || wt.nonce !== nonce) return; // superseded by a newer journey
      charIds.forEach((id, i) => {
        const r = tokenPx * 0.6 * Math.sqrt(i);
        const a = i * 2.39996;
        const ax = Math.max(0, Math.min(target.image_w, arriveX + r * Math.cos(a)));
        const ay = Math.max(0, Math.min(target.image_h, arriveY + r * Math.sin(a)));
        db.prepare('UPDATE characters SET map_id = ?, x = ?, y = ? WHERE id = ?').run(target.id, ax, ay, id);
        setMoveFlag('character', id, true);
        refreshFogFor(parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(id)));
        revealWorldFor(id, target, fromMap);
      });
      setConfig('world_travel', null);
      setConfig('active_map_id', target.id); // …then the city appears
      retargetTVs(getIO());
      pushAll();
    } catch { /* db closed (restart/shutdown): the journey simply doesn't complete */ }
  }, durationMs + 700);
  timer.unref?.(); // never keep the process alive just for a pending arrival
  return { nonce, durationMs, worldId: world.id, arriveMapId: target.id };
}

// Validates and applies one token move; returns the result payload or {error}.
function applyMove({ kind, id, mapId, x, y }, { triggers = true } = {}) {
  const map = getGridMap(Number(mapId));
  if (!map) return { error: 'no such map' };
  if (map.is_world) return { error: 'the world map only shows positions — tokens live on regular maps' };
  x = Math.max(0, Math.min(map.image_w, Number(x)));
  y = Math.max(0, Math.min(map.image_h, Number(y)));

  const table = kind === 'monster' ? 'monsters' : kind === 'npc' ? 'npcs' : 'characters';
  const tok = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
  if (!tok) return { error: `no such ${kind}` };
  const fromMap = tok.map_id ? getMap(tok.map_id) : null; // where they came from (for the kingdom corridor)

  // Walls and one-way cliffs never refuse a drop — the DM is the judge. If a
  // walkable route exists the TV walks it (around obstacles); only when the
  // token is truly cut off does the move become a TELEPORT snap.
  let teleport = tok.map_id !== map.id || tok.x == null;
  let path = null;
  if (!teleport) {
    path = findPath(map, strokesOf(map.id), { x: tok.x, y: tok.y }, { x, y });
    teleport = !path;
  }

  const trigPx = DOOR_TRIGGER_METERS * map.scale;
  let finalMap = map, finalX = x, finalY = y, result = 'moved';
  const door = nearby('connections', map.id, x, y, trigPx);
  if (door) {
    const target = getGridMap(door.target_map_id);
    // A flagged door means a kingdom journey — but the DM draws the road first.
    // Nothing starts here: the character waits at the door and we hand back a
    // PLAN for the DM's journey window (POST /world-journey runs it).
    if (target && kind === 'character' && door.world_travel) {
      const from = getMap(map.id);
      const world = worldMap();
      if (world && from?.world_x != null && target.world_x != null) {
        db.prepare(`UPDATE ${table} SET map_id = ?, x = ?, y = ? WHERE id = ?`).run(map.id, x, y, tok.id);
        setMoveFlag('character', tok.id, true);
        refreshFogFor(parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(tok.id)));
        return {
          result: 'world-journey-plan', teleport: true,
          worldId: world.id, fromMapId: from.id, toMapId: target.id,
          arriveX: door.target_x, arriveY: door.target_y, charIds: [tok.id],
        };
      }
    }
    if (target) {
      finalMap = target; finalX = door.target_x; finalY = door.target_y;
      result = 'travelled';
      teleport = true;
      path = null;
    }
  }

  db.prepare(`UPDATE ${table} SET map_id = ?, x = ?, y = ? WHERE id = ?`)
    .run(finalMap.id, finalX, finalY, tok.id);
  setMoveFlag(kind, tok.id, teleport, path);

  const extra = { result, teleport, mapId: finalMap.id, x: finalX, y: finalY };
  if (kind !== 'character') return extra; // monsters & NPCs: no fog, no triggers

  // A walked move reveals the whole way, not just the destination.
  if (path && !teleport) revealAlongPath(tok, map, path);
  refreshFogFor(parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(tok.id)));
  // reaching a new located map fills in the kingdom around it AND the route from
  // where they were (only when it's a different place)
  revealWorldFor(tok.id, finalMap, finalMap.id !== fromMap?.id ? fromMap : null);

  if (triggers) {
    const chest = nearby('chests', finalMap.id, finalX, finalY, TRIGGER_RADIUS_METERS * finalMap.scale);
    if (chest) { extra.result = 'chest'; extra.chestId = chest.id; }
    const shop = nearby('shops', finalMap.id, finalX, finalY, TRIGGER_RADIUS_METERS * finalMap.scale);
    if (shop) {
      // shared:false — the stock reaches the player's phone only when the DM
      // flips "show on phone" in the trade dialog
      setConfig('shop_session', { shopId: shop.id, characterId: tok.id, shared: false });
      extra.result = 'shop';
      extra.shopId = shop.id;
    }
  }
  return extra;
}

dmRouter.post('/move-token', (req, res) => {
  const out = applyMove(req.body || {});
  if (out.error) return bad(res, out.error);
  ok(res, out);
});

// Group move (shift-selection). If the DROP point sits on a door, the whole
// selection travels together (fanned out around the arrival point); otherwise
// each token gets the same delta. Chest/shop dialogs don't pop for a crowd.
dmRouter.post('/move-tokens', (req, res) => {
  const { moves, anchor } = req.body || {};
  if (!Array.isArray(moves) || !moves.length) return bad(res, 'moves[] required');

  if (anchor) {
    const map = getGridMap(Number(anchor.mapId));
    const door = map && nearby('connections', map.id, anchor.x, anchor.y, DOOR_TRIGGER_METERS * map.scale);
    if (door) {
      const target = getGridMap(door.target_map_id);
      const sourceMap = target ? getMap(map.id) : null;
      // Flagged door: the whole party journeys together — hand the DM a plan to
      // draw the road (they stay at the door until it starts).
      if (target && door.world_travel) {
        const world = worldMap();
        const charIds = moves.filter((m) => m.kind !== 'monster' && m.kind !== 'npc').map((m) => Number(m.id));
        if (world && sourceMap?.world_x != null && target.world_x != null && charIds.length) {
          return ok(res, {
            blocked: [],
            journeyPlan: {
              worldId: world.id, fromMapId: sourceMap.id, toMapId: target.id,
              arriveX: door.target_x, arriveY: door.target_y, charIds,
            },
          });
        }
      }
      if (target) {
        // Everyone lands together AT the arrival point, huddled in a knot a
        // little over half a token apart so no one fully covers anyone.
        const tokenPx = Math.min(
          Math.max(TOKEN_METERS * (target.scale || 20), TOKEN_MIN_PX),
          target.image_w * TOKEN_MAX_FRACTION,
        );
        moves.forEach((m, i) => {
          const r = tokenPx * 0.6 * Math.sqrt(i);
          const a = i * 2.39996;
          const tx = Math.max(0, Math.min(target.image_w, door.target_x + r * Math.cos(a)));
          const ty = Math.max(0, Math.min(target.image_h, door.target_y + r * Math.sin(a)));
          const table = m.kind === 'monster' ? 'monsters' : m.kind === 'npc' ? 'npcs' : 'characters';
          db.prepare(`UPDATE ${table} SET map_id = ?, x = ?, y = ? WHERE id = ?`)
            .run(target.id, tx, ty, Number(m.id));
          setMoveFlag(m.kind, Number(m.id), true);
          if (m.kind === 'character') {
            refreshFogFor(parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(m.id))));
            revealWorldFor(Number(m.id), target, target.id !== sourceMap?.id ? sourceMap : null);
          }
        });
        return ok(res, { blocked: [], travelled: true, mapId: target.id });
      }
    }
  }

  const blocked = [];
  for (const m of moves) {
    const out = applyMove(m, { triggers: false });
    if (out.error) blocked.push({ id: m.id, kind: m.kind, error: out.error });
  }
  ok(res, { blocked });
});

// Remove a token from the board (back to the "unplaced" tray).
dmRouter.post('/unplace', (req, res) => {
  const { kind, id } = req.body || {};
  const table = kind === 'monster' ? 'monsters' : kind === 'npc' ? 'npcs' : 'characters';
  db.prepare(`UPDATE ${table} SET map_id = NULL, x = NULL, y = NULL WHERE id = ?`).run(Number(id));
  ok(res);
});

// ---------------------------------------------------------------------------
// Map annotations: the DM's private sticky notes. Only dmMapPayload carries
// them — the TV and players never see a trace.
// ---------------------------------------------------------------------------
dmRouter.post('/annotations', (req, res) => {
  const b = req.body || {};
  if (!getMap(Number(b.mapId))) return bad(res, 'no such map');
  if (!String(b.text || '').trim()) return bad(res, 'text required');
  const info = db.prepare('INSERT INTO annotations (map_id, x, y, text, open) VALUES (?,?,?,?,1)')
    .run(Number(b.mapId), Number(b.x) || 0, Number(b.y) || 0, String(b.text).trim());
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/annotations/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such annotation');
  const b = req.body || {};
  // box_dx/box_dy: where the DM dragged the callout box (relative to the
  // anchor, which never moves); null resets to auto-placement.
  const num = (v) => (v == null ? null : Number(v));
  db.prepare('UPDATE annotations SET text = ?, open = ?, x = ?, y = ?, box_dx = ?, box_dy = ? WHERE id = ?')
    .run('text' in b ? String(b.text) : row.text,
      'open' in b ? (b.open ? 1 : 0) : row.open,
      'x' in b ? Number(b.x) : row.x, 'y' in b ? Number(b.y) : row.y,
      'box_dx' in b ? num(b.box_dx) : row.box_dx,
      'box_dy' in b ? num(b.box_dy) : row.box_dy, row.id);
  ok(res);
});

dmRouter.delete('/annotations/:id', (req, res) => {
  db.prepare('DELETE FROM annotations WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------
dmRouter.post('/monsters', (req, res) => {
  let b = req.body || {};
  // Spawn from the bestiary: template fields fill anything not overridden.
  if (b.templateId) {
    const t = db.prepare('SELECT * FROM monster_templates WHERE id = ?').get(Number(b.templateId));
    if (!t) return bad(res, 'no such monster template');
    b = {
      name: t.name, icon: t.icon, art: t.art, stats: JSON.parse(t.stats),
      hp: t.hp, notes: t.notes, token_scale: t.token_scale, token_shape: t.token_shape,
      ...b,
    };
  }
  if (!b.name) return bad(res, 'name required');
  const info = db.prepare(
    `INSERT INTO monsters (name, icon, art, stats, hp, max_hp, notes, map_id, x, y, token_scale, token_shape)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.name, b.icon || defaultUrl('monster-token'), b.art || defaultUrl('monster-art'),
    JSON.stringify(b.stats || {}), b.hp ?? 10, b.max_hp ?? b.hp ?? 10,
    b.notes || '', b.map_id ?? null, b.x ?? null, b.y ?? null, b.token_scale || 1,
    b.token_shape || 'free');
  ok(res, { id: info.lastInsertRowid });
});

// ---------------------------------------------------------------------------
// Bestiary (monster templates)
// ---------------------------------------------------------------------------
dmRouter.post('/monster-templates', (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'name required');
  const info = db.prepare(
    'INSERT INTO monster_templates (name, icon, art, stats, hp, notes, token_scale, token_shape) VALUES (?,?,?,?,?,?,?,?)'
  ).run(b.name, b.icon || defaultUrl('monster-token'), b.art || defaultUrl('monster-art'),
    JSON.stringify(b.stats || {}), b.hp ?? 10, b.notes || '', b.token_scale || 1, b.token_shape || 'free');
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/monster-templates/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM monster_templates WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such template');
  const b = req.body || {};
  db.prepare(`UPDATE monster_templates SET name=?, icon=?, art=?, stats=?, hp=?, notes=?,
              token_scale=?, token_shape=? WHERE id=?`)
    .run(b.name ?? row.name, b.icon ?? row.icon, b.art ?? row.art,
      JSON.stringify(b.stats ?? JSON.parse(row.stats)), b.hp ?? row.hp, b.notes ?? row.notes,
      b.token_scale ?? row.token_scale, b.token_shape ?? row.token_shape, row.id);
  ok(res);
});

dmRouter.delete('/monster-templates/:id', (req, res) => {
  db.prepare('DELETE FROM monster_templates WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

dmRouter.patch('/monsters/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM monsters WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such monster');
  const b = req.body || {};
  db.prepare(`UPDATE monsters SET name=?, icon=?, art=?, stats=?, hp=?, max_hp=?, notes=?,
              map_id=?, x=?, y=?, token_scale=?, token_shape=? WHERE id=?`)
    .run(b.name ?? row.name, b.icon ?? row.icon, b.art ?? row.art,
      JSON.stringify(b.stats ?? JSON.parse(row.stats)),
      b.hp ?? row.hp, b.max_hp ?? row.max_hp, b.notes ?? row.notes,
      'map_id' in b ? b.map_id : row.map_id, 'x' in b ? b.x : row.x, 'y' in b ? b.y : row.y,
      b.token_scale ?? row.token_scale, b.token_shape ?? row.token_shape, row.id);
  ok(res);
});

dmRouter.delete('/monsters/:id', (req, res) => {
  db.prepare('DELETE FROM monsters WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

// ---------------------------------------------------------------------------
// Chests
// ---------------------------------------------------------------------------
dmRouter.post('/chests', (req, res) => {
  const b = req.body || {};
  const map = getMap(Number(b.mapId));
  if (!map) return bad(res, 'no such map');
  const info = db.prepare('INSERT INTO chests (map_id, x, y, icon) VALUES (?,?,?,?)')
    .run(map.id, Number(b.x), Number(b.y), b.icon || defaultUrl('chest-token'));
  refreshFogForMap(map.id); // someone may already be looking at that spot
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/chests/:id', (req, res) => {
  const chest = db.prepare('SELECT * FROM chests WHERE id = ?').get(Number(req.params.id));
  if (!chest) return bad(res, 'no such chest');
  const b = req.body || {};
  db.prepare('UPDATE chests SET icon = ?, hidden = ? WHERE id = ?')
    .run(b.icon ?? chest.icon, 'hidden' in b ? (b.hidden ? 1 : 0) : chest.hidden, chest.id);
  ok(res);
});

dmRouter.get('/chests/:id', (req, res) => {
  const chest = db.prepare('SELECT * FROM chests WHERE id = ?').get(Number(req.params.id));
  if (!chest) return bad(res, 'no such chest');
  res.json({ chest, ...inventoryOf('chest', chest.id) });
});

dmRouter.post('/chests/:id/state', (req, res) => {
  const chest = db.prepare('SELECT * FROM chests WHERE id = ?').get(Number(req.params.id));
  if (!chest) return bad(res, 'no such chest');
  const state = req.body?.state === 'opened' ? 'opened' : 'closed';
  // Opening a chest means the party interacted with it — it is discovered.
  db.prepare('UPDATE chests SET state = ?, discovered = CASE WHEN ? = \'opened\' THEN 1 ELSE discovered END WHERE id = ?')
    .run(state, state, chest.id);
  ok(res);
});

// Auto-generate contents: `count` weighted draws from the item list.
// Weights come from rarity tags (see shared/gameRules.js RARITY_WEIGHTS).
// Lore and campaign items are never rolled — the DM places those deliberately.
dmRouter.post('/chests/:id/generate', (req, res) => {
  const chest = db.prepare('SELECT * FROM chests WHERE id = ?').get(Number(req.params.id));
  if (!chest) return bad(res, 'no such chest');
  const count = Math.max(1, Math.min(20, Number(req.body?.count) || 3));
  const items = db.prepare("SELECT * FROM items WHERE category NOT IN ('lore','campaign')")
    .all().map(parseItem);
  if (!items.length) return bad(res, 'no items defined yet');
  const weighted = items.map((it) => ({ it, w: RARITY_WEIGHTS[rarityOf(it.tags)] }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  for (let i = 0; i < count; i++) {
    let roll = Math.random() * total;
    for (const { it, w } of weighted) {
      roll -= w;
      if (roll <= 0) { addToInventory('chest', chest.id, it.id, 1); break; }
    }
  }
  ok(res);
});

dmRouter.delete('/chests/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM inventory_entries WHERE owner_type = 'chest' AND owner_id = ?").run(id);
  db.prepare('DELETE FROM chests WHERE id = ?').run(id);
  if (getConfig('chest_session', null)?.chestId === id) setConfig('chest_session', null);
  ok(res);
});

// ---------------------------------------------------------------------------
// Shops & trading
// ---------------------------------------------------------------------------
dmRouter.post('/shops', (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'name required');
  const category = b.category in SELLER_TYPES ? b.category : 'general';
  const info = db.prepare(
    'INSERT INTO shops (name, npc_name, description, category, icon, map_id, x, y) VALUES (?,?,?,?,?,?,?,?)'
  ).run(b.name, b.npc_name || '', b.description || '', category, b.icon || null,
    b.map_id ?? null, b.x ?? null, b.y ?? null);
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/shops/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM shops WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such shop');
  const b = req.body || {};
  db.prepare('UPDATE shops SET name=?, npc_name=?, description=?, category=?, icon=?, map_id=?, x=?, y=? WHERE id=?')
    .run(b.name ?? row.name, b.npc_name ?? row.npc_name, b.description ?? row.description,
      (b.category in SELLER_TYPES) ? b.category : row.category,
      b.icon ?? row.icon, 'map_id' in b ? b.map_id : row.map_id,
      'x' in b ? b.x : row.x, 'y' in b ? b.y : row.y, row.id);
  ok(res);
});

dmRouter.delete('/shops/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM inventory_entries WHERE owner_type = 'shop' AND owner_id = ?").run(id);
  db.prepare('DELETE FROM shops WHERE id = ?').run(id);
  if (getConfig('shop_session', null)?.shopId === id) setConfig('shop_session', null);
  ok(res);
});

dmRouter.get('/shops/:id', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(Number(req.params.id));
  if (!shop) return bad(res, 'no such shop');
  res.json({ shop, ...inventoryOf('shop', shop.id) });
});

// Open/close the trade session (also opened by dropping a token on the shop).
// `shared` mirrors the stock onto that player's phone — the DM's choice.
dmRouter.post('/shop-session', (req, res) => {
  const { shopId, characterId, shared = false } = req.body || {};
  setConfig('shop_session', { shopId: Number(shopId), characterId: Number(characterId), shared: !!shared });
  ok(res);
});
dmRouter.delete('/shop-session', (_req, res) => {
  setConfig('shop_session', null);
  ok(res);
});

// Chest session: which open chest (if any) is mirrored onto a player's phone.
// Created only when the DM chooses "show on phone" in the chest dialog.
dmRouter.post('/chest-session', (req, res) => {
  const { chestId, characterId } = req.body || {};
  if (!db.prepare('SELECT id FROM chests WHERE id = ?').get(Number(chestId))) {
    return bad(res, 'no such chest');
  }
  setConfig('chest_session', { chestId: Number(chestId), characterId: Number(characterId), shared: true });
  ok(res);
});
dmRouter.delete('/chest-session', (_req, res) => {
  setConfig('chest_session', null);
  ok(res);
});

// Trade between the session shop and character. Gold moves automatically;
// formulas live in shared/gameRules.js.
dmRouter.post('/trade', (req, res) => {
  const { shopId, characterId, entryId, quantity = 1, direction } = req.body || {};
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(Number(shopId));
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(characterId));
  const entry = db.prepare('SELECT * FROM inventory_entries WHERE id = ?').get(Number(entryId));
  if (!shop || !character || !entry) return bad(res, 'bad trade parameters');
  const qty = Math.max(1, Math.min(Number(quantity), entry.quantity));

  if (direction === 'buy') { // character buys from shop
    if (entry.owner_type !== 'shop' || entry.owner_id !== shop.id) return bad(res, 'entry not in shop');
    const cost = (entry.price ?? 0) * qty;
    if (character.gold < cost) return bad(res, `not enough gold (needs ${cost})`);
    removeFromInventory(entry.id, qty);
    addToInventory('character', character.id, entry.item_id, qty);
    logInventory(character.id, entry.item_id, qty, 'bought');
    db.prepare('UPDATE characters SET gold = gold - ? WHERE id = ?').run(cost, character.id);
    // Stock the players bought back is no longer "recently sold to us".
    db.prepare(`UPDATE inventory_entries SET sold_recently = 0
                WHERE owner_type='shop' AND owner_id=? AND item_id=?`).run(shop.id, entry.item_id);
    return ok(res, { gold: character.gold - cost });
  }

  if (direction === 'sell') { // character sells to shop at SHOP_BUY_FACTOR of list
    if (entry.owner_type !== 'character' || entry.owner_id !== character.id) {
      return bad(res, 'entry not in character inventory');
    }
    const existing = db.prepare(
      "SELECT * FROM inventory_entries WHERE owner_type='shop' AND owner_id=? AND item_id=?"
    ).get(shop.id, entry.item_id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(entry.item_id);
    const listPrice = existing?.price ?? item.value;
    const payout = shopBuyPrice(listPrice) * qty;
    removeFromInventory(entry.id, qty);
    logInventory(character.id, entry.item_id, -qty, 'sold');
    const shopEntryId = addToInventory('shop', shop.id, entry.item_id, qty, listPrice);
    db.prepare('UPDATE inventory_entries SET sold_recently = 1 WHERE id = ?').run(shopEntryId);
    db.prepare('UPDATE characters SET gold = gold + ? WHERE id = ?').run(payout, character.id);
    return ok(res, { payout });
  }

  bad(res, 'direction must be buy or sell');
});

// Restock a shop with random weapons consistent with its seller type.
// Names/categories come from weapon-names.json (project root); specs are
// rolled and rank-weighted so strong weapons appear rarely.
dmRouter.post('/shops/:id/restock-weapons', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(Number(req.params.id));
  if (!shop) return bad(res, 'no such shop');
  const seller = SELLER_TYPES[shop.category] || SELLER_TYPES.general;
  if (seller.weapons && seller.weapons.length === 0) {
    return bad(res, `a "${seller.label}" does not deal in weapons`);
  }
  const count = Math.max(1, Math.min(12, Number(req.body?.count) || 3));
  let names;
  try {
    names = JSON.parse(fs.readFileSync(path.join(projectRoot, 'weapon-names.json'), 'utf8'));
  } catch (e) {
    return bad(res, `cannot read weapon-names.json: ${e.message}`);
  }
  if (seller.weapons) names = names.filter((n) => seller.weapons.includes(n.category));
  if (!Array.isArray(names) || !names.length) return bad(res, 'no weapon names fit this seller type');
  const gen = weaponGen();
  const added = [];
  for (let i = 0; i < count; i++) {
    const candidates = Array.from({ length: 4 }, () => {
      const n = names[Math.floor(Math.random() * names.length)];
      return rollWeapon(n.name || String(n), n.category || 'sword', gen);
    });
    const w = pickByRank(candidates);
    // Description stays empty on purpose: an LLM writes the story later
    // (prompts/generate-gear-lore.md), matched to the rarity tag.
    const info = db.prepare(`INSERT INTO items
      (name, description, category, measure, weight, value, damage, range, tags)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(w.name, '', 'weapon', 'unit',
        w.weight, w.value, w.damage, w.range, JSON.stringify(w.tags));
    addToInventory('shop', shop.id, info.lastInsertRowid, 1, w.value);
    added.push({ name: w.name, damage: w.damage, range: w.range, value: w.value, rarity: w.rarity });
  }
  ok(res, { added });
});

// Restock a shop with random armor consistent with its seller type. Names come
// from armor-names.json; specs are rolled and rank-weighted like weapons.
dmRouter.post('/shops/:id/restock-armor', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(Number(req.params.id));
  if (!shop) return bad(res, 'no such shop');
  const seller = SELLER_TYPES[shop.category] || SELLER_TYPES.general;
  if (seller.armor && seller.armor.length === 0) {
    return bad(res, `a "${seller.label}" does not deal in armor`);
  }
  const count = Math.max(1, Math.min(12, Number(req.body?.count) || 3));
  let names;
  try {
    names = JSON.parse(fs.readFileSync(path.join(projectRoot, 'armor-names.json'), 'utf8'));
  } catch (e) {
    return bad(res, `cannot read armor-names.json: ${e.message}`);
  }
  if (seller.armor) names = names.filter((n) => seller.armor.includes(n.category));
  if (!Array.isArray(names) || !names.length) return bad(res, 'no armor names fit this seller type');
  const gen = armorGen();
  const added = [];
  for (let i = 0; i < count; i++) {
    const candidates = Array.from({ length: 4 }, () => {
      const n = names[Math.floor(Math.random() * names.length)];
      return rollArmor(n.name || String(n), n.category || 'leather', gen);
    });
    const a = pickByRank(candidates);
    const info = db.prepare(`INSERT INTO items
      (name, description, category, measure, weight, value, armor, tags)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(a.name, '', 'armor', 'unit', a.weight, a.value, a.armor, JSON.stringify(a.tags));
    addToInventory('shop', shop.id, info.lastInsertRowid, 1, a.value);
    added.push({ name: a.name, armor: a.armor, value: a.value, rarity: a.rarity });
  }
  ok(res, { added });
});

// Advance the shop economy one day: every player-sold ("sold recently") stack
// vanishes with probability SHOP_DISAPPEAR_CHANCE — bought off-screen.
dmRouter.post('/shops/advance-day', (_req, res) => {
  const soldEntries = db.prepare(
    "SELECT * FROM inventory_entries WHERE owner_type='shop' AND sold_recently = 1"
  ).all();
  let vanished = 0;
  for (const e of soldEntries) {
    if (Math.random() < SHOP_DISAPPEAR_CHANCE) {
      db.prepare('DELETE FROM inventory_entries WHERE id = ?').run(e.id);
      vanished++;
    }
  }
  setConfig('shop_day', getConfig('shop_day') + 1);
  ok(res, { day: getConfig('shop_day'), vanished, rolled: soldEntries.length });
});

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------
dmRouter.post('/npcs', (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'name required');
  const info = db.prepare(
    `INSERT INTO npcs (name, description, portrait, token, map_id, x, y, token_scale, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(b.name, b.description || '', b.portrait || defaultUrl('npc-art'),
    b.token || defaultUrl('npc-token'), b.map_id ?? null,
    b.x ?? null, b.y ?? null, b.token_scale || 1, b.notes || '');
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.patch('/npcs/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM npcs WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such npc');
  const b = req.body || {};
  db.prepare('UPDATE npcs SET name=?, description=?, portrait=?, token=?, map_id=?, x=?, y=?, token_scale=?, token_shape=?, notes=? WHERE id=?')
    .run(b.name ?? row.name, b.description ?? row.description, b.portrait ?? row.portrait,
      b.token ?? row.token,
      'map_id' in b ? b.map_id : row.map_id, 'x' in b ? b.x : row.x, 'y' in b ? b.y : row.y,
      b.token_scale ?? row.token_scale, b.token_shape ?? row.token_shape,
      b.notes ?? row.notes, row.id);
  ok(res);
});

dmRouter.delete('/npcs/:id', (req, res) => {
  db.prepare('DELETE FROM npcs WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

// ---------------------------------------------------------------------------
// Music: per-map YouTube playlists; the TV is the (audio-only) speaker.
// ---------------------------------------------------------------------------
dmRouter.post('/tracks', (req, res) => {
  const b = req.body || {};
  if (!getMap(Number(b.mapId))) return bad(res, 'no such map');
  const youtubeId = parseYoutubeId(b.youtubeUrl || b.youtubeId);
  if (!youtubeId && !b.file) return bad(res, 'paste a YouTube link');
  const info = db.prepare('INSERT INTO tracks (map_id, name, file, youtube_id) VALUES (?,?,?,?)')
    .run(Number(b.mapId), b.name || 'track', b.file || '', youtubeId);
  ok(res, { id: info.lastInsertRowid });
});

dmRouter.delete('/tracks/:id', (req, res) => {
  const id = Number(req.params.id);
  const music = getConfig('music');
  if (music.trackId === id) setConfig('music', { trackId: null, playing: false });
  db.prepare('UPDATE maps SET default_track_id = NULL WHERE default_track_id = ?').run(id);
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
  ok(res);
});

dmRouter.post('/music', (req, res) => {
  const { trackId = null, playing = false } = req.body || {};
  if (trackId !== null && !db.prepare('SELECT id FROM tracks WHERE id = ?').get(Number(trackId))) {
    return bad(res, 'no such track');
  }
  setConfig('music', { trackId: trackId === null ? null : Number(trackId), playing: !!playing });
  ok(res);
});

// Soundboard: uploaded audio files fired once on the TV.
dmRouter.post('/sounds', (req, res) => {
  const { name, file } = req.body || {};
  if (!file) return bad(res, 'file required (upload kind=music first)');
  const info = db.prepare('INSERT INTO sounds (name, file) VALUES (?,?)').run(name || 'sound', file);
  ok(res, { id: info.lastInsertRowid });
});
dmRouter.patch('/sounds/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sounds WHERE id = ?').get(Number(req.params.id));
  if (!row) return bad(res, 'no such sound');
  db.prepare('UPDATE sounds SET name = ? WHERE id = ?').run(req.body?.name ?? row.name, row.id);
  ok(res);
});
dmRouter.delete('/sounds/:id', (req, res) => {
  db.prepare('DELETE FROM sounds WHERE id = ?').run(Number(req.params.id));
  ok(res);
});
dmRouter.post('/sounds/:id/play', (req, res) => {
  const sound = db.prepare('SELECT * FROM sounds WHERE id = ?').get(Number(req.params.id));
  if (!sound) return bad(res, 'no such sound');
  setConfig('sfx', { url: sound.file, name: sound.name, nonce: Date.now() });
  ok(res);
});

// ---------------------------------------------------------------------------
// TV image overlay: flash a picture (a found letter, an NPC's face, a scene)
// over the party screen until dismissed.
// ---------------------------------------------------------------------------
dmRouter.post('/tv-overlay', (req, res) => {
  const { url, title = '' } = req.body || {};
  if (!url) return bad(res, 'url required');
  setConfig('tv_overlay', { url, title });
  ok(res);
});
dmRouter.delete('/tv-overlay', (_req, res) => {
  setConfig('tv_overlay', null);
  ok(res);
});

// Image library backing the overlay (upload via /upload?kind=images first).
dmRouter.post('/images', (req, res) => {
  const { name, path: p } = req.body || {};
  if (!p) return bad(res, 'path required (upload first)');
  const info = db.prepare('INSERT INTO images (name, path) VALUES (?,?)').run(name || 'image', p);
  ok(res, { id: info.lastInsertRowid });
});
dmRouter.delete('/images/:id', (req, res) => {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(Number(req.params.id));
  if (img && getConfig('tv_overlay', null)?.url === img.path) setConfig('tv_overlay', null);
  db.prepare('DELETE FROM images WHERE id = ?').run(Number(req.params.id));
  ok(res);
});

// ---------------------------------------------------------------------------
// The Dungeon Master's own diary (character_id NULL rows).
// ---------------------------------------------------------------------------
dmRouter.post('/diary', (req, res) => {
  const { title = '', body = '' } = req.body || {};
  const info = db.prepare('INSERT INTO diary_entries (character_id, title, body) VALUES (NULL,?,?)')
    .run(title, body);
  ok(res, { id: info.lastInsertRowid });
});
dmRouter.patch('/diary/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM diary_entries WHERE id = ? AND character_id IS NULL')
    .get(Number(req.params.id));
  if (!row) return bad(res, 'no such entry');
  const b = req.body || {};
  db.prepare('UPDATE diary_entries SET title = ?, body = ? WHERE id = ?')
    .run(b.title ?? row.title, b.body ?? row.body, row.id);
  ok(res);
});
dmRouter.delete('/diary/:id', (req, res) => {
  db.prepare('DELETE FROM diary_entries WHERE id = ? AND character_id IS NULL')
    .run(Number(req.params.id));
  ok(res);
});
