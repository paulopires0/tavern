// Builds the view-scoped payloads pushed over Socket.IO, and the broadcast
// helpers every mutating route calls. Recomputing whole payloads per change is
// deliberate: a table has ~6 clients, and "rebuild everything" cannot drift
// out of sync the way fine-grained events can.
//
// Channels:
//   'state'     — per-viewer global data (roster for DM, own character for a
//                 player, active map pointer + music for everyone)
//   'state:map' — detail of one map, sent to sockets watching that map
//                 (DM sees everything; TV gets fog-filtered tokens)
import { db, getConfig, parseChar, parseMonster, parseItem, inventoryOf, strokesOf, inkOf, getMap } from './db.js';
import { getGridMap, cellKey } from './grid.js';
import { partyFog, fogStateOf } from './fog.js';
import { wasTeleport, movePathOf } from './moveFlags.js';
import { recentActivity } from './activity.js';
import { weaponGen, armorGen } from './generation.js';
import { TOKEN_METERS, TOKEN_MIN_PX, TOKEN_MAX_FRACTION, VISION_METERS_DEFAULT } from '../shared/gameRules.js';

let io = null;
export function bindIO(server) { io = server; }
export function getIO() { return io; }

// ---------- global payloads ----------

// A kingdom-journey cue is a ONE-SHOT. It stays in config until its arrival
// timer clears it, but a cue whose walk is already over must never reach a
// client — otherwise re-showing the kingdom map replays the whole trip (and it
// would replay again on every revisit). Filtering here means even a browser
// running an older bundle can't animate a finished journey.
function liveWorldTravel() {
  const cue = getConfig('world_travel', null);
  if (!cue?.nonce || !Array.isArray(cue.path) || cue.path.length < 2) return null;
  return Date.now() - cue.nonce < (cue.durationMs || 2600) + 1500 ? cue : null;
}

function musicState() {
  const music = getConfig('music');
  const track = music.trackId
    ? db.prepare('SELECT * FROM tracks WHERE id = ?').get(music.trackId)
    : null;
  return { playing: music.playing && !!track, track: track || null };
}

function mapsList() {
  // full rows: the DM's door-destination picker renders any map from this list
  return db.prepare('SELECT * FROM maps ORDER BY id').all();
}

function shopSession() {
  return getConfig('shop_session', null); // {shopId, characterId} | null
}

export function characterPayload(c) {
  const inv = inventoryOf('character', c.id);
  const powers = db.prepare('SELECT * FROM powers WHERE character_id = ? ORDER BY id').all(c.id);
  return { ...c, inventory: inv.entries, carried_weight: inv.weight, powers };
}

function dmGlobal() {
  const characters = db.prepare('SELECT * FROM characters ORDER BY name').all()
    .map(parseChar).map(characterPayload);
  return {
    role: 'dm',
    statBlock: getConfig('stat_block'),
    visionDefault: getConfig('vision_default', VISION_METERS_DEFAULT),
    dmPasswordCustom: getConfig('dm_password', null) != null,
    weaponGen: weaponGen(),
    armorGen: armorGen(),
    activeMapId: getConfig('active_map_id', null),
    spectatorKey: getConfig('spectator_key'),
    shopDay: getConfig('shop_day'),
    maps: mapsList(),
    mapVariants: db.prepare('SELECT * FROM map_variants ORDER BY map_id, name').all(),
    weather: getConfig('weather', 'normal'),
    // the door graph: which maps connect to which (for the Live map picker),
    // plus which links demand a kingdom journey
    mapLinks: db.prepare('SELECT map_id, target_map_id, world_travel FROM connections').all(),
    worldTravel: liveWorldTravel(), // only while the walk is actually running
    characters,
    items: db.prepare('SELECT * FROM items ORDER BY name').all().map(parseItem),
    shops: db.prepare('SELECT * FROM shops ORDER BY name').all(),
    npcs: db.prepare('SELECT * FROM npcs ORDER BY name').all(),
    monsters: db.prepare('SELECT * FROM monsters ORDER BY id').all().map(parseMonster),
    monsterTemplates: db.prepare('SELECT * FROM monster_templates ORDER BY name').all()
      .map((t) => ({ ...t, stats: JSON.parse(t.stats) })),
    tracks: db.prepare('SELECT * FROM tracks ORDER BY map_id, name').all(),
    images: db.prepare('SELECT * FROM images ORDER BY id DESC').all(),
    sounds: db.prepare('SELECT * FROM sounds ORDER BY name').all(),
    tvOverlay: getConfig('tv_overlay', null),
    diary: db.prepare('SELECT * FROM diary_entries WHERE character_id IS NULL ORDER BY id DESC').all(),
    music: musicState(),
    shopSession: shopSession(),
    chestSession: getConfig('chest_session', null),
    activity: recentActivity(), // live inventory feed
  };
}

function tvGlobal() {
  return {
    role: 'tv',
    activeMapId: getConfig('active_map_id', null),
    tvOverlay: getConfig('tv_overlay', null),
    sfx: getConfig('sfx', null), // {url, name, nonce} — TV plays it once per nonce
    worldTravel: liveWorldTravel(), // {path, nonce, durationMs} — only while it is running
    music: musicState(), // TV is the audio output device, audio only (README)
  };
}

function playerGlobal(characterId) {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!row) return { role: 'player', character: null };
  const c = characterPayload(parseChar(row));
  const map = c.map_id ? getMap(c.map_id) : null;
  const diary = db.prepare('SELECT * FROM diary_entries WHERE character_id = ? ORDER BY id DESC')
    .all(characterId);
  const partyHere = c.map_id
    ? db.prepare('SELECT name FROM characters WHERE map_id = ? AND id != ?')
        .all(c.map_id, c.id).map((r) => r.name)
    : [];
  // Shop stock / chest contents mirror onto the phone ONLY while the DM has
  // flipped "show on phone" for this character's session.
  const session = shopSession();
  let shop = null;
  if (session && session.characterId === c.id && session.shared) {
    const s = db.prepare('SELECT * FROM shops WHERE id = ?').get(session.shopId);
    if (s) {
      shop = {
        id: s.id, name: s.name, npc_name: s.npc_name, description: s.description,
        entries: inventoryOf('shop', s.id).entries,
      };
    }
  }
  const chestSession = getConfig('chest_session', null);
  let chest = null;
  if (chestSession && chestSession.characterId === c.id && chestSession.shared) {
    const ch = db.prepare('SELECT * FROM chests WHERE id = ?').get(chestSession.chestId);
    if (ch) chest = { id: ch.id, state: ch.state, entries: inventoryOf('chest', ch.id).entries };
  }
  return {
    role: 'player',
    statBlock: getConfig('stat_block'),
    character: c,
    diary,
    // item catalog so players can add gear to their own bag (and read lore)
    items: db.prepare('SELECT * FROM items ORDER BY name').all().map(parseItem),
    location: map ? { mapId: map.id, mapName: map.name, partyHere } : null,
    shop,
    chest,
  };
}

export function globalStateFor(viewer) {
  if (viewer.role === 'dm') return dmGlobal();
  if (viewer.role === 'tv') return tvGlobal();
  return playerGlobal(viewer.characterId);
}

// ---------- per-map payloads ----------

function baseMapPayload(map) {
  return {
    mapId: map.id,
    map: { ...map },
    connections: db.prepare('SELECT * FROM connections WHERE map_id = ?').all(map.id),
  };
}

// The kingdom map never hosts tokens: character markers DERIVE from which
// located map each character currently stands on. Party members on the same
// spot huddle in a tight knot (fanned by ~half a rendered token so everyone
// stays visible but clearly together). They are view-only.
function worldTokens(worldMap) {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.token_color, c.token, c.token_scale, c.token_shape,
           m.world_x, m.world_y
    FROM characters c JOIN maps m ON m.id = c.map_id
    WHERE m.world_x IS NOT NULL AND m.is_world = 0
  `).all();
  // same clamp the client applies when it draws tokens on this map
  const tokenPx = Math.min(
    Math.max(TOKEN_METERS * (worldMap.scale || 20), TOKEN_MIN_PX),
    worldMap.image_w * TOKEN_MAX_FRACTION,
  );
  const perSpot = new Map();
  return rows.map((r) => {
    const spot = `${r.world_x},${r.world_y}`;
    const i = perSpot.get(spot) || 0;
    perSpot.set(spot, i + 1);
    const rad = tokenPx * 0.55 * Math.sqrt(i);
    const a = i * 2.39996;
    return {
      id: r.id, name: r.name, token_color: r.token_color, token: r.token,
      token_scale: r.token_scale, token_shape: r.token_shape,
      x: r.world_x + rad * Math.cos(a), y: r.world_y + rad * Math.sin(a),
      teleport: true, derived: true,
    };
  });
}

// DM sees every stroke, token and object, no fog — plus their private notes
// (annotations never appear in any other payload).
export function dmMapPayload(mapId) {
  const map = getGridMap(mapId);
  if (!map) return { mapId, map: null };
  const annotations = db.prepare('SELECT * FROM annotations WHERE map_id = ? ORDER BY id').all(mapId);
  if (map.is_world) {
    // like the party's view: just the geography and where everyone stands
    return {
      ...baseMapPayload(map),
      strokes: strokesOf(mapId),
      ink: inkOf(mapId),
      characters: worldTokens(map),
      monsters: [], chests: [], shops: [], npcs: [],
      annotations,
    };
  }
  return {
    ...baseMapPayload(map),
    strokes: strokesOf(mapId),
    ink: inkOf(mapId),
    characters: db.prepare('SELECT * FROM characters WHERE map_id = ?').all(mapId).map(parseChar),
    monsters: db.prepare('SELECT * FROM monsters WHERE map_id = ?').all(mapId).map(parseMonster),
    chests: db.prepare('SELECT * FROM chests WHERE map_id = ?').all(mapId),
    shops: db.prepare('SELECT * FROM shops WHERE map_id = ?').all(mapId),
    npcs: db.prepare('SELECT * FROM npcs WHERE map_id = ?').all(mapId),
    annotations,
  };
}

// TV: the party's fog state per cell + fog-filtered tokens and objects.
// NPCs and monsters appear while the party currently sees their spot; no
// stats, no NPC notes, no doors, no DM annotations.
export function tvMapPayload(mapId) {
  const map = getGridMap(mapId);
  if (!map) return { mapId, map: null };
  if (map.is_world) {
    // the party sees the uncovered geography and ONLY themselves — no
    // monsters, chests, doors or map markers
    const fog = partyFog(mapId);
    const fogGrid = {};
    for (let cx = 0; cx < map.cells_x; cx++) {
      for (let cy = 0; cy < map.cells_y; cy++) {
        fogGrid[cellKey(cx, cy)] = fogStateOf(fog, map, cx, cy);
      }
    }
    return {
      mapId: map.id, map: { ...map }, fogGrid, ink: inkOf(mapId),
      characters: worldTokens(map), monsters: [], chests: [], connections: [],
    };
  }
  const fog = partyFog(mapId);
  const fogGrid = {};
  for (let cx = 0; cx < map.cells_x; cx++) {
    for (let cy = 0; cy < map.cells_y; cy++) {
      fogGrid[cellKey(cx, cy)] = fogStateOf(fog, map, cx, cy);
    }
  }
  const cellStateAt = (x, y) =>
    fogStateOf(fog, map, Math.floor(x / map.cell_px), Math.floor(y / map.cell_px));
  const monsters = db.prepare('SELECT id, icon, x, y, name, token_scale, token_shape FROM monsters WHERE map_id = ?')
    .all(mapId)
    .filter((m) => m.x != null && cellStateAt(m.x, m.y) === 2) // live info only; names always shown
    .map((m) => ({ ...m, teleport: wasTeleport('monster', m.id), path: movePathOf('monster', m.id) }));
  const npcs = db.prepare('SELECT id, name, token, x, y, token_scale, token_shape, show_name FROM npcs WHERE map_id = ?')
    .all(mapId)
    .filter((n) => n.x != null && cellStateAt(n.x, n.y) === 2) // people move: live info only
    .map((n) => ({ ...n, teleport: wasTeleport('npc', n.id), path: movePathOf('npc', n.id) }));
  const characters = db.prepare('SELECT id, name, x, y, token_color, token, token_scale, token_shape, hp, max_hp FROM characters WHERE map_id = ?')
    .all(mapId)
    .map((c) => ({ ...c, teleport: wasTeleport('character', c.id), path: movePathOf('character', c.id) }));
  const shops = db.prepare('SELECT id, name, icon, x, y FROM shops WHERE map_id = ?')
    .all(mapId)
    .filter((s2) => s2.x != null && cellStateAt(s2.x, s2.y) >= 1); // buildings: remembered once seen
  // Doors are DM knowledge; chests are too — an icon on the big screen would
  // announce hidden loot before the party has found anything. Neither is sent.
  return {
    ...baseMapPayload(map), connections: [], chests: [], fogGrid, ink: inkOf(mapId),
    characters, monsters, npcs, shops,
  };
}

// A player's phone shows no tactical map (README assumption) but we still
// scope a payload for potential future use; players watching a map get the
// same fog-filtered view as the TV.
export function mapPayloadFor(viewer, mapId) {
  return viewer.role === 'dm' ? dmMapPayload(mapId) : tvMapPayload(mapId);
}

// ---------- broadcast ----------

// Sockets set socket.data.viewer at connection and join rooms:
//   dm / tv / char:<id>, plus watch:dm:<mapId> or watch:tv:<mapId>.
export function pushGlobal() {
  if (!io) return;
  for (const [, socket] of io.sockets.sockets) {
    const viewer = socket.data.viewer;
    if (viewer) socket.emit('state', globalStateFor(viewer));
  }
}

export function pushMaps() {
  if (!io) return;
  const cache = new Map(); // "role:mapId" -> payload, computed once per push
  for (const [, socket] of io.sockets.sockets) {
    const { viewer, watchMapId } = socket.data;
    if (!viewer || !watchMapId) continue;
    const roleKind = viewer.role === 'dm' ? 'dm' : 'tv';
    const cacheKey = `${roleKind}:${watchMapId}`;
    if (!cache.has(cacheKey)) cache.set(cacheKey, mapPayloadFor(viewer, watchMapId));
    socket.emit('state:map', cache.get(cacheKey));
  }
}

// The one call every mutating route makes.
export function pushAll() {
  pushGlobal();
  pushMaps();
}
