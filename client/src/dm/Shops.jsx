import React, { useEffect, useState } from 'react';
import { Field, GiveItem } from '../fields.jsx';
import { shopBuyPrice, SELLER_TYPES } from '../../../shared/gameRules.js';

// Shop management: stock, prices, random weapon restocks, the day-tick
// economy, and manual trade sessions.
export default function Shops({ global, act }) {
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState(null);

  return (
    <div className="panel">
      <div className="row">
        <input placeholder="New shop name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button onClick={async () => {
          if (newName.trim() && await act('POST', '/api/dm/shops', { name: newName.trim() })) setNewName('');
        }}>Create shop</button>
        <span className="spacer" />
        <span className="muted">Day {global.shopDay}</span>
        <button title="Each player-sold stack has a 25% chance to vanish" onClick={async () => {
          const res = await act('POST', '/api/dm/shops/advance-day');
          if (res) alert(`Day ${res.day}: rolled ${res.rolled} sold-recently stacks, ${res.vanished} vanished.`);
        }}>Advance shop day</button>
      </div>

      {global.shops.map((s) => (
        <div className="card" key={s.id}>
          <header className="row spread clickable" onClick={() => setOpen(open === s.id ? null : s.id)}>
            <strong>{s.name}</strong>
            <span className="muted small">
              {SELLER_TYPES[s.category]?.label || s.category} · {s.npc_name} · {global.maps.find((m) => m.id === s.map_id)?.name || 'unplaced'}
            </span>
          </header>
          {open === s.id && <ShopEditor shop={s} global={global} act={act} />}
        </div>
      ))}
      {global.shops.length === 0 && <p className="muted pad">No shops yet.</p>}
    </div>
  );
}

function ShopEditor({ shop, global, act }) {
  const [data, setData] = useState(null);
  const [tradeWith, setTradeWith] = useState(global.characters[0]?.id);
  const [restockN, setRestockN] = useState(3);

  useEffect(() => {
    let live = true;
    act('GET', `/api/dm/shops/${shop.id}`).then((res) => live && res && setData(res));
    return () => { live = false; };
  }, [shop.id, global]); // refetch on every push: stock/prices change server-side

  return (
    <div className="char-editor">
      <div className="field-grid">
        <Field label="Name" value={shop.name} onSave={(v) => act('PATCH', `/api/dm/shops/${shop.id}`, { name: v })} />
        <Field label="Keeper (NPC)" value={shop.npc_name} onSave={(v) => act('PATCH', `/api/dm/shops/${shop.id}`, { npc_name: v })} />
        <label className="field"><span>Seller type</span>
          <select value={shop.category} onChange={(e) => act('PATCH', `/api/dm/shops/${shop.id}`, { category: e.target.value })}>
            {Object.entries(SELLER_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <Field label="Description" value={shop.description} onSave={(v) => act('PATCH', `/api/dm/shops/${shop.id}`, { description: v })} />

      <h4>Stock <span className="muted small">(• sold recently — may vanish on day tick · "players get" = payout if sold back)</span></h4>
      <ul className="inv-list">
        {(data?.entries || []).map((e) => (
          <li key={e.entry_id}>
            <span>
              {e.name} ×{e.quantity}{e.sold_recently ? ' •' : ''}
              {e.category === 'weapon' && <span className="muted small"> {e.damage} · {e.range} m</span>}
              {e.category === 'armor' && <span className="muted small"> armor +{e.armor}</span>}
            </span>
            <span className="row">
              <PriceInput value={e.price} onSave={(v) =>
                act('POST', '/api/dm/inventory/set-price', { entryId: e.entry_id, price: v })} />
              <span className="muted small">players get {shopBuyPrice(e.price)}</span>
              <button className="mini danger" onClick={() =>
                act('POST', '/api/dm/inventory/remove', { entryId: e.entry_id, quantity: e.quantity })}>del</button>
            </span>
          </li>
        ))}
        {(data?.entries || []).length === 0 && <li className="muted">Empty shelves.</li>}
      </ul>
      <GiveItem items={global.items} label="Stock" onGive={(itemId, qty) =>
        act('POST', '/api/dm/inventory/add', { ownerType: 'shop', ownerId: shop.id, itemId, quantity: qty })} />

      <div className="row">
        <input type="number" className="num" min="1" max="12" value={restockN}
          onChange={(e) => setRestockN(Number(e.target.value))} />
        <button title="Random weapons matching this seller type, rank-weighted" onClick={async () => {
          const res = await act('POST', `/api/dm/shops/${shop.id}/restock-weapons`, { count: restockN });
          if (res) alert('Restocked:\n' + res.added.map((w) =>
            `${w.name} — ${w.damage}, ${w.range} m, ${w.value} gp (${w.rarity})`).join('\n'));
        }}>Restock weapons</button>
        <button title="Random armor matching this seller type, rank-weighted" onClick={async () => {
          const res = await act('POST', `/api/dm/shops/${shop.id}/restock-armor`, { count: restockN });
          if (res) alert('Restocked:\n' + res.added.map((a) =>
            `${a.name} — armor +${a.armor}, ${a.value} gp (${a.rarity})`).join('\n'));
        }}>Restock armor</button>
      </div>

      <div className="row">
        <select value={tradeWith} onChange={(e) => setTradeWith(Number(e.target.value))}>
          {global.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => act('POST', '/api/dm/shop-session', { shopId: shop.id, characterId: tradeWith })}>
          Trade with them (opens on their phone too)
        </button>
        <span className="spacer" />
        <button className="danger" onClick={() => {
          if (confirm(`Delete shop "${shop.name}"?`)) act('DELETE', `/api/dm/shops/${shop.id}`);
        }}>Delete shop</button>
      </div>
      <p className="muted small">Place the shop on a map in the Map editor; drag a player token onto it to trade.</p>
    </div>
  );
}

function PriceInput({ value, onSave }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  return (
    <input type="number" className="num" value={v ?? 0}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => Number(v) !== value && onSave(Number(v))}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
  );
}
