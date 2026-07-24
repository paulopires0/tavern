import React, { useMemo, useState } from 'react';
import { mapSetupIssues } from './mapSetup.js';

// A pre-play checklist, surfaced as a small square in the corner of the map
// editor: which maps still need their ruler measured, an ambient track, or a
// spot on the kingdom map (see mapSetupIssues for the exact rules).
export default function MapChecklist({ maps, onJump }) {
  const [open, setOpen] = useState(false);
  const issues = useMemo(() => mapSetupIssues(maps), [maps]);
  const n = issues.length;

  return (
    <div className="map-checklist">
      <button className={`map-checklist-btn ${n ? 'warn' : 'ok'}`}
        title={n ? `${n} map${n > 1 ? 's' : ''} need setup` : 'Every map is set up'}
        onClick={() => setOpen((v) => !v)}>
        {n || '✓'}
      </button>
      {open && (
        <div className="map-checklist-panel">
          <header className="row spread">
            <strong>Map setup</strong>
            <button className="ghost small" onClick={() => setOpen(false)}>✕</button>
          </header>
          {n === 0 ? (
            <p className="muted small">Every map has its ruler, ambient music and kingdom spot.</p>
          ) : (
            <ul className="checklist-list">
              {issues.map(({ map, missing }) => (
                <li key={map.id}>
                  <button className="linkish" title="Open this map"
                    onClick={() => { onJump(map.id); setOpen(false); }}>{map.name}</button>
                  <ul>
                    {missing.map((x) => <li key={x} className="muted small">{x}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
