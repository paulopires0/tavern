import React, { useState } from 'react';

// Small save-on-blur editors shared by the DM console and the player sheet.
// Each syncs itself when the server pushes a new value.

export function Field({ label, value, onSave, type = 'text', instant = false }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={v ?? ''}
        onChange={(e) => { setV(e.target.value); if (instant) onSave(e.target.value); }}
        onBlur={() => !instant && v !== value && onSave(v)}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
    </label>
  );
}

export function NumField({ label, value, onSave, step }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} value={v ?? 0}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => Number(v) !== value && onSave(Number(v))}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
    </label>
  );
}

export function TextArea({ value, onSave, rows = 4, placeholder }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setText(value); }
  return (
    <textarea rows={rows} value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)} />
  );
}

export function GiveItem({ items, onGive, label = 'Add item' }) {
  const [itemId, setItemId] = useState(items[0]?.id);
  const [qty, setQty] = useState(1);
  if (!items.length) return <p className="muted small">No items defined yet.</p>;
  return (
    <div className="row">
      <select value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <input type="number" className="num" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
      <button onClick={() => onGive(Number(itemId), qty)}>{label}</button>
    </div>
  );
}
