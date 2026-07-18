// ---------------------------------------------------------------------------
// All tunable campaign rules live in this one file. Tweak numbers freely;
// every formula below is intentionally simple and explicit.
// ---------------------------------------------------------------------------

// Default stat block (editable at runtime in DM > Settings; stored in DB).
export const DEFAULT_STAT_BLOCK = [
  { key: 'str', label: 'Strength' },
  { key: 'dex', label: 'Dexterity' },
  { key: 'con', label: 'Constitution' },
  { key: 'int', label: 'Intelligence' },
  { key: 'wis', label: 'Wisdom' },
  { key: 'cha', label: 'Charisma' },
];

// --- World scale ---------------------------------------------------------------
// The map is continuous. A map's ruler calibration (`scale` = pixels per
// meter) anchors every real-world quantity. Fog of war is bookkept on an
// internal square lattice of FOG_CELL_METERS (never drawn as a grid), and a
// "standard" token is TOKEN_METERS across before map/entity size multipliers.
export const FOG_CELL_METERS = 1;
// A default character token is TOKEN_METERS tall/wide on the map — its pixel
// size follows the ruler scale, but the CLAMPS live in screen pixels and
// track the zoom: zoom far out and a token stops shrinking at
// TOKEN_MIN_SCREEN_PX (always findable); zoom far in and it stops growing at
// TOKEN_MAX_VIEW_FRACTION of the viewport (never swallows the screen). In
// between, tokens are world-true. Characters, NPCs and monsters all size
// through this same clamp.
export const TOKEN_METERS = 0.5;
export const TOKEN_MIN_SCREEN_PX = 26;       // on-screen floor, at any zoom
export const TOKEN_MAX_VIEW_FRACTION = 0.2;  // on-screen cap: fraction of the smaller viewport side
// Server-side spacing (kingdom clusters, door arrivals) can't know anyone's
// zoom; it spaces by the size a token has at TOKEN_MIN_SCALE px per meter.
export const TOKEN_MIN_SCALE = 50;
export const TOKEN_MIN_PX = TOKEN_METERS * TOKEN_MIN_SCALE;
export const TOKEN_MAX_FRACTION = 0.18;      // server-side cap: fraction of map width
// Map ICONS (doors, chests, shops) are NOT world-sized: they render at a fixed
// ICON_PX (image pixels) × the map's icon_scale (editor), on every map.
export const ICON_PX = 46;
// How close (meters) a dropped token must land to a door/chest/shop to trigger it.
export const TRIGGER_RADIUS_METERS = 1.2;
// Kingdom/world map: entering a located map permanently uncovers a circle of
// this radius (meters, at the WORLD map's scale) around its marker.
export const WORLD_REVEAL_METERS = 60;

// --- Vision / fog of war -------------------------------------------------------
// vision_radius is in METERS (per character, DM-editable). Hexes marked
// "blocks sight" stop the line of sight; the blocking hex itself is visible.
export const VISION_METERS_DEFAULT = 30;

// --- Movement budget -------------------------------------------------------------
// One action grants this many METERS of movement:
//   meters = ( MOVE_BASE_METERS
//            + (str-10)/MOVE_STAT_DIVISOR + (dex-10)/MOVE_STAT_DIVISOR  (floored)
//            - overloadPenalty ) * mapMobility
//   overloadPenalty = ceil((carried - capacity) / OVERLOAD_STEP) if over capacity
// `mapMobility` is the map's mobility score — the "time step" of the scene:
// combat maps ~1, interiors ~2, streets/overland ~3+.
// On the continuous map this is simply the radius (in meters) a character can
// walk per action — the DM overlay draws it as circles.
export const MOVE_BASE_METERS = 4;
export const MOVE_STAT_BASELINE = 10;
export const MOVE_STAT_DIVISOR = 4;   // +1 m per this many stat points above baseline
export const OVERLOAD_STEP = 5;       // -1 m per started 5 weight over capacity

export function metersPerAction(stats = {}, carriedWeight = 0, capacity = 0, mapMobility = 1) {
  const bonus = (v) => Math.floor(((v ?? MOVE_STAT_BASELINE) - MOVE_STAT_BASELINE) / MOVE_STAT_DIVISOR);
  let meters = MOVE_BASE_METERS + bonus(stats.str) + bonus(stats.dex);
  if (carriedWeight > capacity) meters -= Math.ceil((carriedWeight - capacity) / OVERLOAD_STEP);
  return Math.max(0, meters * (mapMobility || 1));
}

// Default carry capacity assigned when a character is created (DM can override).
export function defaultCapacity(str = 10) {
  return 10 + 2 * str;
}

// --- Shop economy ------------------------------------------------------------------
// Shops list items at the item's value (or a DM-set price). Players sell at
// SHOP_BUY_FACTOR of the current list price — the trade UI shows the payout
// before selling. Player-sold stacks are flagged "sold recently": on each
// "Advance shop day" they vanish with SHOP_DISAPPEAR_CHANCE (bought off-screen).
export const SHOP_BUY_FACTOR = 0.5;
export const SHOP_DISAPPEAR_CHANCE = 0.25;

export function shopBuyPrice(listPrice) {
  return Math.max(0, Math.floor((listPrice || 0) * SHOP_BUY_FACTOR));
}

// --- Chest auto-generation ------------------------------------------------------------
// Items are weighted by rarity tag; untagged items count as "common".
// Lore items are never rolled — the DM places those by hand.
export const RARITY_WEIGHTS = { common: 60, uncommon: 30, rare: 10 };

export function rarityOf(tags = []) {
  for (const t of tags) if (t in RARITY_WEIGHTS) return t;
  return 'common';
}

// --- Item categories -------------------------------------------------------------------
// consumable / item  -> measured in units, liters or meters; weight is per measure
// weapon             -> damage dice + range in meters (range rings on the DM map)
// armor              -> armor value; a character's total armor sits next to HP
// lore               -> story items (letters, relics) with their own long text;
//                       CAN be stocked in shops, never auto-rolled in chests
// campaign           -> DM-only story items: players cannot add them to their own
//                       bag and shops/chest rolls never produce them
export const ITEM_CATEGORIES = ['item', 'consumable', 'weapon', 'armor', 'lore', 'campaign'];
export const MEASURES = ['unit', 'liter', 'meter'];

// --- Gear generation (weapons & armor) --------------------------------------
// Weapons AND armor are ROLLED from a per-category "profile" and scored by a
// numeric RANK. Rank sets the gp value and how rarely strong pieces appear in
// restocks; where a roll lands inside its category's rank span names its rarity
// (common/uncommon/rare — the same tags chest rolls weight by). Names come from
// weapon-names.json / armor-names.json. EVERY number below is a default the DM
// can override from Settings, which is why the roll fns take a `gen` object.
//
//   weapon rank = avgDamage + range(m) × rangeCoef
//   armor  rank = armor value (defence is the whole story)
//   value(gp)   = max(1, round(rank² × valueFactor))
//   rarity      = rare at ≥ rareAt of the span · uncommon at ≥ uncommonAt · else common
export const WEAPON_GEN_DEFAULT = {
  bonusMax: 3,        // random +0..bonusMax damage (quality)
  rangeCoef: 0.12,    // how much reach adds to rank
  valueFactor: 1.6,   // gp = round(rank² × this)
  rareAt: 0.75,
  uncommonAt: 0.45,
  // per category: dice options [n, sides], range [min,max] m, weight [min,max] kg
  profiles: {
    dagger:   { range: [1, 1],   dice: [[1, 4], [2, 3]],          weight: [0.3, 1] },
    sword:    { range: [1, 2],   dice: [[1, 6], [1, 8], [2, 4]],  weight: [1.5, 4] },
    axe:      { range: [1, 2],   dice: [[1, 8], [1, 10], [2, 5]], weight: [2, 5] },
    mace:     { range: [1, 1],   dice: [[1, 6], [1, 8], [2, 4]],  weight: [2, 5] },
    spear:    { range: [2, 3],   dice: [[1, 6], [1, 8]],          weight: [1.5, 3] },
    polearm:  { range: [2, 4],   dice: [[1, 10], [2, 5], [2, 6]], weight: [3, 7] },
    bow:      { range: [20, 60], dice: [[1, 6], [1, 8]],          weight: [1, 2] },
    crossbow: { range: [15, 40], dice: [[1, 8], [1, 10], [2, 5]], weight: [2.5, 6] },
    thrown:   { range: [8, 15],  dice: [[1, 4], [1, 6]],          weight: [0.5, 2] },
    staff:    { range: [1, 2],   dice: [[1, 6], [2, 3]],          weight: [1.5, 4] },
  },
};

export const ARMOR_GEN_DEFAULT = {
  bonusMax: 2,        // random +0..bonusMax armor (quality)
  valueFactor: 2.4,   // gp = round(rank² × this)
  rareAt: 0.75,
  uncommonAt: 0.45,
  // per category: armor value [min,max], weight [min,max] kg
  profiles: {
    padded:  { armor: [1, 2], weight: [3, 6] },
    leather: { armor: [2, 3], weight: [5, 9] },
    hide:    { armor: [2, 4], weight: [8, 13] },
    mail:    { armor: [3, 5], weight: [12, 20] },
    plate:   { armor: [5, 8], weight: [20, 30] },
    shield:  { armor: [1, 3], weight: [3, 7] },
  },
};

// Back-compat aliases (older imports / tests read these directly).
export const WEAPON_PROFILES = WEAPON_GEN_DEFAULT.profiles;
export const WEAPON_BONUS_MAX = WEAPON_GEN_DEFAULT.bonusMax;

// --- Seller types ----------------------------------------------------------------
// A shop's category keeps its stock coherent: random restocks draw only from the
// listed weapon / armor categories (null = all of them, [] = deals in none).
export const SELLER_TYPES = {
  general:   { label: 'General store', weapons: null, armor: null },
  armory:    { label: 'Armory', weapons: ['sword', 'axe', 'mace', 'polearm', 'spear'], armor: ['padded', 'leather', 'hide', 'mail', 'plate', 'shield'] },
  swordsman: { label: 'Swordsman', weapons: ['sword', 'dagger'], armor: [] },
  bowman:    { label: 'Bowman', weapons: ['bow', 'crossbow', 'thrown'], armor: ['padded', 'leather'] },
  potions:   { label: 'Potions & herbs', weapons: [], armor: [] },
  smith:     { label: 'Blacksmith', weapons: ['axe', 'mace', 'dagger', 'sword'], armor: ['mail', 'plate', 'shield'] },
};

const randIn = ([lo, hi]) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const firstProfile = (gen) => Object.values(gen.profiles)[0];

export function avgDamage(n, sides, bonus) {
  return n * (sides + 1) / 2 + bonus;
}

function rarityFromSpan(rank, lo, hi, gen) {
  const t = hi > lo ? (rank - lo) / (hi - lo) : 0;
  return t >= gen.rareAt ? 'rare' : t >= gen.uncommonAt ? 'uncommon' : 'common';
}

// ---- weapons ----
export function weaponRank(avg, rangeMeters, gen = WEAPON_GEN_DEFAULT) {
  return avg + rangeMeters * gen.rangeCoef;
}
export function weaponValue(rank, gen = WEAPON_GEN_DEFAULT) {
  return Math.max(1, Math.round(rank * rank * gen.valueFactor));
}
// The lowest and highest rank a category can possibly roll.
export function rankBounds(category, gen = WEAPON_GEN_DEFAULT) {
  const p = gen.profiles[category] || firstProfile(gen);
  const avgs = p.dice.map(([n, s]) => avgDamage(n, s, 0));
  return [
    weaponRank(Math.min(...avgs), p.range[0], gen),
    weaponRank(Math.max(...avgs) + gen.bonusMax, p.range[1], gen),
  ];
}
// A "rare dagger" is an exceptional dagger, not a mislabeled sword: rarity is
// relative to the category's own span.
export function weaponRarity(rank, category, gen = WEAPON_GEN_DEFAULT) {
  const [lo, hi] = rankBounds(category, gen);
  return rarityFromSpan(rank, lo, hi, gen);
}
export function rollWeapon(name, category, gen = WEAPON_GEN_DEFAULT) {
  const profile = gen.profiles[category] || firstProfile(gen);
  const [n, sides] = pick(profile.dice);
  const bonus = Math.floor(Math.random() * (gen.bonusMax + 1));
  const range = Math.round(randIn(profile.range));
  const weight = Math.round(randIn(profile.weight) * 10) / 10;
  const avg = avgDamage(n, sides, bonus);
  const rank = weaponRank(avg, range, gen);
  const rarity = weaponRarity(rank, category, gen);
  return {
    name, category: 'weapon',
    damage: `${n}d${sides}${bonus ? `+${bonus}` : ''}`,
    range, weight,
    value: weaponValue(rank, gen),
    rank: Math.round(rank * 10) / 10, rarity,
    tags: ['weapon', category, rarity],
  };
}

// ---- armor ----
export function armorValue(rank, gen = ARMOR_GEN_DEFAULT) {
  return Math.max(1, Math.round(rank * rank * gen.valueFactor));
}
export function armorRankBounds(category, gen = ARMOR_GEN_DEFAULT) {
  const p = gen.profiles[category] || firstProfile(gen);
  return [p.armor[0], p.armor[1] + gen.bonusMax];
}
export function armorRarity(rank, category, gen = ARMOR_GEN_DEFAULT) {
  const [lo, hi] = armorRankBounds(category, gen);
  return rarityFromSpan(rank, lo, hi, gen);
}
export function rollArmor(name, category, gen = ARMOR_GEN_DEFAULT) {
  const profile = gen.profiles[category] || firstProfile(gen);
  const base = Math.round(randIn(profile.armor));
  const bonus = Math.floor(Math.random() * (gen.bonusMax + 1));
  const armor = base + bonus;
  const weight = Math.round(randIn(profile.weight) * 10) / 10;
  const rank = armor; // the armor value IS the rank
  const rarity = armorRarity(rank, category, gen);
  return {
    name, category: 'armor', armor, weight,
    value: armorValue(rank, gen),
    rank: Math.round(rank * 10) / 10, rarity,
    tags: ['armor', category, rarity],
  };
}

// Weighted pick for restocks: weaker pieces common, strong ones rare.
export function pickByRank(candidates) {
  const weights = candidates.map((c) => 1 / Math.max(0.25, c.rank * c.rank));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
