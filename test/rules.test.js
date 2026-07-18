import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rollWeapon, rollArmor, pickByRank, avgDamage, weaponValue, weaponRank, weaponRarity,
  rankBounds, armorRarity, shopBuyPrice, WEAPON_PROFILES, RARITY_WEIGHTS,
  WEAPON_GEN_DEFAULT, ARMOR_GEN_DEFAULT,
} from '../shared/gameRules.js';
import { parseYoutubeId } from '../server/youtube.js';

test('rollWeapon produces coherent specs for every category', () => {
  for (const category of Object.keys(WEAPON_PROFILES)) {
    for (let i = 0; i < 20; i++) {
      const w = rollWeapon('Test blade', category);
      assert.match(w.damage, /^\d+d\d+(\+\d+)?$/);
      const [lo, hi] = WEAPON_PROFILES[category].range;
      assert.ok(w.range >= lo && w.range <= hi, `${category} range ${w.range} in [${lo},${hi}]`);
      assert.ok(w.value >= 1);
      assert.ok(w.rank > 0);
      assert.equal(w.category, 'weapon');
      assert.ok(w.tags.includes(category));
      assert.ok(w.rarity in RARITY_WEIGHTS, `rarity "${w.rarity}" is a chest-roll rarity`);
      assert.ok(w.tags.includes(w.rarity), 'the rarity rides in the tags');
    }
  }
});

test('weaponRarity: best rolls of a category are rare, worst are common', () => {
  for (const category of Object.keys(WEAPON_PROFILES)) {
    const [lo, hi] = rankBounds(category);
    assert.ok(hi > lo, `${category} has a real rank spread`);
    assert.equal(weaponRarity(lo, category), 'common');
    assert.equal(weaponRarity(hi, category), 'rare');
  }
  // a rare dagger is an exceptional dagger — the label is relative to its kind
  const [, daggerHi] = rankBounds('dagger');
  assert.equal(weaponRarity(daggerHi, 'dagger'), 'rare');
  assert.equal(weaponRarity(daggerHi, 'polearm'), 'common', 'the same rank is common for polearms');
});

test('rollArmor produces coherent specs for every category', () => {
  for (const category of Object.keys(ARMOR_GEN_DEFAULT.profiles)) {
    for (let i = 0; i < 20; i++) {
      const a = rollArmor('Test piece', category);
      assert.equal(a.category, 'armor');
      const p = ARMOR_GEN_DEFAULT.profiles[category];
      assert.ok(a.armor >= p.armor[0] && a.armor <= p.armor[1] + ARMOR_GEN_DEFAULT.bonusMax,
        `${category} armor ${a.armor} within [${p.armor[0]}, ${p.armor[1] + ARMOR_GEN_DEFAULT.bonusMax}]`);
      assert.ok(a.value >= 1);
      assert.ok(a.tags.includes(category) && a.tags.includes(a.rarity));
      assert.ok(a.rarity in RARITY_WEIGHTS);
    }
  }
  // rarity is relative to the category's own span (plate 5..10, padded 1..4)
  assert.equal(armorRarity(10, 'plate'), 'rare');
  assert.equal(armorRarity(5, 'plate'), 'common', 'a plain plate is common plate');
  assert.equal(armorRarity(1, 'padded'), 'common');
});

test('generation params are overridable end to end', () => {
  const gen = {
    ...WEAPON_GEN_DEFAULT, bonusMax: 0, rangeCoef: 0, valueFactor: 1,
    profiles: { club: { range: [1, 1], dice: [[1, 6]], weight: [2, 2] } },
  };
  const w = rollWeapon('Cudgel', 'club', gen);
  assert.equal(w.damage, '1d6', 'bonusMax 0 → never a +bonus');
  assert.equal(w.range, 1);
  // rank = avg(1d6)=3.5, value = round(3.5^2 * 1) = 12
  assert.equal(w.value, 12);
});

test('rank formula: stronger and longer-ranged weapons rank and cost more', () => {
  const weak = weaponRank(avgDamage(1, 4, 0), 1);
  const strong = weaponRank(avgDamage(2, 6, 3), 1);
  const sniper = weaponRank(avgDamage(1, 6, 0), 60);
  assert.ok(strong > weak);
  assert.ok(sniper > weaponRank(avgDamage(1, 6, 0), 1), 'range adds rank');
  assert.ok(weaponValue(strong) > weaponValue(weak));
});

test('pickByRank favors low-rank (common) weapons', () => {
  const cheap = { name: 'cheap', rank: 2 };
  const epic = { name: 'epic', rank: 20 };
  let cheapWins = 0;
  for (let i = 0; i < 500; i++) {
    if (pickByRank([cheap, epic]).name === 'cheap') cheapWins++;
  }
  assert.ok(cheapWins > 400, `low rank picked ${cheapWins}/500 times`);
});

test('shopBuyPrice: players sell at half list, floored', () => {
  assert.equal(shopBuyPrice(10), 5);
  assert.equal(shopBuyPrice(7), 3);
  assert.equal(shopBuyPrice(0), 0);
});

test('parseYoutubeId handles the usual link shapes', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=3s',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'dQw4w9WgXcQ',
  ]) {
    assert.equal(parseYoutubeId(url), 'dQw4w9WgXcQ', url);
  }
  assert.equal(parseYoutubeId('not a link'), null);
  assert.equal(parseYoutubeId(''), null);
});
