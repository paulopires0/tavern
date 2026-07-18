import React, { useEffect, useState } from 'react';
import { connectSocket } from './socket.js';
import { api, getAuth } from './api.js';
import { NumField, TextArea, GiveItem } from './fields.jsx';
import ItemDetail from './ItemDetail.jsx';
import { CropInput } from './ImageCropper.jsx';

// Phone view — the character's own sheet. Players edit it like paper:
// HP, gold, stats, bag, powers, diary. Live-synced with whatever the DM does.
export default function PlayerView({ onLogout }) {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('sheet');
  const [toast, setToast] = useState('');
  const [detail, setDetail] = useState(null); // item for the detail modal

  useEffect(() => {
    const s = connectSocket({ token: getAuth()?.token });
    s.on('state', setState);
    s.on('connect_error', (e) => { if (e.message === 'unauthorized') onLogout(); });
    return () => s.close();
  }, []);

  async function act(method, path, body) {
    try {
      return await api(method, path, body);
    } catch (e) {
      setToast(e.message);
      setTimeout(() => setToast(''), 4000);
      return null;
    }
  }

  if (!state?.character) return <div className="player-screen"><p className="muted pad">Loading…</p></div>;

  const c = state.character;
  const patchMe = (field) => (value) => act('PATCH', '/api/player/me', { [field]: value });

  async function uploadOwn(kind, file) {
    const token = getAuth()?.token;
    const res = await fetch(`/api/player/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
      method: 'PUT', headers: { 'x-auth-token': token }, body: file,
    });
    if (!res.ok) setToast('upload failed');
  }

  return (
    <div className="player-screen">
      <header className="player-header">
        {c.portrait
          ? <img className="portrait" src={c.portrait} alt="" />
          : <span className="token-dot big" style={{ background: c.token_color }} />}
        <div>
          <h1>{c.name}</h1>
          <span className="muted">Level {c.level}</span>
        </div>
        <button className="ghost small logout" onClick={onLogout}>Log out</button>
      </header>

      {tab === 'sheet' && <SheetTab state={state} act={act} patchMe={patchMe} uploadOwn={uploadOwn} />}
      {tab === 'bag' && <BagTab state={state} act={act} onDetail={setDetail} />}
      {tab === 'powers' && <PowersTab c={c} act={act} />}
      {tab === 'diary' && <DiaryTab entries={state.diary} act={act} base="/api/player/diary" />}

      <nav className="player-tabs">
        {[['sheet', 'Sheet'], ['bag', 'Bag'], ['powers', 'Powers'], ['diary', 'Diary']].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {detail && <ItemDetail item={detail} onClose={() => setDetail(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function SheetTab({ state, act, patchMe, uploadOwn }) {
  const c = state.character;
  const statBlock = state.statBlock || [];
  const hpPct = Math.max(0, Math.min(100, (c.hp / (c.max_hp || 1)) * 100));

  return (
    <>
      <section className="card">
        <div className="hp-row">
          <strong>HP</strong>
          <span className="hp-controls">
            <button className="mini" onClick={() => patchMe('hp')(c.hp - 1)}>−1</button>
            <button className="mini" onClick={() => patchMe('hp')(c.hp - 5)}>−5</button>
            <strong> {c.hp} / {c.max_hp} </strong>
            <button className="mini" onClick={() => patchMe('hp')(Math.min(c.max_hp, c.hp + 1))}>+1</button>
            <button className="mini" onClick={() => patchMe('hp')(c.max_hp)}>full</button>
          </span>
        </div>
        <div className="bar"><div className="bar-fill hp" style={{ width: `${hpPct}%` }} /></div>
        <div className="field-grid">
          <NumField label="Max HP" value={c.max_hp} onSave={patchMe('max_hp')} />
          <NumField label="Armor" value={c.armor} onSave={patchMe('armor')} />
          <NumField label="Gold" value={c.gold} onSave={patchMe('gold')} />
          <NumField label="Level" value={c.level} onSave={patchMe('level')} />
        </div>
      </section>

      <section className="card">
        <h2>Stats</h2>
        <div className="stat-grid">
          {statBlock.map((s) => (
            <label className="stat" key={s.key}>
              <span className="stat-label">{s.label}</span>
              <StatInput value={c.stats[s.key] ?? 10}
                onSave={(v) => act('PATCH', '/api/player/me', { stats: { ...c.stats, [s.key]: v } })} />
            </label>
          ))}
        </div>
      </section>

      {state.location && (
        <section className="card">
          <h2>Where you are</h2>
          <p className="location">{state.location.mapName}</p>
          {state.location.partyHere.length > 0 && (
            <p className="muted">With: {state.location.partyHere.join(', ')}</p>
          )}
        </section>
      )}

      {state.shop && <ShopPanel shop={state.shop} />}
      {state.chest && <ChestPanel chest={state.chest} />}

      <section className="card">
        <h2>Your art</h2>
        <div className="row">
          <CropInput label="Portrait (sheet)" onFile={(f) => uploadOwn('art', f)} />
          <CropInput label="Map token" round={c.token_shape !== 'square'} onFile={(f) => uploadOwn('token', f)} />
        </div>
        <label className="field"><span>Token shape</span>
          <select value={c.token_shape || 'circle'} onChange={(e) => patchMe('token_shape')(e.target.value)}>
            <option value="circle">circle</option>
            <option value="square">square</option>
            <option value="free">free (raw image)</option>
          </select>
        </label>
        <div className="row">
          {c.portrait && <img className="portrait" src={c.portrait} alt="portrait" />}
          <TokenSizePreview c={c} onSave={patchMe('token_scale')} />
        </div>
      </section>
    </>
  );
}

// Live visualizer: the token drawn at its size relative to the map default.
function TokenSizePreview({ c, onSave }) {
  const [v, setV] = useState(c.token_scale ?? 1);
  const [prev, setPrev] = useState(c.token_scale);
  if (c.token_scale !== prev) { setPrev(c.token_scale); setV(c.token_scale); }
  const px = 44 * v;
  return (
    <div className="token-size">
      <label className="field">
        <span>Token size ×{v} (vs the map default)</span>
        <input type="range" min="0.4" max="3" step="0.1" value={v}
          onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={() => onSave(v)}
          onKeyUp={(e) => e.key !== 'Tab' && onSave(v)} />
      </label>
      <div className="token-size-stage">
        <div className="token-size-ref" title="the map's default token size" />
        {c.token
          ? <img src={c.token} alt="token" style={{ width: px, height: px }} />
          : <span className="token-dot" style={{ background: c.token_color, width: px, height: px }} />}
      </div>
    </div>
  );
}

function StatInput({ value, onSave }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  return (
    <input className="stat-value-input" type="number" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => Number(v) !== value && onSave(Number(v))} />
  );
}

// Both panels appear only while the DM has "show on phone" ticked for you.
function ShopPanel({ shop }) {
  return (
    <section className="card shop-card">
      <h2>{shop.name}</h2>
      {shop.npc_name && <p className="muted">{shop.npc_name} — {shop.description}</p>}
      <ul className="inv-list">
        {shop.entries.map((e) => (
          <li key={e.entry_id}>
            <span>{e.name} ×{e.quantity}</span>
            <span className="gold">{e.price} gp</span>
          </li>
        ))}
        {shop.entries.length === 0 && <li className="muted">Nothing for sale.</li>}
      </ul>
      <p className="muted small">Trade happens through the keeper (your DM).</p>
    </section>
  );
}

function ChestPanel({ chest }) {
  return (
    <section className="card shop-card">
      <h2>A chest before you {chest.state === 'opened' ? '(open)' : ''}</h2>
      <ul className="inv-list">
        {chest.entries.map((e) => (
          <li key={e.entry_id}>
            <span>{e.name} ×{e.quantity}</span>
            <span className="muted small">{Math.round(e.weight * e.quantity * 10) / 10} wt</span>
          </li>
        ))}
        {chest.entries.length === 0 && <li className="muted">Empty.</li>}
      </ul>
      <p className="muted small">Your DM hands things over.</p>
    </section>
  );
}

function BagTab({ state, act, onDetail }) {
  const c = state.character;
  const weightPct = Math.max(0, Math.min(100, (c.carried_weight / (c.carry_capacity || 1)) * 100));
  const overloaded = c.carried_weight > c.carry_capacity;

  return (
    <section className="card">
      <h2>Inventory</h2>
      <div className="weight-row">
        <span>Weight {c.carried_weight} / {c.carry_capacity}</span>
        {overloaded && <span className="error">Overloaded!</span>}
      </div>
      <div className="bar"><div className={`bar-fill ${overloaded ? 'over' : 'weight'}`} style={{ width: `${weightPct}%` }} /></div>
      <ul className="inv-list">
        {c.inventory.map((e) => (
          <li key={e.entry_id}>
            <button className="linkish" onClick={() => onDetail(e)}>
              {e.name} {e.quantity > 1 ? `×${e.quantity}` : ''}
              {e.category === 'lore' && <span className="cat-badge inline">lore</span>}
            </button>
            <span>
              <span className="muted small">{Math.round(e.weight * e.quantity * 10) / 10} wt</span>
              <button className="mini" title="drop one" onClick={() =>
                act('POST', '/api/player/inventory/remove', { entryId: e.entry_id, quantity: 1 })}>−1</button>
              <button className="mini danger" title="drop all" onClick={() =>
                act('POST', '/api/player/inventory/remove', { entryId: e.entry_id, quantity: e.quantity })}>drop</button>
            </span>
          </li>
        ))}
        {c.inventory.length === 0 && <li className="muted">Empty pockets.</li>}
      </ul>
      <h3 className="muted small">Add from the catalog</h3>
      <GiveItem
        items={state.items.filter((i) => ['item', 'consumable'].includes(i.category) && !(i.tags || []).includes('custom'))}
        label="Add"
        onGive={(itemId, quantity) => act('POST', '/api/player/inventory/add', { itemId, quantity })} />
      <h3 className="muted small">Add a custom item you found</h3>
      <CustomItemForm act={act} />
    </section>
  );
}

// Players can also craft/find a custom weapon or armor (the catalog picker only
// offers items & consumables) — with its own stats.
function CustomItemForm({ act }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('item');
  const [weight, setWeight] = useState(0);
  const [damage, setDamage] = useState('');
  const [range, setRange] = useState(1);
  const [armor, setArmor] = useState(1);
  const reset = () => { setName(''); setWeight(0); setDamage(''); setRange(1); setArmor(1); };
  return (
    <div className="stack">
      <div className="row">
        <input placeholder="What is it?" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="item">item</option>
          <option value="consumable">consumable</option>
          <option value="weapon">weapon</option>
          <option value="armor">armor</option>
        </select>
        <input type="number" className="num" title="weight each" min="0" value={weight}
          onChange={(e) => setWeight(e.target.value)} />
      </div>
      {category === 'weapon' && (
        <div className="row">
          <input placeholder="Damage (e.g. 1d6+1)" value={damage} onChange={(e) => setDamage(e.target.value)} />
          <input type="number" className="num" title="range (m)" min="0" value={range}
            onChange={(e) => setRange(e.target.value)} />
        </div>
      )}
      {category === 'armor' && (
        <div className="row">
          <label className="field"><span>Armor value</span>
            <input type="number" min="0" value={armor} onChange={(e) => setArmor(e.target.value)} /></label>
        </div>
      )}
      <button disabled={!name.trim()} onClick={async () => {
        const body = { name: name.trim(), category, weight: Number(weight) || 0 };
        if (category === 'weapon') { body.damage = damage; body.range = Number(range) || 0; }
        if (category === 'armor') body.armor = Number(armor) || 0;
        if (await act('POST', '/api/player/inventory/custom', body)) reset();
      }}>Add</button>
    </div>
  );
}

function PowersTab({ c, act }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [circle, setCircle] = useState(0);
  // sorted by circle (0 = cantrip/none first), then name
  const powers = [...c.powers].sort((a, b) => (a.circle - b.circle) || a.name.localeCompare(b.name));
  return (
    <section className="card">
      <h2>Powers</h2>
      {powers.map((p) => (
        <div className="power" key={p.id}>
          <div className="row spread">
            <strong>{p.name}</strong>
            <span className="row">
              <label className="field circle-field"><span>Circle</span>
                <input type="number" min="0" value={p.circle ?? 0}
                  onChange={(e) => act('PATCH', `/api/player/powers/${p.id}`, { circle: Number(e.target.value) || 0 })} />
              </label>
              <button className="mini danger" onClick={() => act('DELETE', `/api/player/powers/${p.id}`)}>✕</button>
            </span>
          </div>
          <TextArea rows={2} value={p.description}
            onSave={(v) => act('PATCH', `/api/player/powers/${p.id}`, { description: v })} />
        </div>
      ))}
      {powers.length === 0 && <p className="muted">No powers written down yet.</p>}
      <div className="stack">
        <div className="row">
          <input placeholder="Power name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="field circle-field"><span>Circle</span>
            <input type="number" min="0" value={circle} onChange={(e) => setCircle(e.target.value)} /></label>
        </div>
        <textarea rows={2} placeholder="What it does…" value={description}
          onChange={(e) => setDescription(e.target.value)} />
        <button onClick={async () => {
          if (!name.trim()) return;
          if (await act('POST', '/api/player/powers', { name: name.trim(), description, circle: Number(circle) || 0 })) {
            setName(''); setDescription(''); setCircle(0);
          }
        }}>Add power</button>
      </div>
    </section>
  );
}

// Shared by the player and (with a different base URL) the DM diary tab.
export function DiaryTab({ entries, act, base }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <section className="card">
      <h2>Diary</h2>
      <div className="stack">
        <input placeholder="Entry title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea rows={4} placeholder="What happened…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button onClick={async () => {
          if (!title.trim() && !body.trim()) return;
          if (await act('POST', base, { title: title.trim(), body })) { setTitle(''); setBody(''); }
        }}>Write entry</button>
      </div>
      {(entries || []).map((d) => (
        <div className="diary-entry" key={d.id}>
          <div className="row spread">
            <strong>{d.title || 'Untitled'}</strong>
            <span className="muted small">{(d.created_at || '').slice(0, 16).replace('T', ' ')}
              <button className="mini danger" onClick={() => act('DELETE', `${base}/${d.id}`)}>✕</button>
            </span>
          </div>
          <TextArea rows={3} value={d.body} onSave={(v) => act('PATCH', `${base}/${d.id}`, { body: v })} />
        </div>
      ))}
      {(entries || []).length === 0 && <p className="muted">Nothing written yet.</p>}
    </section>
  );
}
