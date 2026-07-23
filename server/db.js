import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './config.js';
import { DEFAULT_STAT_BLOCK } from '../shared/gameRules.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

// Additive migration for databases created before v2/v3 (new columns only;
// schema.sql stays the source of truth for fresh installs).
function ensureColumns(table, defs) {
  const have = new Set(db.pragma(`table_info(${table})`).map((c) => c.name));
  let added = false;
  for (const [name, ddl] of Object.entries(defs)) {
    if (!have.has(name)) { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); added = true; }
  }
  return added;
}
const preV2 = db.pragma('table_info(characters)').length &&
  !db.pragma('table_info(characters)').some((c) => c.name === 'armor');
ensureColumns('characters', {
  armor: 'INTEGER NOT NULL DEFAULT 0', token: 'TEXT',
  x: 'REAL', y: 'REAL', token_scale: 'REAL NOT NULL DEFAULT 1',
  token_shape: "TEXT NOT NULL DEFAULT 'circle'",
});
const preV3 = ensureColumns('maps', {
  scale: 'REAL NOT NULL DEFAULT 20', mobility: 'REAL NOT NULL DEFAULT 1',
  visibility: 'REAL NOT NULL DEFAULT 1',
  token_scale: 'REAL NOT NULL DEFAULT 1', icon_scale: 'REAL NOT NULL DEFAULT 1',
  is_template: 'INTEGER NOT NULL DEFAULT 0',
  is_world: 'INTEGER NOT NULL DEFAULT 0', world_x: 'REAL', world_y: 'REAL',
  reveal_map: 'INTEGER NOT NULL DEFAULT 0', reveal_vision: 'INTEGER NOT NULL DEFAULT 0',
  default_track_id: 'INTEGER',
});
ensureColumns('maps', { is_dungeon: 'INTEGER NOT NULL DEFAULT 0' });
ensureColumns('items', {
  category: "TEXT NOT NULL DEFAULT 'item'", measure: "TEXT NOT NULL DEFAULT 'unit'",
  damage: 'TEXT', range: 'REAL', armor: 'INTEGER', lore_text: 'TEXT', image: 'TEXT',
});
ensureColumns('monsters', { art: 'TEXT', x: 'REAL', y: 'REAL', token_scale: 'REAL NOT NULL DEFAULT 1', token_shape: "TEXT NOT NULL DEFAULT 'free'" });
ensureColumns('npcs', { token: 'TEXT', x: 'REAL', y: 'REAL', token_scale: 'REAL NOT NULL DEFAULT 1', token_shape: "TEXT NOT NULL DEFAULT 'free'", show_name: 'INTEGER NOT NULL DEFAULT 0' });
ensureColumns('chests', { icon: 'TEXT', x: 'REAL', y: 'REAL', hidden: 'INTEGER NOT NULL DEFAULT 0' });
ensureColumns('shops', { category: "TEXT NOT NULL DEFAULT 'general'", x: 'REAL', y: 'REAL' });
ensureColumns('connections', {
  x: 'REAL', y: 'REAL', target_x: 'REAL', target_y: 'REAL',
  world_travel: 'INTEGER NOT NULL DEFAULT 0',
});
ensureColumns('powers', { circle: 'INTEGER NOT NULL DEFAULT 0' });
ensureColumns('tracks', { youtube_id: 'TEXT' });
ensureColumns('annotations', { box_dx: 'REAL', box_dy: 'REAL' });
if (preV2) {
  // vision_radius changed units (hexes -> meters); lift old tiny values.
  db.exec('UPDATE characters SET vision_radius = 15 WHERE vision_radius < 8');
}
if (preV3) {
  // Hex-era fog cells and positions are meaningless on the continuous map.
  db.exec('DELETE FROM fog_seen');
}
// Hex-era chests/connections had NOT NULL q,r columns that block v3 inserts;
// rebuild those tables (doors must be re-placed; chests keep their loot).
function hasLegacyQ(table) {
  return db.pragma(`table_info(${table})`).some((c) => c.name === 'q' && c.notnull);
}
if (hasLegacyQ('connections')) {
  db.exec(`
    DROP TABLE connections;
    CREATE TABLE connections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id        INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      x             REAL NOT NULL,
      y             REAL NOT NULL,
      target_map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      target_x      REAL NOT NULL,
      target_y      REAL NOT NULL,
      label         TEXT NOT NULL DEFAULT ''
    );
  `);
}
if (hasLegacyQ('chests')) {
  db.exec(`
    ALTER TABLE chests RENAME TO chests_old;
    CREATE TABLE chests (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id     INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      x          REAL NOT NULL,
      y          REAL NOT NULL,
      icon       TEXT,
      state      TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','opened')),
      discovered INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO chests (id, map_id, x, y, icon, state, discovered)
      SELECT id, map_id, 100, 100, icon, state, discovered FROM chests_old;
    DROP TABLE chests_old;
  `);
}

// --- config key/value helpers (values stored as JSON) ---
const getConfigStmt = db.prepare('SELECT value FROM config WHERE key = ?');
const setConfigStmt = db.prepare(
  'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getConfig(key, fallback = null) {
  const row = getConfigStmt.get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setConfig(key, value) {
  setConfigStmt.run(key, JSON.stringify(value));
}

// First-run defaults.
if (getConfig('stat_block') === null) setConfig('stat_block', DEFAULT_STAT_BLOCK);
if (getConfig('spectator_key') === null) {
  setConfig('spectator_key', crypto.randomBytes(8).toString('hex'));
}
if (getConfig('shop_day') === null) setConfig('shop_day', 0);
if (getConfig('music') === null) setConfig('music', { trackId: null, playing: false });

// --- row helpers: JSON columns parsed on the way out ---
export function parseChar(row) {
  if (!row) return null;
  return { ...row, stats: JSON.parse(row.stats) };
}

export function parseMonster(row) {
  if (!row) return null;
  return { ...row, stats: JSON.parse(row.stats) };
}

export function parseItem(row) {
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags) };
}

// Inventory of one owner, joined with item details, plus total carried weight.
const invStmt = db.prepare(`
  SELECT e.id AS entry_id, e.quantity, e.price, e.sold_recently, i.*
  FROM inventory_entries e JOIN items i ON i.id = e.item_id
  WHERE e.owner_type = ? AND e.owner_id = ?
  ORDER BY i.name
`);

export function inventoryOf(ownerType, ownerId) {
  const entries = invStmt.all(ownerType, ownerId).map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
  const weight = entries.reduce((sum, e) => sum + e.weight * e.quantity, 0);
  return { entries, weight: Math.round(weight * 100) / 100 };
}

// Add quantity of an item to an owner, merging with an existing stack.
// For shops, a `price` may be supplied for new stacks (defaults to item value).
export function addToInventory(ownerType, ownerId, itemId, quantity, price = null) {
  const existing = db.prepare(
    'SELECT * FROM inventory_entries WHERE owner_type = ? AND owner_id = ? AND item_id = ?'
  ).get(ownerType, ownerId, itemId);
  if (existing) {
    db.prepare('UPDATE inventory_entries SET quantity = quantity + ? WHERE id = ?')
      .run(quantity, existing.id);
    return existing.id;
  }
  const basePrice = ownerType === 'shop'
    ? (price ?? db.prepare('SELECT value FROM items WHERE id = ?').get(itemId)?.value ?? 0)
    : null;
  const info = db.prepare(
    'INSERT INTO inventory_entries (owner_type, owner_id, item_id, quantity, price) VALUES (?,?,?,?,?)'
  ).run(ownerType, ownerId, itemId, quantity, basePrice);
  return info.lastInsertRowid;
}

// Remove quantity from an entry; deletes the row when it hits zero.
export function removeFromInventory(entryId, quantity) {
  const entry = db.prepare('SELECT * FROM inventory_entries WHERE id = ?').get(entryId);
  if (!entry) return null;
  if (quantity >= entry.quantity) {
    db.prepare('DELETE FROM inventory_entries WHERE id = ?').run(entryId);
  } else {
    db.prepare('UPDATE inventory_entries SET quantity = quantity - ? WHERE id = ?')
      .run(quantity, entryId);
  }
  return entry;
}

export function carriedWeight(characterId) {
  return inventoryOf('character', characterId).weight;
}

// Painted physics strokes of one map, points parsed.
export function strokesOf(mapId) {
  return db.prepare('SELECT * FROM strokes WHERE map_id = ?').all(mapId)
    .map((s) => ({ ...s, points: JSON.parse(s.points) }));
}

// Drawn-on-the-map ink, oldest first so later strokes lie on top.
export function inkOf(mapId) {
  return db.prepare('SELECT * FROM ink WHERE map_id = ? ORDER BY id').all(mapId)
    .map((s) => ({ ...s, points: JSON.parse(s.points) }));
}

export function getMap(mapId) {
  return db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
}

// The map as it should LOOK under the current campaign weather: if the weather
// isn't "normal" and this map has a variant named after it, swap in that
// variant's image + light; otherwise the map keeps its normal (base) look.
// One global weather ⇒ every map is coherent; a missing variant falls back.
export function effectiveMap(map) {
  if (!map) return map;
  const weather = getConfig('weather', 'normal');
  if (!weather || weather === 'normal') return map;
  const v = db.prepare('SELECT image, visibility FROM map_variants WHERE map_id = ? AND lower(name) = ?')
    .get(map.id, String(weather).toLowerCase());
  return v ? { ...map, image: v.image, visibility: v.visibility } : map;
}
