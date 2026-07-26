import React, { useMemo } from 'react';
import { layoutGraph, edgePath, edgeKey, GRAPH } from './mapGraphLayout.js';

// A branching map of every playable map, doors as branches. Better-connected
// maps (hubs) draw as bigger dots. Click one to jump the Live view there.
// Layout is a tidy tree (see mapGraphLayout.js), memoized on the topology so it
// doesn't re-jiggle on unrelated state pushes.
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

  const { nodes, treeEdges, view } = useMemo(() => layoutGraph(maps, edges), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodeAt = (id) => nodes.find((n) => n.id === id);
  const lonely = nodes.filter((n) => n.lonely).length;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide map-graph" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>All maps</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <p className="muted small">
          Every branch is a door. Bigger dots have more of them — click a map to view it. Click a
          <strong style={{ color: '#e4b343' }}> branch</strong> to toggle a
          <strong> kingdom journey</strong> (gold dashes): going through that door plays the world-map trip.
          {lonely > 0 && ` ${lonely} map${lonely > 1 ? 's have' : ' has'} no doors yet.`}
        </p>
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="map-graph-svg">
          {edges.map((e) => {
            const a = nodeAt(e.a);
            const b = nodeAt(e.b);
            if (!a || !b) return null;
            const d = edgePath(a, b);
            const isBranch = treeEdges.has(edgeKey(e.a, e.b));
            return (
              <g key={`${e.a}-${e.b}`} className="graph-edge"
                onClick={() => onToggleLink?.(e.a, e.b, !e.travel)}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                <path d={d} fill="none"
                  stroke={e.travel ? '#e4b343' : '#6b5433'}
                  strokeWidth={e.travel ? 3 : 2}
                  strokeLinecap="round"
                  strokeDasharray={e.travel ? '11 7' : isBranch ? undefined : '4 6'}
                  strokeOpacity={isBranch ? 1 : 0.7} />
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
                  stroke={cur ? '#fff3d6' : n.lonely ? '#6b5433' : '#e4c76b'}
                  strokeWidth={2}
                  strokeDasharray={n.lonely ? '3 3' : undefined} />
                <text x={n.x + n.r + GRAPH.LABEL_PAD} y={n.y}
                  dominantBaseline="middle" textAnchor="start"
                  fontSize={GRAPH.FONT} fontWeight={cur || active ? 700 : 400}
                  fill={n.lonely ? '#b3a68c' : '#f3ead6'}
                  stroke="#000" strokeWidth={2.6} paintOrder="stroke">
                  {n.name}{n.template ? ' (t)' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
