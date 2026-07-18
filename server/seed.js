// Demo campaign seed (continuous maps): two connected maps, painted walls and
// a one-way cliff, four characters, categorized items incl. a lore letter and
// a campaign item, a typed shop, a monster, an NPC, powers, diaries, a
// soundboard chime and a default track.
// Run: npm run seed   (refuses to run twice unless --force)
import fs from 'node:fs';
import path from 'node:path';
import { db, setConfig, addToInventory } from './db.js';
import { UPLOADS_DIR } from './config.js';
import { ensureDefaultArt, defaultUrl } from './defaults.js';
import { defaultCapacity } from '../shared/gameRules.js';

const force = process.argv.includes('--force');
if (db.prepare('SELECT COUNT(*) AS n FROM characters').get().n > 0 && !force) {
  console.log('Database already has characters; use --force to wipe and reseed.');
  process.exit(1);
}

ensureDefaultArt();

const wipe = db.transaction(() => {
  for (const t of ['fog_seen', 'inventory_entries', 'tracks', 'sounds', 'npcs', 'shops', 'chests',
    'monsters', 'connections', 'strokes', 'maps', 'items', 'powers', 'diary_entries',
    'images', 'characters']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});
wipe();
setConfig('shop_session', null);
setConfig('music', { trackId: null, playing: false });
setConfig('shop_day', 0);
setConfig('tv_overlay', null);
setConfig('sfx', null);

// --- demo map art: simple SVGs written straight into uploads -----------------
function writeSvg(name, w, h, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  fs.writeFileSync(path.join(UPLOADS_DIR, 'maps', name), svg);
  return `/uploads/maps/${name}`;
}

const tavernImg = writeSvg('demo-tavern.svg', 1200, 800, `
  <rect width="1200" height="800" fill="#2b2119"/>
  <rect x="60" y="60" width="1080" height="680" fill="#4a3524" rx="18"/>
  <rect x="90" y="90" width="1020" height="620" fill="#5d4430" rx="10"/>
  <rect x="150" y="150" width="260" height="140" fill="#3a2b1d" rx="8"/>
  <text x="280" y="228" fill="#c9a86a" font-size="34" text-anchor="middle" font-family="serif">Bar</text>
  <circle cx="700" cy="300" r="70" fill="#3a2b1d"/>
  <circle cx="950" cy="520" r="70" fill="#3a2b1d"/>
  <circle cx="450" cy="550" r="70" fill="#3a2b1d"/>
  <rect x="1020" y="330" width="90" height="120" fill="#241a10" rx="6"/>
  <text x="1065" y="400" fill="#c9a86a" font-size="20" text-anchor="middle" font-family="serif">Stairs</text>
  <text x="600" y="70" fill="#c9a86a88" font-size="26" text-anchor="middle" font-family="serif">The Gilded Flagon — demo art, replace via Maps tab</text>
`);

const cellarImg = writeSvg('demo-cellar.svg', 900, 700, `
  <rect width="900" height="700" fill="#12151c"/>
  <rect x="50" y="50" width="800" height="600" fill="#232a38" rx="14"/>
  <rect x="80" y="80" width="740" height="540" fill="#2c3547" rx="8"/>
  <rect x="120" y="120" width="180" height="100" fill="#1a202c"/>
  <rect x="600" y="450" width="180" height="100" fill="#1a202c"/>
  <text x="450" y="46" fill="#8fa3c8" font-size="24" text-anchor="middle" font-family="serif">The Cellar — demo art</text>
`);

// --- a short soundboard chime (valid WAV) -------------------------------------
function writeChime() {
  const rate = 22050, seconds = 1.2, n = Math.floor(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.exp(-4 * t);
    const v = env * 0.4 * (Math.sin(2 * Math.PI * 660 * t) + 0.6 * Math.sin(2 * Math.PI * 990 * t));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(UPLOADS_DIR, 'music', 'chime.wav'), Buffer.concat([header, data]));
  return '/uploads/music/chime.wav';
}
const chimeFile = writeChime();

// --- maps ---------------------------------------------------------------------
// scale = px per meter (ruler tool). mobility 2 = indoor pacing.
const tavernId = db.prepare(`INSERT INTO maps (name, image, image_w, image_h, scale, mobility)
  VALUES ('The Gilded Flagon', ?, 1200, 800, 40, 2)`).run(tavernImg).lastInsertRowid;
const cellarId = db.prepare(`INSERT INTO maps (name, image, image_w, image_h, scale, mobility)
  VALUES ('The Cellar', ?, 900, 700, 40, 1)`).run(cellarImg).lastInsertRowid;
setConfig('active_map_id', tavernId);

// Painted physics: an interior wall through the tavern and a one-way ledge in
// the cellar (you can hop down toward the south, not climb back).
const mkStroke = db.prepare(
  'INSERT INTO strokes (map_id, kind, tool, points, width, flipped) VALUES (?,?,?,?,?,?)'
);
mkStroke.run(tavernId, 'wall', 'line', JSON.stringify([[560, 120], [560, 430]]), 14, 0);
mkStroke.run(tavernId, 'sight', 'line', JSON.stringify([[150, 300], [410, 300]]), 10, 0); // bar curtain
mkStroke.run(cellarId, 'cliff', 'line', JSON.stringify([[120, 380], [700, 380]]), 10, 0);

// Stairs connect the two maps (both directions).
const conn = db.prepare('INSERT INTO connections (map_id, x, y, target_map_id, target_x, target_y, label) VALUES (?,?,?,?,?,?,?)');
conn.run(tavernId, 1065, 390, cellarId, 150, 160, 'Stairs down');
conn.run(cellarId, 150, 160, tavernId, 1000, 390, 'Stairs up');

// --- characters ------------------------------------------------------------------
const mkChar = db.prepare(`INSERT INTO characters
  (name, password, stats, hp, max_hp, armor, level, gold, map_id, x, y,
   actions_per_turn, actions_remaining, carry_capacity, vision_radius, token_color)
  VALUES (@name, @password, @stats, @hp, @hp, @armor, 1, @gold, @map_id, @x, @y, 3, 3, @cap, 15, @color)`);
const chars = [
  { name: 'Aria', password: '1234', stats: { str: 8, dex: 16, con: 10, int: 12, wis: 14, cha: 10 }, hp: 18, armor: 1, gold: 40, x: 250, y: 350, color: '#e4b343' },
  { name: 'Bram', password: '1234', stats: { str: 17, dex: 9, con: 15, int: 8, wis: 11, cha: 10 }, hp: 26, armor: 3, gold: 15, x: 320, y: 350, color: '#c0504d' },
  { name: 'Cael', password: '1234', stats: { str: 10, dex: 12, con: 12, int: 17, wis: 13, cha: 9 }, hp: 14, armor: 0, gold: 60, x: 250, y: 420, color: '#7e6bd9' },
  { name: 'Dunn', password: '1234', stats: { str: 13, dex: 10, con: 14, int: 10, wis: 16, cha: 13 }, hp: 20, armor: 2, gold: 25, x: 320, y: 420, color: '#4f9e64' },
];
const charIds = {};
for (const c of chars) {
  charIds[c.name] = mkChar.run({
    ...c, stats: JSON.stringify(c.stats), map_id: tavernId, cap: defaultCapacity(c.stats.str),
  }).lastInsertRowid;
}

const mkPower = db.prepare('INSERT INTO powers (character_id, name, description) VALUES (?,?,?)');
mkPower.run(charIds.Aria, 'Shadowstep', 'Once per fight, move without being seen.');
mkPower.run(charIds.Aria, 'Eagle eye', '+2 on ranged attacks in daylight.');
mkPower.run(charIds.Bram, 'Rage', 'Ignore the first 3 damage each fight.');
mkPower.run(charIds.Cael, 'Fire bolt', '1d10 fire damage, 20 m.');
mkPower.run(charIds.Dunn, 'Healing word', 'Heal an ally 1d4+2, 10 m.');

db.prepare('INSERT INTO diary_entries (character_id, title, body) VALUES (?,?,?)')
  .run(charIds.Aria, 'Day one', 'Arrived at the Gilded Flagon. The cellar smells wrong.');
db.prepare('INSERT INTO diary_entries (character_id, title, body) VALUES (NULL,?,?)')
  .run('Session 0 prep', 'Rat guards the ledge in the cellar. Old Tom knows about the noises.');

// --- items ----------------------------------------------------------------------------
const mkItem = db.prepare(`INSERT INTO items
  (name, description, category, measure, weight, value, damage, range, armor, lore_text, tags)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const I = (name, desc, cat, measure, w, v, extra = {}) =>
  mkItem.run(name, desc, cat, measure, w, v,
    extra.damage ?? null, extra.range ?? null, extra.armor ?? null, extra.lore ?? null,
    JSON.stringify(extra.tags ?? ['common'])).lastInsertRowid;

const itemIds = {};
itemIds['Shortbow'] = I('Shortbow', 'Simple hunting bow.', 'weapon', 'unit', 1.5, 25,
  { damage: '1d6', range: 25, tags: ['weapon', 'bow', 'common'] });
itemIds['Rusty shortsword'] = I('Rusty shortsword', 'Seen better decades.', 'weapon', 'unit', 2.5, 8,
  { damage: '1d6', range: 1, tags: ['weapon', 'sword', 'common'] });
itemIds['Chainmail shirt'] = I('Chainmail shirt', 'Clinks softly.', 'armor', 'unit', 20, 75,
  { armor: 3, tags: ['armor', 'uncommon'] });
itemIds['Leather jerkin'] = I('Leather jerkin', 'Broken-in and quiet.', 'armor', 'unit', 6, 20,
  { armor: 1, tags: ['armor', 'common'] });
itemIds['Healing potion'] = I('Healing potion', 'Restores 2d4+2 HP.', 'consumable', 'liter', 0.5, 50,
  { tags: ['consumable', 'uncommon'] });
itemIds['Lamp oil'] = I('Lamp oil', 'Burns bright.', 'consumable', 'liter', 1, 4,
  { tags: ['consumable', 'common'] });
itemIds['Iron rations'] = I('Iron rations', 'A day of dull food.', 'consumable', 'unit', 2, 5,
  { tags: ['consumable', 'common'] });
itemIds['Rope'] = I('Rope', 'Hemp rope, sold by the meter.', 'item', 'meter', 0.2, 1,
  { tags: ['gear', 'common'] });
itemIds['Torch'] = I('Torch', 'Burns for an hour.', 'item', 'unit', 1, 1, { tags: ['gear', 'common'] });
itemIds['Lockpicks'] = I('Lockpicks', 'Thieves love them.', 'item', 'unit', 0.2, 30,
  { tags: ['gear', 'uncommon'] });
itemIds['Silver ring'] = I('Silver ring', 'Worth more than it looks.', 'item', 'unit', 0.1, 40,
  { tags: ['valuable', 'uncommon'] });
itemIds['Sealed letter'] = I('Sealed letter', 'A wax-sealed letter, addressed to no one.', 'lore', 'unit', 0.1, 5,
  { lore: 'To whoever holds the Flagon:\n\nThe shipment sleeps under the third barrel. Do not light a torch near it. When the moon thins, the buyer comes wearing the innkeep’s face.\n\n— V.', tags: ['quest'] });
itemIds['Wolf-seal signet'] = I('Wolf-seal signet', 'A heavy ring bearing a wolf seal.', 'campaign', 'unit', 0.1, 0,
  { lore: 'Only the DM hands this out. Whoever wears it may pass the Wolfgate unchallenged.', tags: ['quest'] });

addToInventory('character', charIds.Aria, itemIds['Shortbow'], 1);
addToInventory('character', charIds.Aria, itemIds['Healing potion'], 2);
addToInventory('character', charIds.Bram, itemIds['Rusty shortsword'], 1);
addToInventory('character', charIds.Bram, itemIds['Chainmail shirt'], 1);
addToInventory('character', charIds.Bram, itemIds['Rope'], 10);
addToInventory('character', charIds.Cael, itemIds['Torch'], 3);
addToInventory('character', charIds.Dunn, itemIds['Iron rations'], 4);
addToInventory('character', charIds.Dunn, itemIds['Leather jerkin'], 1);

// --- world objects ------------------------------------------------------------------------
const chestId = db.prepare('INSERT INTO chests (map_id, x, y, icon) VALUES (?, 660, 500, ?)')
  .run(cellarId, defaultUrl('chest-token')).lastInsertRowid;
addToInventory('chest', chestId, itemIds['Silver ring'], 1);
addToInventory('chest', chestId, itemIds['Sealed letter'], 1);

const shopId = db.prepare(`INSERT INTO shops (name, npc_name, description, category, map_id, x, y)
  VALUES ('Flagon Supplies', 'Marla the Keep', 'Buys junk, sells basics over the bar.', 'general', ?, 200, 200)`)
  .run(tavernId).lastInsertRowid;
for (const n of ['Torch', 'Rope', 'Iron rations', 'Healing potion', 'Lockpicks']) {
  addToInventory('shop', shopId, itemIds[n], 5);
}

db.prepare(`INSERT INTO monsters (name, icon, art, stats, hp, max_hp, notes, map_id, x, y)
  VALUES ('Giant rat', ?, ?, ?, 7, 7, 'Guards the ledge above the chest.', ?, 420, 300)`)
  .run(defaultUrl('monster-token'), defaultUrl('monster-art'),
    JSON.stringify({ str: 7, dex: 15, ac: 12, bite: '1d4+2' }), cellarId);

db.prepare(`INSERT INTO npcs (name, description, portrait, token, map_id, x, y, notes)
  VALUES ('Old Tom', 'Grey-bearded regular nursing an ale.', ?, ?, ?, 700, 300,
          'Knows about the cellar noises. Will trade info for a Healing potion.')`)
  .run(defaultUrl('npc-art'), defaultUrl('npc-token'), tavernId);

const trackId = db.prepare("INSERT INTO tracks (map_id, name, file, youtube_id) VALUES (?, ?, '', ?)")
  .run(tavernId, 'Demo track (replace with your link)', 'jfKfPfyJRdk').lastInsertRowid;
db.prepare('UPDATE maps SET default_track_id = ? WHERE id = ?').run(trackId, tavernId);

db.prepare('INSERT INTO sounds (name, file) VALUES (?, ?)').run('Chime (demo)', chimeFile);

console.log('Seeded demo campaign (continuous maps): walls + one-way cliff painted,');
console.log('4 characters (password "1234"), typed shop, lore letter + campaign signet, sounds.');
