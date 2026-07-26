import React, { useState } from 'react';

// A compact searchable list: pick one option. `options` are {id, label, sub?}.
export default function PickerDialog({ title, hint, options, onPick, onClose, empty = 'Nothing to pick.' }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const matches = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog narrow" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        {hint && <p className="muted small">{hint}</p>}
        {options.length > 6 && (
          <input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%' }} />
        )}
        <ul className="pick-list">
          {matches.map((o) => (
            <li key={o.id}>
              <button className="linkish" onClick={() => { onPick(o); onClose(); }}>{o.label}</button>
              {o.sub && <span className="muted small"> — {o.sub}</span>}
            </li>
          ))}
          {!matches.length && <li className="muted small">{options.length ? 'No match.' : empty}</li>}
        </ul>
      </div>
    </div>
  );
}
