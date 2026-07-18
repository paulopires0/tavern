import React, { useState } from 'react';
import { Field, NumField, TextArea } from '../fields.jsx';
import { upload } from '../api.js';
import ItemDetail from '../ItemDetail.jsx';
import { rarityOf } from '../../../shared/gameRules.js';

const CATEGORIES = ['item', 'consumable', 'weapon', 'armor', 'lore', 'campaign'];
const MEASURES = ['unit', 'liter', 'meter'];

// Item catalog. Weapons carry damage + range (range shows on the live map),
// armor carries an armor value, consumables/items are measured per unit /
// liter / meter, and lore items hold hand-written story text.
export default function Items({ global, act }) {
  const empty = { name: '', category: 'item', measure: 'unit', weight: 0, value: 0, damage: '', range: 0, armor: 0, description: '', lore_text: '', tags: 'common' };
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('all');
  const [preview, setPreview] = useState(null);

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const items = global.items.filter((i) => filter === 'all' || i.category === filter);

  return (
    <div className="panel">
      <div className="card">
        <h3>New item</h3>
        <div className="field-grid">
          <label className="field"><span>Name</span><input value={form.name} onChange={f('name')} /></label>
          <label className="field"><span>Category</span>
            <select value={form.category} onChange={f('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {['item', 'consumable'].includes(form.category) && (
            <label className="field"><span>Measured in</span>
              <select value={form.measure} onChange={f('measure')}>
                {MEASURES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          <label className="field"><span>Weight per {form.measure}</span>
            <input type="number" value={form.weight} onChange={f('weight')} /></label>
          <label className="field"><span>Value (gp)</span>
            <input type="number" value={form.value} onChange={f('value')} /></label>
          {form.category === 'weapon' && (
            <>
              <label className="field"><span>Damage (e.g. 1d8+1)</span>
                <input value={form.damage} onChange={f('damage')} /></label>
              <label className="field"><span>Range (m)</span>
                <input type="number" value={form.range} onChange={f('range')} /></label>
            </>
          )}
          {form.category === 'armor' && (
            <label className="field"><span>Armor value</span>
              <input type="number" value={form.armor} onChange={f('armor')} /></label>
          )}
          <label className="field"><span>Rarity/tags (comma-sep)</span>
            <input value={form.tags} onChange={f('tags')} /></label>
        </div>
        <label className="field"><span>Description</span>
          <input value={form.description} onChange={f('description')} /></label>
        {['lore', 'campaign'].includes(form.category) && (
          <label className="field"><span>Story text (the letter / lore itself)</span>
            <textarea rows={4} value={form.lore_text} onChange={f('lore_text')} /></label>
        )}
        {form.category === 'campaign' && (
          <p className="muted small">Campaign items are DM-only: players cannot add them to their bags; shops and chest rolls never produce them.</p>
        )}
        <button onClick={async () => {
          if (!form.name.trim()) return;
          const payload = {
            ...form,
            weight: Number(form.weight), value: Number(form.value),
            range: form.category === 'weapon' ? Number(form.range) : null,
            damage: form.category === 'weapon' ? form.damage : null,
            armor: form.category === 'armor' ? Number(form.armor) : null,
            lore_text: ['lore', 'campaign'].includes(form.category) ? form.lore_text : null,
            tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          };
          if (await act('POST', '/api/dm/items', payload)) setForm(empty);
        }}>Add item</button>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={async () => {
            const res = await act('POST', '/api/dm/items/import-file');
            if (res) alert(`Imported ${res.added} items from items.json (${res.skipped} skipped as duplicates).`);
          }}>Import items.json</button>
          <span className="muted small">
            Fill items.json with an LLM using prompts/generate-items.md. Gear names: prompts/generate-weapons.md → weapon-names.json, prompts/generate-armor.md → armor-names.json.
          </span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => {
            const gear = global.items
              .filter((i) => ['weapon', 'armor'].includes(i.category) && !i.description)
              .map((i) => (i.category === 'weapon'
                ? { name: i.name, damage: i.damage, range: i.range, value: i.value, rarity: rarityOf(i.tags) }
                : { name: i.name, armor: i.armor, value: i.value, rarity: rarityOf(i.tags) }));
            if (!gear.length) return alert('Every weapon and armor piece already has a story.');
            const blob = new Blob([JSON.stringify(gear, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'gear-without-lore.json';
            a.click();
            URL.revokeObjectURL(a.href);
          }}>Export gear without lore</button>
          <button onClick={async () => {
            const res = await act('POST', '/api/dm/items/lore-file');
            if (res) {
              alert(`Lore written on ${res.updated} pieces.` +
                (res.missing.length ? ` Not found: ${res.missing.join(', ')}` : ''));
            }
          }}>Import gear-lore.json</button>
          <span className="muted small">
            Feed the export + prompts/generate-gear-lore.md to an LLM, save its answer as gear-lore.json, import. Stories must match the rarity.
          </span>
        </div>
      </div>

      <div className="chips">
        {['all', ...CATEGORIES].map((c) => (
          <button key={c} className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
            {c}{c !== 'all' ? ` (${global.items.filter((i) => i.category === c).length})` : ''}
          </button>
        ))}
      </div>

      <table className="item-table">
        <thead><tr><th>Name</th><th>Cat.</th><th>Specs</th><th>Wt</th><th>gp</th><th /></tr></thead>
        <tbody>
          {items.map((i) => (
            <React.Fragment key={i.id}>
              <tr className="clickable" onClick={() => setOpen(open === i.id ? null : i.id)}>
                <td><button className="linkish" onClick={(e) => { e.stopPropagation(); setPreview(i); }}>{i.name}</button></td>
                <td className="muted small">{i.category}</td>
                <td className="muted small">
                  {i.category === 'weapon' && `${i.damage || '—'} · ${i.range ?? 0} m · ${rarityOf(i.tags)}`}
                  {i.category === 'armor' && `armor +${i.armor ?? 0}`}
                  {['item', 'consumable'].includes(i.category) && `per ${i.measure}`}
                  {['lore', 'campaign'].includes(i.category) && i.category}
                </td>
                <td>{i.weight}</td><td>{i.value}</td>
                <td><button className="mini danger" onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete item "${i.name}"? It disappears from all inventories.`)) {
                    act('DELETE', `/api/dm/items/${i.id}`);
                  }
                }}>del</button></td>
              </tr>
              {open === i.id && (
                <tr><td colSpan={6}>
                  <div className="field-grid">
                    <Field label="Name" value={i.name} onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { name: v })} />
                    <label className="field"><span>Category</span>
                      <select value={i.category} onChange={(e) => act('PATCH', `/api/dm/items/${i.id}`, { category: e.target.value })}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Measure</span>
                      <select value={i.measure} onChange={(e) => act('PATCH', `/api/dm/items/${i.id}`, { measure: e.target.value })}>
                        {MEASURES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                    <NumField label="Weight" value={i.weight} onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { weight: v })} />
                    <NumField label="Value" value={i.value} onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { value: v })} />
                    <Field label="Damage" value={i.damage || ''} onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { damage: v || null })} />
                    <NumField label="Range (m)" value={i.range ?? 0} onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { range: v })} />
                    <NumField label="Armor" value={i.armor ?? 0} onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { armor: v })} />
                    <Field label="Tags" value={i.tags.join(', ')} onSave={(v) =>
                      act('PATCH', `/api/dm/items/${i.id}`, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} />
                  </div>
                  <Field label="Description" value={i.description} onSave={(v) =>
                    act('PATCH', `/api/dm/items/${i.id}`, { description: v })} />
                  <label className="field"><span>Lore text</span>
                    <TextArea value={i.lore_text || ''} rows={3}
                      onSave={(v) => act('PATCH', `/api/dm/items/${i.id}`, { lore_text: v || null })} />
                  </label>
                  <div className="row">
                    {i.image && <img className="portrait" src={i.image} alt="" />}
                    <label className="field"><span>Item art</span>
                      <input type="file" accept="image/*" onChange={async (e) => {
                        const file = e.target.files[0];
                        if (file) act('PATCH', `/api/dm/items/${i.id}`, { image: await upload('images', file) });
                      }} /></label>
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="muted pad">No items in this category.</p>}
      {preview && <ItemDetail item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
