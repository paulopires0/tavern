import React, { useMemo } from 'react';

// A graph of every playable map, doors as edges. Better-connected maps (hubs)
// draw as bigger nodes. Click one to jump the Live view there. Layout is a
// small deterministic force simulation, memoized on the topology so it doesn't
// re-jiggle on unrelated state pushes.
export default function MapGraph({ maps, links, currentId, activeId, onPick, onToggleLink, onClose }) {
  const nodeIds = new Set(maps.map((m) => m.id));

  // undirected, de-duplicated edges (a door + its reverse count once); an edge
  // is a "kingdom journey" if any door between the pair is flagged.
  const edges = useMemo(() => {
    const uniq = new Map();
    for (const l of links || []) {
      if (l.map_id === l.target_map_id) continue;
      if (!nodeIds.has(l.map_id) || !nodeIds.has(l.target_map_id)) continue;
      const a = Math.min(l.map_id, l.target_map_id);
      const b = Math.max(l.map_id, l.target_map_id);
      const key = `${a}-${b}`;
      const prev = uniq.get(key);
      uniq.set(key, { a, b, travel: (prev?.travel || !!l.world_travel) });
    }
    return [...uniq.values()];
  }, [links, maps]); // eslint-disable-line react-hooks/exhaustive-deps

  const sig = maps.map((m) => m.id).join(',') + '|' + edges.map((e) => `${e.a}-${e.b}`).join(',');

  const { nodes, view } = useMemo(() => layout(maps, edges), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodeAt = (id) => nodes.find((n) => n.id === id);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide map-graph" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>All maps</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <p className="muted small">
          Bigger nodes have more doors — click a node to view its map. Click a
          <strong style={{ color: '#e4b343' }}> line</strong> to toggle a
          <strong> kingdom journey</strong> (gold dashes): going through that door plays the world-map trip.
        </p>
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="map-graph-svg">
          {edges.map((e) => {
            const a = nodeAt(e.a);
            const b = nodeAt(e.b);
            return (
              <g key={`${e.a}-${e.b}`} className="graph-edge" onClick={() => onToggleLink?.(e.a, e.b, !e.travel)}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={view.w / 45} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={e.travel ? '#e4b343' : '#6b5433'}
                  strokeWidth={e.travel ? view.w / 210 : view.w / 320}
                  strokeDasharray={e.travel ? `${view.w / 55} ${view.w / 90}` : undefined} />
              </g>
            );
          })}
          {nodes.map((n) => {
            const cur = n.id === currentId;
            const active = n.id === activeId;
            return (
              <g key={n.id} className="graph-node" onClick={() => { onPick(n.id); onClose(); }}>
                <circle cx={n.x} cy={n.y} r={n.r}
                  fill={cur ? '#e4b343' : active ? '#4f8ef7' : '#3a2c1a'}
                  stroke={cur ? '#fff3d6' : '#e4c76b'} strokeWidth={view.w / 380} />
                <text x={n.x} y={n.y + n.r + view.w / 60} textAnchor="middle"
                  fontSize={view.w / 55} fill="#f3ead6" stroke="#000" strokeWidth={view.w / 900}
                  paintOrder="stroke">{n.name}{n.template ? ' (t)' : ''}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function layout(maps, edges) {
  const nodes = maps.map((m, i) => {
    const a = (i / Math.max(1, maps.length)) * Math.PI * 2;
    return { id: m.id, name: m.name, template: !!m.is_template, deg: 0,
      x: Math.cos(a) * 300, y: Math.sin(a) * 300 };
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  for (const e of edges) { nodes[idx.get(e.a)].deg++; nodes[idx.get(e.b)].deg++; }

  const n = nodes.length;
  for (let iter = 0; iter < 240; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = 9000 / d2;
        dx /= d; dy /= d;
        nodes[i].x += dx * f; nodes[i].y += dy * f;
        nodes[j].x -= dx * f; nodes[j].y -= dy * f;
      }
    }
    for (const e of edges) {
      const A = nodes[idx.get(e.a)];
      const B = nodes[idx.get(e.b)];
      let dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 130) * 0.02;
      dx /= d; dy /= d;
      A.x += dx * f; A.y += dy * f;
      B.x -= dx * f; B.y -= dy * f;
    }
  }

  for (const nd of nodes) nd.r = 12 + Math.sqrt(nd.deg) * 9;

  // fit the viewBox to all nodes (+ their radii and labels)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const nd of nodes) {
    minX = Math.min(minX, nd.x - nd.r); minY = Math.min(minY, nd.y - nd.r);
    maxX = Math.max(maxX, nd.x + nd.r); maxY = Math.max(maxY, nd.y + nd.r);
  }
  if (!isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }
  const padX = (maxX - minX) * 0.12 + 40;
  const padY = (maxY - minY) * 0.18 + 40;
  const view = { x: minX - padX, y: minY - padY, w: (maxX - minX) + padX * 2, h: (maxY - minY) + padY * 2 };
  return { nodes, view };
}
