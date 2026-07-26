import React, { useEffect, useRef } from 'react';

// A floating right-click menu on the live map. `items` are
// {label, onClick, danger?, disabled?} or {sep:true}. Closes on outside click,
// Escape, or after an action runs.
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const outside = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const real = items.filter((it) => !it.sep);
  const style = {
    left: Math.min(x, window.innerWidth - 210),
    top: Math.min(y, Math.max(8, window.innerHeight - 24 - real.length * 34)),
  };
  return (
    <div ref={ref} className="ctx-menu" style={style}>
      {items.map((it, i) => (it.sep
        ? <div key={i} className="ctx-sep" />
        : (
          <button key={i} className={`ctx-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}>{it.label}</button>
        )))}
    </div>
  );
}
