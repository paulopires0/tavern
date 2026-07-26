import React, { useState } from 'react';

// A piece of loot the DM dropped on the floor (DM-only). Hand it to a character
// — it moves into their bag and the drop is cleared — or pick it back up.
export default function GroundItemDialog({ drop, characters, act, onClose }) {
  const [target, setTarget] = useState(characters[0]?.id);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog narrow" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>On the floor: {drop.name}{drop.quantity > 1 ? ` ×${drop.quantity}` : ''}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <p className="muted small">The players can't see this until you give it to one of them.</p>

        <div className="row">
          <label>Give to:&nbsp;
            <select value={target ?? ''} onChange={(e) => setTarget(Number(e.target.value))}>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button disabled={!target} onClick={async () => {
            if (await act('POST', `/api/dm/ground-items/${drop.id}/give`, { characterId: Number(target) })) onClose();
          }}>Give</button>
        </div>

        <div className="row">
          <button className="danger" onClick={async () => {
            if (await act('DELETE', `/api/dm/ground-items/${drop.id}`)) onClose();
          }}>Remove from the floor</button>
        </div>
      </div>
    </div>
  );
}
