import React, { useState } from 'react';
import { Field, NumField, TextArea } from '../fields.jsx';
import { upload } from '../api.js';
import { CropInput } from '../ImageCropper.jsx';

// NPC dossier. Art = the portrait you can flash on the TV; token = the image
// standing on the map. Notes never reach players.
export default function NPCs({ global, act }) {
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState(null);

  return (
    <div className="panel">
      <div className="row">
        <input placeholder="New NPC name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button onClick={async () => {
          if (newName.trim() && await act('POST', '/api/dm/npcs', { name: newName.trim() })) setNewName('');
        }}>Create NPC</button>
        <span className="spacer" />
        {global.tvOverlay && (
          <button onClick={() => act('DELETE', '/api/dm/tv-overlay')}>Hide TV image</button>
        )}
      </div>

      {global.npcs.map((n) => (
        <div className="card" key={n.id}>
          <header className="row spread clickable" onClick={() => setOpen(open === n.id ? null : n.id)}>
            <span className="row">
              {n.token && <img className="portrait small round" src={n.token} alt="" />}
              <strong>{n.name}</strong>
            </span>
            <span className="muted small">{global.maps.find((m) => m.id === n.map_id)?.name || 'unplaced'}</span>
          </header>
          {open === n.id && (
            <div className="char-editor">
              <div className="field-grid">
                <Field label="Name" value={n.name} onSave={(v) => act('PATCH', `/api/dm/npcs/${n.id}`, { name: v })} />
                <NumField label="Token size ×" value={n.token_scale} step={0.1}
                  onSave={(v) => act('PATCH', `/api/dm/npcs/${n.id}`, { token_scale: Math.max(0.2, v || 1) })} />
                <label className="field"><span>Token shape</span>
                  <select value={n.token_shape || 'free'} onChange={(e) => act('PATCH', `/api/dm/npcs/${n.id}`, { token_shape: e.target.value })}>
                    <option value="free">free</option>
                    <option value="circle">circle</option>
                    <option value="square">square</option>
                  </select>
                </label>
              </div>
              <Field label="Description" value={n.description} onSave={(v) => act('PATCH', `/api/dm/npcs/${n.id}`, { description: v })} />
              <label className="field">
                <span>DM notes (never shown to players)</span>
                <TextArea value={n.notes} onSave={(v) => act('PATCH', `/api/dm/npcs/${n.id}`, { notes: v })} />
              </label>
              <div className="row">
                {n.portrait && <img className="portrait" src={n.portrait} alt="art" />}
                {n.token && <img className="portrait round" src={n.token} alt="token" />}
                <CropInput label="Art (can be shown on TV)"
                  onFile={async (f) => act('PATCH', `/api/dm/npcs/${n.id}`, { portrait: await upload('npc-art', f) })} />
                <CropInput label="Map token" round={n.token_shape !== 'square'}
                  onFile={async (f) => act('PATCH', `/api/dm/npcs/${n.id}`, { token: await upload('npc-token', f) })} />
              </div>
              <div className="row">
                <button onClick={() => n.portrait &&
                  act('POST', '/api/dm/tv-overlay', { url: n.portrait, title: n.name })}>
                  Show face on TV
                </button>
                <span className="spacer" />
                <button className="danger" onClick={() => {
                  if (confirm(`Delete NPC "${n.name}"?`)) act('DELETE', `/api/dm/npcs/${n.id}`);
                }}>Delete</button>
              </div>
              <p className="muted small">Place them on a map in the Map editor.</p>
            </div>
          )}
        </div>
      ))}
      {global.npcs.length === 0 && <p className="muted pad">No NPCs yet.</p>}
    </div>
  );
}
