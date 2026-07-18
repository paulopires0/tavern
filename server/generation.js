// Live generation parameters: the shared defaults with the DM's Settings
// overrides (config keys `weapon_gen` / `armor_gen`) merged on top. The roll
// functions in shared/gameRules.js take one of these objects.
import { WEAPON_GEN_DEFAULT, ARMOR_GEN_DEFAULT } from '../shared/gameRules.js';
import { getConfig } from './db.js';

function merge(defaults, override) {
  if (!override || typeof override !== 'object') return defaults;
  const out = { ...defaults, ...override };
  // profiles must be a non-empty object, else keep the defaults
  if (!override.profiles || typeof override.profiles !== 'object'
      || !Object.keys(override.profiles).length) {
    out.profiles = defaults.profiles;
  }
  return out;
}

export function weaponGen() {
  return merge(WEAPON_GEN_DEFAULT, getConfig('weapon_gen', null));
}
export function armorGen() {
  return merge(ARMOR_GEN_DEFAULT, getConfig('armor_gen', null));
}

// Validate a generation-params object coming from Settings before it is stored.
// Returns an error string, or null when it is safe.
export function validateGen(g, kind) {
  if (!g || typeof g !== 'object') return 'must be an object';
  const scalars = kind === 'weapon'
    ? ['bonusMax', 'rangeCoef', 'valueFactor', 'rareAt', 'uncommonAt']
    : ['bonusMax', 'valueFactor', 'rareAt', 'uncommonAt'];
  for (const k of scalars) {
    if (k in g && !(typeof g[k] === 'number' && Number.isFinite(g[k]))) return `${k} must be a number`;
  }
  if (g.profiles != null) {
    if (typeof g.profiles !== 'object' || !Object.keys(g.profiles).length) {
      return 'profiles must be a non-empty object';
    }
    const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');
    for (const [cat, p] of Object.entries(g.profiles)) {
      if (!p || typeof p !== 'object') return `${cat}: bad profile`;
      if (!pair(p.weight)) return `${cat}.weight must be [min, max]`;
      if (kind === 'weapon') {
        if (!pair(p.range)) return `${cat}.range must be [min, max]`;
        if (!Array.isArray(p.dice) || !p.dice.length
            || !p.dice.every((d) => Array.isArray(d) && d.length === 2 && d.every((n) => typeof n === 'number'))) {
          return `${cat}.dice must be [[n, sides], …]`;
        }
      } else if (!pair(p.armor)) {
        return `${cat}.armor must be [min, max]`;
      }
    }
  }
  return null;
}
