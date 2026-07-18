import React, { useState } from 'react';
import { upload } from '../api.js';
import { Field, NumField, GiveItem } from '../fields.jsx';
import { CropInput } from '../ImageCropper.jsx';

// Full character management. Players edit most of this themselves from their
// phones; the roster is the DM's override and onboarding tool.
export default function Roster({ global, act }) {
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState(null); // expanded character id

  const patch = (id, field) => (value) => act('PATCH', `/api/dm/characters/${id}`, { [field]: value });

  return (
    <div className="panel">
      <div className="row">
        <input placeholder="New character name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button onClick={async () => {
          if (newName.trim() && await act('POST', '/api/dm/characters', { name: newName.trim() })) setNewName('');
        }}>Create</button>
      </div>

      {global.characters.map((c) => (
        <div className="card" key={c.id}>
          <header className="row spread clickable" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span className="row">
              {c.token ? <img className="portrait small round" src={c.token} alt="" />
                : <span className="token-dot" style={{ background: c.token_color }} />}
              <strong>{c.name}</strong>
            </span>
            <span className="muted">
              Lv {c.level} · HP {c.hp}/{c.max_hp} · Armor {c.armor} · {c.gold} gp · {c.carried_weight}/{c.carry_capacity} wt
              {c.carried_weight > c.carry_capacity && ' (overloaded)'}
            </span>
          </header>

          {open === c.id && (
            <div className="char-editor">
              <div className="field-grid">
                <Field label="Password" value={c.password} onSave={patch(c.id, 'password')} />
                <NumField label="Level" value={c.level} onSave={patch(c.id, 'level')} />
                <NumField label="HP" value={c.hp} onSave={patch(c.id, 'hp')} />
                <NumField label="Max HP" value={c.max_hp} onSave={patch(c.id, 'max_hp')} />
                <NumField label="Armor" value={c.armor} onSave={patch(c.id, 'armor')} />
                <NumField label="Gold" value={c.gold} onSave={patch(c.id, 'gold')} />
                <NumField label="Capacity" value={c.carry_capacity} onSave={patch(c.id, 'carry_capacity')} />
                <NumField label="Vision (m)" value={c.vision_radius} onSave={patch(c.id, 'vision_radius')} />
                <NumField label="Token size ×" value={c.token_scale} step={0.1}
                  onSave={(v) => patch(c.id, 'token_scale')(Math.max(0.2, v || 1))} />
                <label className="field"><span>Token shape</span>
                  <select value={c.token_shape || 'circle'} onChange={(e) => patch(c.id, 'token_shape')(e.target.value)}>
                    <option value="circle">circle</option>
                    <option value="square">square</option>
                    <option value="free">free</option>
                  </select>
                </label>
                <Field label="Token color" type="color" value={c.token_color} onSave={patch(c.id, 'token_color')} instant />
              </div>

              <h4>Stats</h4>
              <div className="field-grid">
                {global.statBlock.map((s) => (
                  <NumField key={s.key} label={s.label} value={c.stats[s.key] ?? 10}
                    onSave={(v) => act('PATCH', `/api/dm/characters/${c.id}`, { stats: { ...c.stats, [s.key]: v } })} />
                ))}
              </div>

              <h4>Art & token</h4>
              <div className="row">
                {c.portrait && <img className="portrait" src={c.portrait} alt="art" />}
                {c.token && <img className="portrait round" src={c.token} alt="token" />}
                <CropInput label="Art (sheet)"
                  onFile={async (f) => patch(c.id, 'portrait')(await upload('char-art', f))} />
                <CropInput label="Map token" round={c.token_shape !== 'square'}
                  onFile={async (f) => patch(c.id, 'token')(await upload('char-token', f))} />
              </div>

              {c.powers.length > 0 && (
                <>
                  <h4>Powers <span className="muted small">(written by the player)</span></h4>
                  <ul className="inv-list">
                    {c.powers.map((p) => (
                      <li key={p.id}><span><strong>{p.name}</strong> <span className="muted small">{p.description}</span></span></li>
                    ))}
                  </ul>
                </>
              )}

              <h4>Inventory <span className="muted small">{c.carried_weight}/{c.carry_capacity} wt</span></h4>
              <ul className="inv-list">
                {c.inventory.map((e) => (
                  <li key={e.entry_id}>
                    <span title={e.description}>{e.name} ×{e.quantity}</span>
                    <span>
                      <button className="mini" title="remove one" onClick={() =>
                        act('POST', '/api/dm/inventory/remove', { entryId: e.entry_id, quantity: 1 })}>−1</button>
                      <button className="mini danger" title="remove all" onClick={() =>
                        act('POST', '/api/dm/inventory/remove', { entryId: e.entry_id, quantity: e.quantity })}>all</button>
                    </span>
                  </li>
                ))}
              </ul>
              <GiveItem items={global.items} label="Give item" onGive={(itemId, qty) =>
                act('POST', '/api/dm/inventory/add', { ownerType: 'character', ownerId: c.id, itemId, quantity: qty })} />

              <div className="row end">
                <button className="danger" onClick={() => {
                  if (confirm(`Delete ${c.name}? This cannot be undone.`)) act('DELETE', `/api/dm/characters/${c.id}`);
                }}>Delete character</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
