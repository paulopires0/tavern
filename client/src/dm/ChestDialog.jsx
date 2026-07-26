import React, { useEffect, useMemo, useState } from 'react';
import { upload } from '../api.js';
import { ITEM_CATEGORIES, MEASURES } from '../../../shared/gameRules.js';

// Loot UI: opened by dropping a character on a chest, or by clicking the chest
// on the Live map to edit what is inside. Contents can be auto-generated
// (rarity-weighted, never lore), stocked from the existing item pool, or filled
// with a brand-new item that also joins the pool. "Give" moves an entry into a
// character's inventory. The contents mirror onto a player's phone only while
// "show on phone" is ticked.
export default function ChestDialog({ chestId, characterId, characters, items = [], session, act, onClose }) {
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(characterId ?? characters[0]?.id);
  const [genCount, setGenCount] = useState(3);

  // add-from-pool
  const [pick, setPick] = useState('');
  const [pickQuery, setPickQuery] = useState('');
  const [qty, setQty] = useState(1);
  // create-a-new-item
  const emptyItem = { name: '', category: 'item', measure: 'unit', weight: 0, value: 0, damage: '', range: 0, armor: 0, description: '' };
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyItem);
  const ff = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function refresh() {
    const res = await act('GET', `/api/dm/chests/${chestId}`);
    if (res) setData(res);
  }
  useEffect(() => { refresh(); }, [chestId]);

  // Closing the dialog also takes the chest off the player's phone.
  async function close() {
    if (session?.chestId === chestId) await act('DELETE', '/api/dm/chest-session');
    onClose();
  }

  // The pool, filtered by the search box, grouped by category for the picker.
  const byCategory = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    const pool = q
      ? items.filter((it) => it.name.toLowerCase().includes(q)
        || (it.category || '').toLowerCase().includes(q)
        || (it.tags || []).some((t) => String(t).toLowerCase().includes(q)))
      : items;
    const groups = {};
    for (const it of pool) (groups[it.category] ||= []).push(it);
    for (const list of Object.values(groups)) list.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [items, pickQuery]);

  if (!data) return null;
  const { chest, entries } = data;
  const sharedWith = session?.chestId === chestId && session.shared
    ? characters.find((ch) => ch.id === session.characterId) : null;
  const audience = Number(characterId ?? target);

  async function give(entry) {
    await act('POST', '/api/dm/inventory/transfer', {
      entryId: entry.entry_id, toType: 'character', toId: Number(target), quantity: 1,
    });
    refresh();
  }

  async function addExisting() {
    if (!pick) return;
    await act('POST', '/api/dm/inventory/add', {
      ownerType: 'chest', ownerId: chestId, itemId: Number(pick), quantity: Math.max(1, Number(qty) || 1),
    });
    setPick(''); setQty(1);
    refresh();
  }

  async function createAndAdd() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      category: form.category,
      measure: form.measure,
      weight: Number(form.weight) || 0,
      value: Number(form.value) || 0,
      damage: form.category === 'weapon' ? (form.damage || null) : null,
      range: form.category === 'weapon' ? Number(form.range) || 0 : null,
      armor: form.category === 'armor' ? Number(form.armor) || 0 : null,
      description: form.description || '',
      tags: ['common'],
    };
    const made = await act('POST', '/api/dm/items', payload); // joins the item pool
    if (!made?.id) return;
    await act('POST', '/api/dm/inventory/add', {
      ownerType: 'chest', ownerId: chestId, itemId: made.id, quantity: Math.max(1, Number(qty) || 1),
    });
    setForm(emptyItem); setCreating(false); setQty(1);
    refresh();
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>Chest {chest.state === 'opened' ? '(opened)' : '(closed)'}</h3>
          <button className="ghost" onClick={close}>✕</button>
        </header>

        <label className="row small">
          <input type="checkbox" checked={!!sharedWith}
            onChange={(e) => (e.target.checked
              ? act('POST', '/api/dm/chest-session', { chestId, characterId: audience })
              : act('DELETE', '/api/dm/chest-session'))} />
          Show the contents on {characters.find((ch) => ch.id === audience)?.name || 'the player'}'s phone
        </label>

        <div className="row">
          <button onClick={async () => {
            await act('POST', `/api/dm/chests/${chestId}/state`,
              { state: chest.state === 'opened' ? 'closed' : 'opened' });
            refresh();
          }}>
            {chest.state === 'opened' ? 'Close chest' : 'Open chest'}
          </button>
          <span className="spacer" />
          <input type="number" className="num" min="1" max="20" value={genCount}
            onChange={(e) => setGenCount(Number(e.target.value))} />
          <button onClick={async () => { await act('POST', `/api/dm/chests/${chestId}/generate`, { count: genCount }); refresh(); }}>
            Auto-generate
          </button>
        </div>

        <div className="row">
          <label className="row small">
            <input type="checkbox" checked={!!chest.hidden} onChange={async (e) => {
              await act('PATCH', `/api/dm/chests/${chestId}`, { hidden: e.target.checked });
              refresh();
            }} />
            Hidden from players (only you see it, whatever the fog says)
          </label>
        </div>
        <div className="row">
          <label className="field"><span>Chest image on the map</span>
            <input type="file" accept="image/*" onChange={async (e) => {
              const f = e.target.files[0];
              if (f) { await act('PATCH', `/api/dm/chests/${chestId}`, { icon: await upload('chest-token', f) }); refresh(); }
            }} /></label>
        </div>

        {/* Put items in: pick from the pool, or create a new one on the spot */}
        <div className="chest-add">
          <input className="grow" placeholder="Search the item pool…" value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)} style={{ marginBottom: 6 }} />
          <div className="row">
            <select className="grow" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— add an existing item —</option>
              {ITEM_CATEGORIES.filter((c) => byCategory[c]?.length).map((c) => (
                <optgroup key={c} label={c}>
                  {byCategory[c].map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </optgroup>
              ))}
            </select>
            <input type="number" className="num" min="1" title="How many" value={qty}
              onChange={(e) => setQty(e.target.value)} />
            <button disabled={!pick} onClick={addExisting}>Add</button>
          </div>
          <div className="row">
            <button className="ghost small" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel new item' : '+ Create a new item…'}
            </button>
            <span className="muted small">A new item also joins your item pool.</span>
          </div>

          {creating && (
            <div className="chest-new">
              <div className="field-grid">
                <label className="field"><span>Name</span><input value={form.name} onChange={ff('name')} autoFocus /></label>
                <label className="field"><span>Category</span>
                  <select value={form.category} onChange={ff('category')}>
                    {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {['item', 'consumable'].includes(form.category) && (
                  <label className="field"><span>Measured in</span>
                    <select value={form.measure} onChange={ff('measure')}>
                      {MEASURES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                )}
                <label className="field"><span>Weight</span>
                  <input type="number" value={form.weight} onChange={ff('weight')} /></label>
                <label className="field"><span>Value (gp)</span>
                  <input type="number" value={form.value} onChange={ff('value')} /></label>
                {form.category === 'weapon' && (
                  <>
                    <label className="field"><span>Damage</span><input value={form.damage} onChange={ff('damage')} placeholder="1d8+1" /></label>
                    <label className="field"><span>Range (m)</span><input type="number" value={form.range} onChange={ff('range')} /></label>
                  </>
                )}
                {form.category === 'armor' && (
                  <label className="field"><span>Armor value</span><input type="number" value={form.armor} onChange={ff('armor')} /></label>
                )}
              </div>
              <label className="field"><span>Description</span>
                <input value={form.description} onChange={ff('description')} /></label>
              <div className="row">
                <button disabled={!form.name.trim()} onClick={createAndAdd}>Create &amp; put in chest</button>
              </div>
            </div>
          )}
        </div>

        <div className="row">
          <label>Give loot to:&nbsp;
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <ul className="inv-list">
          {entries.map((e) => (
            <li key={e.entry_id}>
              <span title={e.description}>{e.name} ×{e.quantity} <span className="muted small">({e.weight} wt)</span></span>
              <span>
                <button className="mini" onClick={() => give(e)}>give 1</button>
                <button className="mini danger" onClick={async () => {
                  await act('POST', '/api/dm/inventory/remove', { entryId: e.entry_id, quantity: e.quantity });
                  refresh();
                }}>del</button>
              </span>
            </li>
          ))}
          {entries.length === 0 && <li className="muted">Empty.</li>}
        </ul>
      </div>
    </div>
  );
}
