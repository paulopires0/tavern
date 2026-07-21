import React from 'react';
import { INK_COLORS, INK_WIDTHS_M } from '../../../shared/gameRules.js';

// The DM's drawing palette, floating on the left edge of the map. Off by
// default: with no tool picked the map behaves normally (pan, drag tokens), so
// drawing never gets in the way of running the table. Whatever is drawn shows
// up on the TV as well — it is how you circle an ambush or sketch a barricade
// mid-scene.
const TOOLS = [
  { id: 'brush', label: 'Draw', hint: 'Freehand', icon: '✎' },
  { id: 'line', label: 'Line', hint: 'Straight line', icon: '╱' },
  { id: 'rect', label: 'Box', hint: 'Rectangle', icon: '▭' },
  { id: 'eraser', label: 'Rubber', hint: 'Rub ink away', icon: '◻' },
];

export default function PaintBar({ paint, setPaint, onUndo, onClear, hasInk }) {
  const on = !!paint;
  const set = (patch) => setPaint((p) => ({ ...(p || {}), ...patch }));

  return (
    <div className={`paintbar ${on ? 'on' : ''}`}>
      <button className={`paint-power ${on ? 'active' : ''}`}
        title={on ? 'Stop drawing (back to moving tokens)' : 'Draw on the map — the TV sees it too'}
        onClick={() => setPaint(on ? null : { kind: 'ink', tool: 'brush' })}>
        {on ? '✕' : '🖌'}
      </button>

      {on && (
        <>
          <div className="paint-tools">
            {TOOLS.map((t) => (
              <button key={t.id} title={`${t.label} — ${t.hint}`}
                className={`paint-btn ${paint.tool === t.id ? 'active' : ''}`}
                onClick={() => set({ tool: t.id })}>
                {t.icon}
              </button>
            ))}
          </div>

          <div className="paint-colors">
            {INK_COLORS.map((c) => (
              <button key={c} title={paint.tool === 'eraser' ? 'Pick a drawing tool to use this colour' : 'Ink colour'}
                className={`paint-swatch ${paint.color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => set({ color: c, tool: paint.tool === 'eraser' ? 'brush' : paint.tool })} />
            ))}
          </div>

          <div className="paint-widths">
            {INK_WIDTHS_M.map((m) => (
              <button key={m} title={`${m} m thick`}
                className={`paint-btn ${paint.widthM === m ? 'active' : ''}`}
                onClick={() => set({ widthM: m })}>
                <span className="paint-dot" style={{
                  width: 3 + m * 2.2, height: 3 + m * 2.2,
                  background: paint.tool === 'eraser' ? '#e8e2d4' : (paint.color || INK_COLORS[0]),
                }} />
              </button>
            ))}
          </div>

          <div className="paint-acts">
            <button className="paint-btn" title="Undo the last stroke" disabled={!hasInk} onClick={onUndo}>↶</button>
            <button className="paint-btn danger" title="Wipe all drawing on this map" disabled={!hasInk}
              onClick={() => { if (confirm('Erase everything drawn on this map?')) onClear(); }}>🗑</button>
          </div>
        </>
      )}
    </div>
  );
}
