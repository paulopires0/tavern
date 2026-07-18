# Tavern — tabletop campaign companion

A 99.9999% vibe coded (I did write the prompts :D) self-hosted web app for running a homebrew medieval campaign in person:

- **Player view** (phones) — each player logs in with their character name + password and runs their own sheet like paper: HP, gold, armor, stats, bag, powers and a personal diary are all self-editable, live-synced. Players upload their own **art** (sheet picture) and **map token** (the PNG that walks the map).
- **Party / TV view** (shared screen) — the active map in an ornamented frame with fog of war, image tokens, zoom controls, DM-pushed picture overlays (found letters, NPC faces) and the campaign music. No login: unguessable spectator link.
- **DM view** (laptop/tablet) — live map with draggable tokens, ruler-calibrated map editor, roster, monsters, chests, shops with randomized weapon stock, NPCs, image library, YouTube music, DM diary.

One URL for everything (`http://<server-ip>:8030`) — what you see is decided by how you log in.

## Quick start

```bash
npm install                 # server deps
npm --prefix client install # client deps
npm run build               # build the web client
npm run seed                # optional: demo campaign
npm start                   # serves everything on PORT (default 8030)
```

The console prints the LAN URL for players plus the TV spectator link.
Demo logins after seeding: characters `Aria/Bram/Cael/Dunn`, password `1234`; DM password `dm1234`.

Dev: `npm run dev-server` + `npm run dev-client` (Vite on :5173, proxied). Tests: `npm test`.

### Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8030` | HTTP + websocket port |
| `DATA_DIR` | `./data` | SQLite DB, uploads, generated session secret |
| `DB_PATH` | `$DATA_DIR/tavern.db` | SQLite file |
| `DM_PASSWORD` | `dm1234` | **change this** — the DM login |
| `SESSION_SECRET` | generated, persisted | HMAC key for login tokens |

## The continuous map

There is no grid. Maps are the art itself; every distance is real meters:

- **Scale** (pixels per meter): set with the editor's **Ruler** tool — click two
  points whose real distance you know ("this door is 2 m"), type the meters.
- **Mobility score**: the scene's time step, shown next to the map name as a
  reference for the DM's own movement rulings (combat ~1, interiors ~2,
  streets/overland ~3). No overlay is drawn — selecting a character shows only
  their **weapon-range ring** (defaults to their longest weapon).
- **Visibility (light level)**: per-map multiplier on every character's vision
  radius (1 = daylight, 0.3 = night, 2 = a watchtower). Set the map's normal
  value in the editor; the Live tab has a slider to dim or brighten mid-scene.
- **Weather**: one map, many looks. Save the current background image +
  visibility under a name ("Day", "Night", "Snow" — editor, Weather section;
  upload same-sized images for the variants). Switching weather from the Live
  tab swaps ONLY the art and the light — walls, doors, chests, tokens and
  explored fog all stay.
- **Tokens follow the zoom** but clamp in screen pixels: zoom far out and a
  token stops shrinking (always findable), zoom far in and it stops growing
  (never swallows the screen); in between it is true to its world size.
- **Painted physics** (editor, brush / straight line / rectangle, width slider):
  - **Wall** — blocks movement and sight. Dragging a token across one is refused.
  - **Curtain** — blocks sight only.
  - **Cliff** — one-way barrier: arrows show the only allowed crossing direction
    (hop down, never climb back). "Flip last cliff" reverses it. Enforced on drags.
- **Fog of war** is bookkept on an invisible 1 m lattice but DRAWN as one
  continuous veil (never a grid): unexplored ground is near-black, explored-but-
  unwatched ground dims under a light grey wash. Per character Unknown →
  Observing → Previously-seen; the TV shows the party union. Two reversible
  overrides per map: **Give map** (everyone remembers the whole layout) and
  **Give vision** (everyone sees everything, live) — switching them off returns
  to what was actually observed.
- **DM notes**: pin private sticky notes anywhere on a map from the Live tab —
  parchment callouts with a line pointing at the spot, folded to a small pin
  with a click. Drag an open card wherever it reads best (even off the map
  art, onto the table) — the line keeps pointing at the pinned spot. Players
  and the TV never receive them.
- **Pan by dragging, zoom with the wheel** (or the +/−/fit buttons), the same on
  the TV and the DM views. Zoom out past the art: the world beyond is a wooden
  table (maps with no image are just the table).
- **Doors**: pick the DESTINATION first on a preview of the target map, then
  click where the door sits. Tokens dropped on the marker travel — characters
  and monsters alike. **Shift-click** selects several tokens; dragging any of
  them moves the whole group, and dropping the dragged one on a door carries
  the whole selection through together (they arrive huddled at the exit).
- **Kingdom map**: mark one map as the kingdom (editor checkbox) and give the
  other maps a location on it. It shows ONLY the party — each player token
  stands where their current map lies (no map markers, no other objects), and
  co-located players huddle together. Entering a located map permanently
  uncovers the ground around it; there is no memory-dimming up there.

## Tokens & art (no emoji, ever)

Every entity has real images. Every token/art upload (characters, NPCs,
monsters, bestiary) opens a **crop dialog**: drag the square over the part of
the picture you want, size it with the slider, or keep the whole image.

| Entity | Map token | Art (sheets/panels) |
| --- | --- | --- |
| Character | uploaded by the player (or DM) | uploaded by the player (or DM) |
| NPC | `data/uploads/npc-token/` | `data/uploads/npc-art/` |
| Monster | `data/uploads/monster-token/` | `data/uploads/monster-art/` |
| Chest | per-chest image or `chest-token` default | — |
| Shop | coin-stack default (`shop-token`) | — |
| Door / passage | drawn: rotated rounded square, bright with dark edge | — |

New NPCs/monsters/chests start with a **default image**. To supply your own
defaults, drop a file named `default.png` (or .jpg/.webp/.svg) into the matching
`data/uploads/<kind>/` folder — it instantly replaces the generated placeholder
(the stable URL `/uploads/<kind>/default` picks the best file present).
Monster names are always visible on the TV, and monsters travel through doors
just like characters. Tokens draw without borders or clipping at
`TOKEN_METERS × map scale × map token-size × entity token-size` — the map's
default token size lives in the editor, and every character (from their own
sheet, with a live preview), monster and NPC has its own multiplier.

## Items

Five categories, each with its own fields (Items tab):

- **item / consumable** — measured per `unit`, `liter` or `meter`; weight is per measure.
- **weapon** — damage (e.g. `1d8+2`) and range in meters. Select a character on
  the live map and pick a weapon to see its **range ring** drawn on the map.
- **armor** — armor value; a character's total **Armor** stat sits next to HP.
- **lore** — hand-written story items (letters, relics) with their own long text
  and optional image. Players read them from their bag. Never rolled by chest
  auto-generation, but shops can stock them.
- **campaign** — DM-only story items: players cannot add them to their own bags
  and shops/chest rolls never produce them; only the DM hands them out.

### Sellers & random stock

Every shop has a **seller type** (general, armory, swordsman, bowman,
potions & herbs, blacksmith — `SELLER_TYPES` in gameRules). **Restock weapons**
and **Restock armor** only draw names whose category fits the seller: a bowman
stocks bows/crossbows/thrown and light armor; a potion seller refuses both.
`weapon-names.json` and `armor-names.json` (project root) are plain
`{name, category}` lists — add as many as you like.

Both weapons and armor are ROLLED from a per-category profile and scored by a
numeric **rank** (weapon: `avg damage + range × coef`; armor: the armor value).
Rank sets the gp value (`rank² × factor`) and the restock weight (`1/rank²` —
strong pieces are expensive *and* rare). Rank stays internal: each piece is
labeled **common / uncommon / rare** relative to its OWN category (a rare
dagger is an exceptional dagger), the same rarity tags chest rolls weight by.
**Every one of those generation numbers — dice, ranges, weights, the rank/value
coefficients and rarity thresholds — is editable in DM → Settings** (no code
edit needed). Rolled gear arrives with an empty description — use **Items →
Export gear without lore** plus `prompts/generate-gear-lore.md` to have an LLM
write stories that match each rarity, then **Import gear-lore.json**.

### Shop economy

Shops list items at value (or DM-set price). Players sell at **50%** of list —
the trade dialog shows the exact payout on each sell button. Player-sold stacks
are flagged and may vanish (25%) on each **Advance shop day**. No price bumps.

## Music & sounds

Paste any YouTube link in the Music tab (per map). The **TV plays audio only**
(the player is parked offscreen; one tap after loading, internet needed).
Each map can have a **default track** that auto-starts when the map is shown on
the TV, and the Live tab sidebar has quick play/pause/switch controls plus the
**soundboard**: uploaded one-shot sounds (door slam, thunder…) fired straight
to the TV.

## TV extras

- Drag to pan, wheel to zoom (plus +/−/fit buttons); the art sits framed on a
  wooden table you can zoom out to.
- **Image overlays**: the Images tab uploads pictures ("Smuggler's letter") and
  flashes them over the party screen; NPCs have a one-click **Show face on TV**.

## Diaries & powers

- Every character has a private **diary** (title + body entries) and a
  **powers** list, both written by the player from their phone.
- The DM has their own diary tab (never visible to players).

## Design notes & assumptions

- **Sync model**: every mutation rebuilds and pushes each connected client's
  tailored state over Socket.IO — simple and impossible to drift.
- **Fog of war** per character: Unknown → Observing → Previously-seen (never
  back). TV shows the party union; memory shows layout only, monsters and NPCs
  only while currently observed, chests once discovered (Give vision overrides).
- **TV access** is an unguessable link (shown in DM → Settings); anyone on the
  LAN with the link can watch.
- **Players can edit everything on their own sheet** by design — this tool helps
  the DM run the table and keeps things stored; it doesn't police the players.
- **No turn bookkeeping**: the app never counts actions — movement and turns
  are the DM's rulings at the table.
- **Security model**: LAN app for one table of friends. Character passwords are
  plaintext so the DM can remind players; don't expose this to the internet.
- Old v1 databases migrate automatically (new columns added on boot); the demo
  can always be rebuilt with `npm run seed -- --force`.

## Project layout

```
server/            Express + Socket.IO + better-sqlite3 (schema.sql = source of truth)
  grid.js          fog-cell lattice derived from each map's ruler scale
  vision.js        continuous line-of-sight over painted strokes (pure, tested)
  fog.js           per-character memory + party union + reveal overrides
  state.js         per-viewer payloads + broadcast
  routes-dm.js     every DM action; routes-player.js = player self-service
  defaults.js      generated placeholder token art + default.* resolution
shared/            geometry.js (segments, LOS, walls, one-way cliffs)
                   + gameRules.js (ALL tunables) — used by server and client
weapon-names.json  your big weapon list ({name, category}) for random stock
client/            React + Vite; MapCanvas.jsx renders every map
data/              SQLite DB + uploads (back this up)
test/              node --test: geometry/vision units + full-stack socket e2e
```
