import React, { useState } from 'react';
import { Field, NumField, TextArea } from '../fields.jsx';
import { upload } from '../api.js';
import { CropInput } from '../ImageCropper.jsx';

// The monster database: define a creature once (art, token, stats, HP, size),
// then spawn instances from the Live tab's "from bestiary" picker.
export default function Bestiary({ global, act }) {
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState(null);

  return (
    <div className="panel">
      <div className="row">
        <input placeholder="New monster name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button onClick={async () => {
          if (newName.trim() && await act('POST', '/api/dm/monster-templates', { name: newName.trim() })) {
            setNewName('');
          }
        }}>Add to bestiary</button>
      </div>
      <p className="muted small">Spawn these onto any map from the Live tab. Editing a template does not change monsters already on the board.</p>

      {global.monsterTemplates.map((t) => (
        <div className="card" key={t.id}>
          <header className="row spread clickable" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span className="row">
              {t.icon && <img className="portrait small" src={t.icon} alt="" />}
              <strong>{t.name}</strong>
            </span>
            <span className="muted small">HP {t.hp} · size ×{t.token_scale}</span>
          </header>
          {open === t.id && (
            <div className="char-editor">
              <div className="field-grid">
                <Field label="Name" value={t.name} onSave={(v) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { name: v })} />
                <NumField label="HP" value={t.hp} onSave={(v) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { hp: v })} />
                <NumField label="Token size ×" value={t.token_scale} step={0.1}
                  onSave={(v) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { token_scale: Math.max(0.2, v || 1) })} />
                <label className="field"><span>Token shape</span>
                  <select value={t.token_shape || 'free'}
                    onChange={(e) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { token_shape: e.target.value })}>
                    <option value="free">free</option>
                    <option value="circle">circle</option>
                    <option value="square">square</option>
                  </select>
                </label>
              </div>
              <label className="field"><span>Stats (free-form JSON, DM-only)</span>
                <StatsEditor value={t.stats} onSave={(v) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { stats: v })} />
              </label>
              <label className="field"><span>Notes</span>
                <TextArea rows={2} value={t.notes} onSave={(v) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { notes: v })} />
              </label>
              <div className="row">
                {t.icon && <img className="portrait round" src={t.icon} alt="token" />}
                {t.art && <img className="portrait" src={t.art} alt="art" />}
                <CropInput label="Token image" round={t.token_shape === 'circle'}
                  onFile={async (f) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { icon: await upload('monster-token', f) })} />
                <CropInput label="Art"
                  onFile={async (f) => act('PATCH', `/api/dm/monster-templates/${t.id}`, { art: await upload('monster-art', f) })} />
              </div>
              <div className="row end">
                <button className="danger" onClick={() => {
                  if (confirm(`Delete "${t.name}" from the bestiary? (spawned monsters stay)`)) {
                    act('DELETE', `/api/dm/monster-templates/${t.id}`);
                  }
                }}>Delete template</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {global.monsterTemplates.length === 0 && <p className="muted pad">The bestiary is empty.</p>}
    </div>
  );
}

function StatsEditor({ value, onSave }) {
  const [text, setText] = useState(JSON.stringify(value));
  const [prev, setPrev] = useState(JSON.stringify(value));
  const current = JSON.stringify(value);
  if (current !== prev) { setPrev(current); setText(current); }
  return (
    <input value={text} onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          const parsed = JSON.parse(text || '{}');
          if (JSON.stringify(parsed) !== current) onSave(parsed);
        } catch { setText(current); }
      }} />
  );
}
