import React, { useEffect, useState } from 'react';
import { upload } from '../api.js';

// Loot UI opened by dropping a character on a chest (or from the editor).
// Auto-generate rolls rarity-weighted items server-side (never lore items);
// "give" moves an entry into the chosen character's inventory. The contents
// mirror onto a player's phone only while "show on phone" is ticked.
export default function ChestDialog({ chestId, characterId, characters, session, act, onClose }) {
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(characterId ?? characters[0]?.id);
  const [genCount, setGenCount] = useState(3);

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
