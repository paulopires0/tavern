import React, { useState } from 'react';
import { WEAPON_GEN_DEFAULT, ARMOR_GEN_DEFAULT } from '../../../shared/gameRules.js';

// Stat block, the spectator link, new-character/DM defaults, and the full
// weapon/armor generation rules — everything worth changing without editing code.
export default function Settings({ global, act }) {
  const [rows, setRows] = useState(global.statBlock);
  const [pw, setPw] = useState('');
  const [vision, setVision] = useState(global.visionDefault ?? 15);
  const tvUrl = `${window.location.origin}/?tv=${global.spectatorKey}`;

  return (
    <div className="panel">
      <div className="card">
        <h3>Party / TV view</h3>
        <p className="muted small">Open this on the shared screen — no login, fog applied. Use it on as many TVs at once as you like; they all show the party view.</p>
        <div className="row">
          <code className="tvlink">{tvUrl}</code>
          <button onClick={() => navigator.clipboard?.writeText(tvUrl)}>Copy</button>
          <a className="buttonish" href={`/?tv=${global.spectatorKey}`} target="_blank" rel="noreferrer">Open</a>
          <button className="mini danger" onClick={() => {
            if (confirm('Make a new TV link? The current one stops working and every open TV is disconnected.')) {
              act('POST', '/api/dm/regenerate-tv-link');
            }
          }}>Regenerate</button>
        </div>
      </div>

      <div className="card">
        <h3>DM access &amp; defaults</h3>
        <div className="field-grid">
          <label className="field">
            <span>DM password {global.dmPasswordCustom ? '(custom)' : '(from env)'}</span>
            <input type="password" placeholder="new password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label className="field">
            <span>New-character vision (m)</span>
            <input type="number" min="1" value={vision} onChange={(e) => setVision(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button disabled={!pw.trim()} onClick={async () => {
            if (await act('POST', '/api/dm/config', { dmPassword: pw.trim() })) { setPw(''); alert('DM password updated.'); }
          }}>Set password</button>
          {global.dmPasswordCustom && (
            <button className="mini" onClick={() => act('POST', '/api/dm/config', { dmPassword: '' })}>
              Clear (use env default)
            </button>
          )}
          <span className="spacer" />
          <button onClick={() => act('POST', '/api/dm/config', { visionDefault: Number(vision) })}>Save vision</button>
        </div>
      </div>

      <GenEditor kind="weapon" gen={global.weaponGen} defaults={WEAPON_GEN_DEFAULT} act={act} />
      <GenEditor kind="armor" gen={global.armorGen} defaults={ARMOR_GEN_DEFAULT} act={act} />

      <div className="card">
        <h3>Stat block</h3>
        <p className="muted small">The stats every sheet shows. Movement reads <code>str</code>/<code>dex</code> if present.</p>
        {rows.map((s, i) => (
          <div className="row" key={i}>
            <input className="num wide" placeholder="key (e.g. str)" value={s.key}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
            <input placeholder="Label (e.g. Strength)" value={s.label}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))} />
            <button className="mini danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>del</button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => setRows([...rows, { key: '', label: '' }])}>Add stat</button>
          <span className="spacer" />
          <button onClick={() => act('POST', '/api/dm/config', { statBlock: rows })}>Save stat block</button>
        </div>
      </div>

      <div className="card">
        <h3>Server &amp; rules</h3>
        <ul className="muted small">
          <li>Port and data folder are environment variables (see README).</li>
          <li>Movement and loot-rarity weights live in <code>shared/gameRules.js</code>; gear generation is editable above.</li>
          <li>Character passwords are stored in plain text so you can remind players — LAN-only design.</li>
        </ul>
      </div>
    </div>
  );
}

const SCALAR_FIELDS = {
  weapon: [
    ['bonusMax', 'Max quality bonus (+dmg)'],
    ['rangeCoef', 'Reach → rank coefficient'],
    ['valueFactor', 'Value factor (gp = rank² ×)'],
    ['rareAt', 'Rare at (0–1 of span)'],
    ['uncommonAt', 'Uncommon at (0–1 of span)'],
  ],
  armor: [
    ['bonusMax', 'Max quality bonus (+armor)'],
    ['valueFactor', 'Value factor (gp = rank² ×)'],
    ['rareAt', 'Rare at (0–1 of span)'],
    ['uncommonAt', 'Uncommon at (0–1 of span)'],
  ],
};

const GEN_HELP = {
  weapon: (
    <>
      Each weapon rolls its <strong>dice + range</strong> from its category profile, plus a random{' '}
      <strong>+0…bonusMax</strong> damage bonus. <strong>rank = average damage + range × coefficient</strong>;{' '}
      <strong>price = rank² × value factor</strong>. Rarity is where the roll lands in that category's rank
      span, so a “rare dagger” is an exceptional dagger. Profiles: each category has{' '}
      <code>dice</code> options <code>[n, sides]</code>, <code>range</code> <code>[min, max]</code> m and{' '}
      <code>weight</code> <code>[min, max]</code> kg. Names come from <code>weapon-names.json</code>.
    </>
  ),
  armor: (
    <>
      Each piece rolls an <strong>armor value + weight</strong> from its category profile, plus a random{' '}
      <strong>+0…bonusMax</strong> quality bonus. <strong>rank = armor value</strong>;{' '}
      <strong>price = rank² × value factor</strong>. Rarity is where the roll lands in that category's span.
      Profiles: each category has <code>armor</code> <code>[min, max]</code> and <code>weight</code>{' '}
      <code>[min, max]</code> kg. Names come from <code>armor-names.json</code>.
    </>
  ),
};

// Editor for one generation ruleset. Local state initialised once so live
// pushes elsewhere never clobber a half-typed profile.
function GenEditor({ kind, gen, defaults, act }) {
  const genKey = kind === 'weapon' ? 'weaponGen' : 'armorGen';
  const initScalars = (g) => Object.fromEntries(SCALAR_FIELDS[kind].map(([k]) => [k, g[k]]));
  const [scalars, setScalars] = useState(() => initScalars(gen));
  const [profilesText, setProfilesText] = useState(() => JSON.stringify(gen.profiles, null, 2));
  const [dirty, setDirty] = useState(false);

  function save() {
    let profiles;
    try {
      profiles = JSON.parse(profilesText);
    } catch {
      alert('The profiles box is not valid JSON.');
      return;
    }
    const payload = {};
    for (const [k] of SCALAR_FIELDS[kind]) payload[k] = Number(scalars[k]);
    payload.profiles = profiles;
    act('POST', '/api/dm/config', { [genKey]: payload }).then((r) => r && setDirty(false));
  }

  function reset() {
    setScalars(initScalars(defaults));
    setProfilesText(JSON.stringify(defaults.profiles, null, 2));
    setDirty(false);
    act('POST', '/api/dm/config', { [genKey]: null });
  }

  return (
    <div className="card">
      <h3>{kind === 'weapon' ? 'Weapon' : 'Armor'} generation</h3>
      <p className="muted small">{GEN_HELP[kind]}</p>
      <div className="field-grid">
        {SCALAR_FIELDS[kind].map(([k, label]) => (
          <label className="field" key={k}>
            <span>{label}</span>
            <input type="number" step="0.05" value={scalars[k]}
              onChange={(e) => { setScalars({ ...scalars, [k]: e.target.value }); setDirty(true); }} />
          </label>
        ))}
      </div>
      <label className="field">
        <span>Category profiles (JSON)</span>
        <textarea className="gen-json" rows={10} spellCheck={false} value={profilesText}
          onChange={(e) => { setProfilesText(e.target.value); setDirty(true); }} />
      </label>
      <div className="row">
        <button onClick={save} disabled={!dirty}>Save {kind} rules</button>
        <button className="mini" onClick={reset}>Reset to defaults</button>
      </div>
    </div>
  );
}
