PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  -- Plaintext on purpose: LAN-only app, DM needs to read passwords back to
  -- players who forget them. See README "Security model".
  password         TEXT NOT NULL DEFAULT '',
  stats            TEXT NOT NULL DEFAULT '{}',   -- JSON {statKey: number}
  hp               INTEGER NOT NULL DEFAULT 10,
  max_hp           INTEGER NOT NULL DEFAULT 10,
  armor            INTEGER NOT NULL DEFAULT 0,
  level            INTEGER NOT NULL DEFAULT 1,
  gold             INTEGER NOT NULL DEFAULT 0,
  map_id           INTEGER,                      -- NULL = not placed on any map
  x                REAL,                         -- continuous position, px of map art
  y                REAL,
  actions_per_turn INTEGER NOT NULL DEFAULT 3,  -- legacy: turn counters left the UI
  actions_remaining INTEGER NOT NULL DEFAULT 3, -- (kept so old databases load unchanged)
  carry_capacity   REAL NOT NULL DEFAULT 30,
  vision_radius    INTEGER NOT NULL DEFAULT 15,  -- meters
  token_color      TEXT NOT NULL DEFAULT '#4f8ef7',
  token_scale      REAL NOT NULL DEFAULT 1,      -- size vs the map's default token
  token_shape      TEXT NOT NULL DEFAULT 'circle', -- circle|square|free (raw image)
  portrait         TEXT,                         -- "art": shown on sheets, not the map
  token            TEXT                          -- map token image (png the player uploads)
);

-- Free-form abilities written by the player (or DM).
CREATE TABLE IF NOT EXISTS powers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  circle       INTEGER NOT NULL DEFAULT 0  -- "circle" = spell level/tier (0 = none)
);

-- Diaries: character_id NULL = the Dungeon Master's own diary.
CREATE TABLE IF NOT EXISTS diary_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Uploaded pictures the DM can flash on the TV (letters, portraits, scenes).
CREATE TABLE IF NOT EXISTS images (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'item',      -- item|consumable|weapon|armor|lore|campaign
  measure     TEXT NOT NULL DEFAULT 'unit',      -- unit|liter|meter (weight is per measure)
  weight      REAL NOT NULL DEFAULT 0,
  value       INTEGER NOT NULL DEFAULT 0,
  damage      TEXT,                              -- weapons: e.g. "1d8+2"
  range       REAL,                              -- weapons: meters (rings on the DM map)
  armor       INTEGER,                           -- armor pieces: armor value
  lore_text   TEXT,                              -- lore/campaign items: the story itself
  image       TEXT,                              -- art shown in item detail
  icon        TEXT,
  tags        TEXT NOT NULL DEFAULT '[]'         -- JSON [string]; rarity tags weight chest rolls
);

CREATE TABLE IF NOT EXISTS inventory_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('character','chest','shop')),
  owner_id      INTEGER NOT NULL,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL DEFAULT 1,
  price         INTEGER,                          -- shops only: current list price
  sold_recently INTEGER NOT NULL DEFAULT 0        -- shops only: player-sold, may vanish on day tick
);
CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory_entries(owner_type, owner_id);

-- The map is CONTINUOUS: no grid. `scale` (px per meter, ruler tool) anchors
-- distances; `mobility` is the scene's movement multiplier / time step;
-- `token_scale` sizes this map's default token relative to TOKEN_METERS.
-- reveal_map / reveal_vision are the reversible party-wide fog overrides.
CREATE TABLE IF NOT EXISTS maps (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  image            TEXT,                          -- /uploads/... path of background art
  image_w          INTEGER NOT NULL DEFAULT 1600,
  image_h          INTEGER NOT NULL DEFAULT 1000,
  scale            REAL NOT NULL DEFAULT 20,      -- pixels per meter (ruler tool)
  mobility         REAL NOT NULL DEFAULT 1,
  visibility       REAL NOT NULL DEFAULT 1,       -- luminosity: multiplies every vision radius
  token_scale      REAL NOT NULL DEFAULT 1,
  icon_scale       REAL NOT NULL DEFAULT 1,       -- doors/chests/shops icon size on this map
  is_template      INTEGER NOT NULL DEFAULT 0,    -- library map (houses, dungeons): hidden from play
  is_world         INTEGER NOT NULL DEFAULT 0,    -- THE kingdom map: tokens derive from world_x/y
  is_dungeon       INTEGER NOT NULL DEFAULT 0,    -- party TV frames only the explored area (grows as they go)
  world_x          REAL,                          -- this map's marker on the world map
  world_y          REAL,
  reveal_map       INTEGER NOT NULL DEFAULT 0,    -- everyone remembers the whole layout
  reveal_vision    INTEGER NOT NULL DEFAULT 0,    -- everyone sees everything, live
  default_track_id INTEGER                        -- music that starts when shown on TV
);

-- Weather looks for one map: same strokes, doors, chests and fog — only the
-- background image (and the light) changes. "Night", "Snow", "Day" are
-- snapshots of {image, visibility} the DM applies from the Live tab.
CREATE TABLE IF NOT EXISTS map_variants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id     INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  image      TEXT,
  visibility REAL NOT NULL DEFAULT 1
);

-- Painted physics. kind: wall (move+sight) | sight (sight only) |
-- cliff (one-way movement barrier, `flipped` mirrors the allowed direction).
-- tool: brush|line|rect; points: JSON [[x,y],...]; width in px.
CREATE TABLE IF NOT EXISTS strokes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id  INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('wall','sight','cliff')),
  tool    TEXT NOT NULL DEFAULT 'brush',
  points  TEXT NOT NULL,
  width   REAL NOT NULL DEFAULT 10,
  flipped INTEGER NOT NULL DEFAULT 0
);

-- The DM's private sticky notes, pinned to a map point. Rendered as callout
-- boxes (open) or small pins (folded) on DM views only — never sent to the
-- TV or players. box_dx/box_dy = where the DM dragged the callout box,
-- relative to its anchor (NULL = auto-placed); the anchor itself never moves.
CREATE TABLE IF NOT EXISTS annotations (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x      REAL NOT NULL,
  y      REAL NOT NULL,
  text   TEXT NOT NULL DEFAULT '',
  open   INTEGER NOT NULL DEFAULT 1,
  box_dx REAL,
  box_dy REAL
);

-- One-way portal placed at a point; the editor offers to create the reverse
-- edge in the same click, which stores a second row.
CREATE TABLE IF NOT EXISTS connections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id        INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x             REAL NOT NULL,
  y             REAL NOT NULL,
  target_map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  target_x      REAL NOT NULL,
  target_y      REAL NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  -- when set, going through this door plays a kingdom-map journey (walk the
  -- world map, uncover the route) before the destination appears on the TV
  world_travel  INTEGER NOT NULL DEFAULT 0
);

-- Bestiary: reusable monster definitions the DM spawns instances from.
CREATE TABLE IF NOT EXISTS monster_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  icon        TEXT,
  art         TEXT,
  stats       TEXT NOT NULL DEFAULT '{}',
  hp          INTEGER NOT NULL DEFAULT 10,
  notes       TEXT NOT NULL DEFAULT '',
  token_scale REAL NOT NULL DEFAULT 1,
  token_shape TEXT NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS monsters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,                    -- always visible on the TV
  icon          TEXT,                             -- map token image
  art           TEXT,                             -- portrait/art (DM panel)
  stats         TEXT NOT NULL DEFAULT '{}',       -- JSON, DM-only
  hp            INTEGER NOT NULL DEFAULT 10,
  max_hp        INTEGER NOT NULL DEFAULT 10,
  notes         TEXT NOT NULL DEFAULT '',
  map_id        INTEGER REFERENCES maps(id) ON DELETE SET NULL,
  x             REAL,
  y             REAL,
  token_scale   REAL NOT NULL DEFAULT 1,
  token_shape   TEXT NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS chests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id     INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  icon       TEXT,                                -- token image (default chest art if NULL)
  state      TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','opened')),
  -- Set the first time any party member observes the chest's spot; memory-fog
  -- only draws discovered chests, so loot added behind the party stays hidden.
  discovered INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0           -- DM-only until revealed, whatever the fog says
);

CREATE TABLE IF NOT EXISTS shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  npc_name    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'general',    -- seller type (gameRules SELLER_TYPES)
  icon        TEXT,
  map_id      INTEGER REFERENCES maps(id) ON DELETE SET NULL,
  x           REAL,
  y           REAL
);

CREATE TABLE IF NOT EXISTS npcs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  portrait    TEXT,                               -- art (can be shown on the TV)
  token       TEXT,                               -- map token image
  map_id      INTEGER REFERENCES maps(id) ON DELETE SET NULL,
  x           REAL,
  y           REAL,
  token_scale REAL NOT NULL DEFAULT 1,
  token_shape TEXT NOT NULL DEFAULT 'free',
  notes       TEXT NOT NULL DEFAULT ''            -- DM only
);

CREATE TABLE IF NOT EXISTS tracks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id     INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file       TEXT NOT NULL DEFAULT '',            -- legacy uploaded audio
  youtube_id TEXT                                 -- preferred: YouTube video id
);

-- Soundboard: short uploaded audio files the DM can fire during play.
CREATE TABLE IF NOT EXISTS sounds (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file TEXT NOT NULL
);

-- Per-character "has ever seen this fog cell" memory (cell coords, see
-- server/grid.js). "Currently observing" is always computed live.
CREATE TABLE IF NOT EXISTS fog_seen (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  map_id       INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  q            INTEGER NOT NULL,                  -- cell x
  r            INTEGER NOT NULL,                  -- cell y
  PRIMARY KEY (character_id, map_id, q, r)
);
