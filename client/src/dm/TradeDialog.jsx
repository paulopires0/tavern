import React, { useEffect, useState } from 'react';
import { shopBuyPrice } from '../../../shared/gameRules.js';

// Two-pane trade UI, opened automatically when a shop session exists (set by
// dropping a player token on a shop). Gold moves per shared/gameRules.js;
// the player's phone mirrors the shop stock while the session is open.
export default function TradeDialog({ session, global, act }) {
  const [shopData, setShopData] = useState(null);
  const character = global.characters.find((c) => c.id === session.characterId);
  const shopMeta = global.shops.find((s) => s.id === session.shopId);

  async function refresh() {
    const res = await act('GET', `/api/dm/shops/${session.shopId}`);
    if (res) setShopData(res);
  }
  // Shop stock changes on every trade — global pushes are the refresh signal.
  useEffect(() => { refresh(); }, [session.shopId, global]);

  if (!shopData || !character) return null;

  const close = () => act('DELETE', '/api/dm/shop-session');

  async function trade(entry, direction) {
    await act('POST', '/api/dm/trade', {
      shopId: session.shopId, characterId: character.id,
      entryId: entry.entry_id, quantity: 1, direction,
    });
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>{shopData.shop.name} {shopData.shop.npc_name && <span className="muted">— {shopData.shop.npc_name}</span>}</h3>
          <span className="gold">{character.name}: {character.gold} gp</span>
          <button className="ghost" onClick={close}>✕ End trade</button>
        </header>
        <label className="row small">
          <input type="checkbox" checked={!!session.shared}
            onChange={(e) => act('POST', '/api/dm/shop-session',
              { shopId: session.shopId, characterId: session.characterId, shared: e.target.checked })} />
          Show the stock on {character.name}'s phone
        </label>

        <div className="trade-panes">
          <div className="pane">
            <h4>Shop stock <span className="muted small">(• = sold recently, may vanish)</span></h4>
            <ul className="inv-list">
              {shopData.entries.map((e) => (
                <li key={e.entry_id}>
                  <span title={e.description}>{e.name} ×{e.quantity}{e.sold_recently ? ' •' : ''}</span>
                  <span>
                    <span className="gold">{e.price} gp</span>
                    <button className="mini" disabled={character.gold < e.price}
                      onClick={() => trade(e, 'buy')}>buy</button>
                  </span>
                </li>
              ))}
              {shopData.entries.length === 0 && <li className="muted">Sold out.</li>}
            </ul>
          </div>
          <div className="pane">
            <h4>{character.name}'s bag</h4>
            <ul className="inv-list">
              {character.inventory.map((e) => {
                const listed = shopData.entries.find((se) => se.item_id === e.id || se.id === e.id);
                const payout = shopBuyPrice(listed?.price ?? e.value);
                return (
                  <li key={e.entry_id}>
                    <span title={e.description}>{e.name} ×{e.quantity}</span>
                    <button className="mini" onClick={() => trade(e, 'sell')}>sell for {payout} gp</button>
                  </li>
                );
              })}
              {character.inventory.length === 0 && <li className="muted">Nothing to sell.</li>}
            </ul>
          </div>
        </div>
        <p className="muted small">Shop buys at 50% of list price (tunable in shared/gameRules.js). Player-sold stock may vanish on day ticks.</p>
      </div>
    </div>
  );
}
