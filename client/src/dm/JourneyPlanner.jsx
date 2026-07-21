import React, { useState } from 'react';
import MapCanvas from '../MapCanvas.jsx';

// The party stepped through a door that crosses the kingdom. Before anything
// moves, the DM draws the ROAD they take on the world map — click the corners
// between the two towns. The journey then replays exactly that path on the TV
// (walking it, uncovering it) and drops them in the destination city.
export default function JourneyPlanner({ plan, maps, act, onStart, onClose }) {
  const [path, setPath] = useState([]);
  const world = maps.find((m) => m.id === plan.worldId);
  const from = maps.find((m) => m.id === plan.fromMapId);
  const to = maps.find((m) => m.id === plan.toMapId);
  if (!world || !from || !to) return null;

  const r = Math.max(12, world.image_w / 70);
  const rings = [
    { x: from.world_x, y: from.world_y, radiusPx: r, color: '#6fcf7f', label: `from ${from.name}` },
    { x: to.world_x, y: to.world_y, radiusPx: r, color: '#e4b343', label: `to ${to.name}` },
  ];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide journey-planner" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>The road to {to.name}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <p className="muted small">
          Click the corners of the route they follow — around the mountains, along the
          river, wherever they actually go. The ends are anchored to the two towns, so
          no clicks at all means a straight road. {path.length} corner{path.length === 1 ? '' : 's'}.
        </p>
        <div className="journey-map">
          <MapCanvas
            map={world}
            rings={rings}
            guide={{ kind: 'sight', points: [[from.world_x, from.world_y], ...path], close: false }}
            onCanvasClick={(x, y) => setPath((p) => [...p, [x, y]])}
          />
        </div>
        <div className="row">
          <button onClick={() => onStart(path)}>Start the journey</button>
          <button className="mini" disabled={!path.length} onClick={() => setPath((p) => p.slice(0, -1))}>Undo corner</button>
          <button className="mini" disabled={!path.length} onClick={() => setPath([])}>Clear</button>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>Cancel — they stay put</button>
        </div>
      </div>
    </div>
  );
}
