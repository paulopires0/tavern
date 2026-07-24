import React, { useEffect, useState } from 'react';
import MapCanvas from '../MapCanvas.jsx';
import MapChecklist from './MapChecklist.jsx';
import { upload } from '../api.js';
import { NumField } from '../fields.jsx';
import { pointSegDist, strokeSegments } from '../../../shared/geometry.js';
import { WEATHERS } from '../../../shared/gameRules.js';

const KINDS = [
  ['wall', 'Wall — blocks movement and sight'],
  ['sight', 'Curtain — blocks sight only'],
  ['cliff', 'Cliff — one-way (arrows show the allowed direction)'],
];

// Upload a map background and measure its pixel size for the map's coordinate
// space. SVGs are kept AS VECTORS — never flattened to a raster — so the art
// stays perfectly sharp at any zoom (a viewBox-only SVG has its size read from
// the viewBox when the browser reports none).
async function uploadMapImage(file) {
  const path = await upload('maps', file);
  const dims = await measureImage(path, file);
  return { path, w: dims.w, h: dims.h };
}

function svgViewBoxSize(file) {
  return file.text().then((text) => {
    const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.eE]+\s+[-\d.eE]+\s+([-\d.eE]+)\s+([-\d.eE]+)/i);
    if (vb) return { w: Math.round(+vb[1]) || 1600, h: Math.round(+vb[2]) || 1000 };
    return { w: 1600, h: 1000 };
  }).catch(() => ({ w: 1600, h: 1000 }));
}

function measureImage(url, file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      if (img.naturalWidth && img.naturalHeight) resolve({ w: img.naturalWidth, h: img.naturalHeight });
      else resolve(await svgViewBoxSize(file)); // SVG with no intrinsic px size
    };
    img.onerror = async () => resolve(await svgViewBoxSize(file));
    img.src = url;
  });
}

// Continuous-map editor: paint physics with brush/line/rectangle, calibrate
// with the ruler, place world objects, and wire doors by clicking the
// DESTINATION map first.
export default function MapEditor({ global, detail, viewMapId, setViewMapId, act }) {
  const [tool, setTool] = useState('pan'); // pan|brush|line|rect|ruler|door|chest|shop|npc|remove
  const [kind, setKind] = useState('wall');
  const [widthM, setWidthM] = useState(0.5); // brush width in meters
  const [newMap, setNewMap] = useState({ name: '' });
  const [doorForm, setDoorForm] = useState({ targetMapId: '', label: '', reverse: true, target: null });
  const [doorPickerOpen, setDoorPickerOpen] = useState(false);
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);
  const [placeShopId, setPlaceShopId] = useState('');
  const [placeNpcId, setPlaceNpcId] = useState('');
  const [ruler, setRuler] = useState(null); // {x, y} first click
  const [poly, setPoly] = useState([]);     // Path tool: corners placed so far
  const [polyClose, setPolyClose] = useState(false);

  const map = detail?.map;
  const strokes = detail?.strokes || [];
  const paint = ['brush', 'line', 'rect', 'erase'].includes(tool) && map
    ? { kind: tool === 'erase' ? 'erase' : kind, tool: tool === 'erase' ? 'brush' : tool, width: Math.max(2, widthM * map.scale) }
    : null;

  // A half-drawn path shouldn't survive a map switch or a tool change.
  useEffect(() => { setPoly([]); }, [viewMapId, tool]);

  function commitPoly(pts = poly, close = polyClose) {
    if (!map || pts.length < 2) { setPoly([]); return; }
    const points = close && pts.length >= 3 ? [...pts, pts[0]] : pts;
    act('POST', '/api/dm/strokes', {
      mapId: map.id, kind, tool: 'line', points, width: Math.max(2, widthM * map.scale),
    });
    setPoly([]);
  }

  // Enter finishes the path, Escape cancels it, Backspace drops the last corner
  // — but never while typing in a field.
  useEffect(() => {
    if (tool !== 'poly') return undefined;
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); commitPoly(); }
      else if (e.key === 'Escape') setPoly([]);
      else if (e.key === 'Backspace') { e.preventDefault(); setPoly((p) => p.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  async function onStroke(stroke) {
    if (tool === 'erase') {
      await act('POST', `/api/dm/maps/${map.id}/erase`, { points: stroke.points, radius: stroke.width / 2 });
      return;
    }
    await act('POST', '/api/dm/strokes', { mapId: map.id, ...stroke });
  }

  async function onCanvasClick(x, y) {
    if (!map) return;
    if (tool === 'poly') {
      // click near the first corner to close & finish; otherwise add a corner
      if (poly.length >= 2 && Math.hypot(x - poly[0][0], y - poly[0][1]) < map.scale * 0.6) {
        commitPoly(poly, true);
      } else {
        setPoly((p) => [...p, [x, y]]);
      }
      return;
    }
    if (tool === 'ruler') {
      if (!ruler) { setRuler({ x, y }); return; }
      const dist = Math.hypot(x - ruler.x, y - ruler.y);
      setRuler(null);
      const meters = Number(window.prompt(
        `That line is ${Math.round(dist)} px long.\nHow many METERS is it in the world?`, '5'));
      if (meters > 0) act('PATCH', `/api/dm/maps/${map.id}`, { scale: dist / meters });
      return;
    }
    if (tool === 'chest') return act('POST', '/api/dm/chests', { mapId: map.id, x, y });
    if (tool === 'shop' && placeShopId) {
      return act('PATCH', `/api/dm/shops/${placeShopId}`, { map_id: map.id, x, y });
    }
    if (tool === 'npc' && placeNpcId) {
      return act('PATCH', `/api/dm/npcs/${placeNpcId}`, { map_id: map.id, x, y });
    }
    if (tool === 'door') {
      if (!doorForm.target) { setDoorPickerOpen(true); return; }
      await act('POST', '/api/dm/connections', {
        mapId: map.id, x, y,
        targetMapId: Number(doorForm.targetMapId),
        targetX: doorForm.target.x, targetY: doorForm.target.y,
        label: doorForm.label, reverse: doorForm.reverse,
      });
      setDoorForm({ ...doorForm, target: null });
      return;
    }
    if (tool === 'remove') {
      const near = (o) => o.x != null && Math.hypot(o.x - x, o.y - y) < map.scale * 1.4;
      const chest = detail.chests.find(near);
      if (chest) return act('DELETE', `/api/dm/chests/${chest.id}`);
      const conn = detail.connections.find(near);
      if (conn) return act('DELETE', `/api/dm/connections/${conn.id}`);
      const shop = detail.shops.find(near);
      if (shop) return act('PATCH', `/api/dm/shops/${shop.id}`, { map_id: null, x: null, y: null });
      const npc = detail.npcs.find(near);
      if (npc) return act('PATCH', `/api/dm/npcs/${npc.id}`, { map_id: null, x: null, y: null });
      // strokes: click close to the painted line
      const hit = strokes.find((s) => strokeSegments(s).some(([a, b]) =>
        pointSegDist({ x, y }, a, b) < s.width / 2 + map.scale * 0.4));
      if (hit) return act('DELETE', `/api/dm/strokes/${hit.id}`);
    }
  }

  const objects = map ? [
    ...detail.chests.map((c) => ({ objKey: `chest${c.id}`, kind: 'chest', x: c.x, y: c.y, icon: c.icon, opened: c.state === 'opened' })),
    ...detail.shops.map((s) => ({ objKey: `shop${s.id}`, kind: 'shop', x: s.x, y: s.y, icon: s.icon, label: s.name })),
    ...detail.npcs.map((n) => ({ objKey: `npc${n.id}`, kind: 'npc', x: n.x, y: n.y, icon: n.token, label: n.name, scale: n.token_scale })),
    ...detail.connections.map((c) => ({
      objKey: `conn${c.id}`, kind: 'connection', x: c.x, y: c.y,
      label: `${c.label || 'to'} (${global.maps.find((m) => m.id === c.target_map_id)?.name || '?'})`,
    })),
  ] : [];

  const lastStroke = strokes[strokes.length - 1];
  const lastCliff = [...strokes].reverse().find((s) => s.kind === 'cliff');
  const mapTracks = global.tracks.filter((t) => t.map_id === viewMapId);

  return (
    <div className="livemap">
      <div className="map-pane">
        <MapCanvas
          map={map}
          strokes={strokes}
          objects={objects}
          paint={paint}
          guide={tool === 'poly' && map ? { kind, points: poly, close: polyClose } : null}
          onStroke={onStroke}
          onCanvasClick={onCanvasClick}
        />
        <MapChecklist maps={global.maps} onJump={setViewMapId} />
        {tool === 'ruler' && (
          <div className="placing-hint">
            {ruler ? 'Now click the END of your reference line.' : 'Click the START of a line whose real length you know (a door, a cart…).'}
          </div>
        )}
        {tool === 'poly' && (
          <div className="placing-hint">
            Click each corner. {poly.length > 0
              ? `${poly.length} placed — Enter/“Finish” to save, click the first dot to close, Backspace undo, Esc cancel.`
              : 'It does not need to close.'}
          </div>
        )}
        {tool === 'door' && (
          <div className="placing-hint">
            {doorForm.target
              ? 'Destination set — now click where the door sits on THIS map.'
              : 'Pick the destination first (click the map to open the picker).'}
            <button className="ghost small" onClick={() => setDoorPickerOpen(true)}>Pick destination…</button>
          </div>
        )}
      </div>

      <aside className="side-panel">
        <section>
          <h3>Map</h3>
          <select value={viewMapId ?? ''} onChange={(e) => setViewMapId(Number(e.target.value))}>
            {global.maps.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.is_template ? ' (template)' : ''}</option>
            ))}
          </select>
          <div className="row">
            <input placeholder="New map name" value={newMap.name}
              onChange={(e) => setNewMap({ name: e.target.value })} />
            <button onClick={async () => {
              if (!newMap.name.trim()) return;
              const res = await act('POST', '/api/dm/maps', { name: newMap.name.trim() });
              if (res) { setNewMap({ name: '' }); setViewMapId(res.id); }
            }}>Create</button>
          </div>
          {map && (
            <>
              <label className="field">
                <span>Background image (blank = wooden table; SVGs stay sharp as vectors)</span>
                <input type="file" accept="image/*" onChange={async (e) => {
                  const f = e.target.files[0];
                  if (!f) return;
                  const { path, w, h } = await uploadMapImage(f);
                  act('PATCH', `/api/dm/maps/${map.id}`, { image: path, image_w: w, image_h: h });
                }} />
              </label>
              <div className="field-grid">
                <NumField label="Scale (px/m)" value={Math.round(map.scale * 10) / 10} step={0.5}
                  onSave={(v) => act('PATCH', `/api/dm/maps/${map.id}`, { scale: v })} />
                <NumField label="Mobility ×" value={map.mobility} step={0.5}
                  onSave={(v) => act('PATCH', `/api/dm/maps/${map.id}`, { mobility: v })} />
                <NumField label="Visibility ×" value={map.visibility ?? 1} step={0.1}
                  onSave={(v) => act('PATCH', `/api/dm/maps/${map.id}`, { visibility: Math.max(0.05, v || 1) })} />
                <NumField label="Token size ×" value={map.token_scale} step={0.1}
                  onSave={(v) => act('PATCH', `/api/dm/maps/${map.id}`, { token_scale: Math.max(0.2, v || 1) })} />
                <NumField label="Icon size ×" value={map.icon_scale} step={0.1}
                  onSave={(v) => act('PATCH', `/api/dm/maps/${map.id}`, { icon_scale: Math.max(0.2, v || 1) })} />
              </div>
              <p className="muted small">Visibility = light level (×1 daylight, lower = darker). Also on the Live tab. Icon size is relative to a token (×1 = same size as a token).</p>
              <label className="row small">
                <input type="checkbox" checked={!!map.is_template}
                  onChange={(e) => act('PATCH', `/api/dm/maps/${map.id}`, { is_template: e.target.checked ? 1 : 0 })} />
                Template (library map, hidden from play)
              </label>
              <label className="row small">
                <input type="checkbox" checked={!!map.is_world}
                  onChange={(e) => act('PATCH', `/api/dm/maps/${map.id}`, { is_world: e.target.checked ? 1 : 0 })} />
                Kingdom map (shows where everyone is; uncovers permanently)
              </label>
              <label className="row small">
                <input type="checkbox" checked={!!map.is_dungeon}
                  onChange={(e) => act('PATCH', `/api/dm/maps/${map.id}`, { is_dungeon: e.target.checked ? 1 : 0 })} />
                Dungeon (the TV frames only the explored part — it grows as they go)
              </label>
              {!map.is_world && (
                <div className="row">
                  <span className="muted small">
                    World location: {map.world_x != null ? `${Math.round(map.world_x)}, ${Math.round(map.world_y)}` : 'not set'}
                  </span>
                  <button className="mini" disabled={!global.maps.some((m) => m.is_world)}
                    onClick={() => setWorldPickerOpen(true)}>Set on kingdom map…</button>
                  {map.world_x != null && (
                    <button className="mini" onClick={() => act('PATCH', `/api/dm/maps/${map.id}`, { world_x: null, world_y: null })}>Clear</button>
                  )}
                </div>
              )}
              <div className="row">
                <button onClick={async () => {
                  const name = window.prompt('Name for the copy?', `${map.name} (copy)`);
                  if (!name) return;
                  const res = await act('POST', `/api/dm/maps/${map.id}/duplicate`, { name });
                  if (res) setViewMapId(res.id);
                }}>Duplicate map</button>
                <button onClick={async () => {
                  const res = await act('POST', `/api/dm/maps/${map.id}/duplicate`,
                    { name: `${map.name} (template)`, asTemplate: true });
                  if (res) alert('Saved to the template library.');
                }}>Save as template</button>
              </div>
              <label className="field"><span>Default music (starts when shown on TV)</span>
                <select value={map.default_track_id ?? ''} onChange={(e) =>
                  act('PATCH', `/api/dm/maps/${map.id}`, { default_track_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— none —</option>
                  {mapTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>

              <h4>Weather looks</h4>
              <p className="muted small">
                This map's <strong>normal</strong> look is its background above. Give it an alternate
                image for any weather; the whole campaign switches weather together (Live tab), and a
                map with no variant for the current weather just shows its normal look.
              </p>
              {WEATHERS.filter((w) => w !== 'normal').map((w) => {
                const v = (global.mapVariants || []).find((x) => x.map_id === map.id && x.name === w);
                return (
                  <div className="row" key={w}>
                    <span style={{ width: 56, textTransform: 'capitalize' }}>{w}</span>
                    <span className="muted small">{v ? `set · vis ×${v.visibility}` : 'normal (no variant)'}</span>
                    <span className="spacer" />
                    <label className="buttonish mini" style={{ cursor: 'pointer' }}>
                      {v ? 'Replace' : 'Set image'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                        const f = e.target.files[0];
                        if (!f) return;
                        const { path } = await uploadMapImage(f);
                        act('POST', `/api/dm/maps/${map.id}/variants`, { name: w, image: path, visibility: map.visibility });
                      }} />
                    </label>
                    {v && <button className="mini danger" onClick={() => act('DELETE', `/api/dm/map-variants/${v.id}`)}>del</button>}
                  </div>
                );
              })}
              <button className="danger" onClick={() => {
                if (confirm(`Delete map "${map.name}" and everything on it?`)) {
                  act('DELETE', `/api/dm/maps/${map.id}`);
                  setViewMapId(global.maps.find((m) => m.id !== map.id)?.id ?? null);
                }
              }}>Delete map</button>
            </>
          )}
        </section>

        {map && (
          <>
            <section>
              <h3>Tool</h3>
              <div className="chips">
                {[['pan', 'Move/zoom'], ['brush', 'Brush'], ['line', 'Line'], ['poly', 'Path'],
                  ['rect', 'Rectangle'], ['erase', 'Rubber'], ['ruler', 'Ruler'], ['door', 'Door'],
                  ['chest', 'Chest'], ['shop', 'Shop'], ['npc', 'NPC'], ['remove', 'Remove']].map(([t, label]) => (
                  <button key={t} className={`chip ${tool === t ? 'active' : ''}`}
                    onClick={() => { setTool(t); setRuler(null); }}>
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {tool === 'erase' && (
              <section>
                <h3>Rubber</h3>
                <label className="field">
                  <span>Rubber size: {widthM} m</span>
                  <input type="range" min="0.2" max="4" step="0.1" value={widthM}
                    onChange={(e) => setWidthM(Number(e.target.value))} />
                </label>
                <p className="muted small">Rub over a painted stroke to erase just that part.</p>
              </section>
            )}

            {tool === 'poly' && (
              <section>
                <h3>Path</h3>
                <div className="brush-list">
                  {KINDS.map(([k, label]) => (
                    <label key={k} className="row small">
                      <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span>Width: {widthM} m</span>
                  <input type="range" min="0.2" max="4" step="0.1" value={widthM}
                    onChange={(e) => setWidthM(Number(e.target.value))} />
                </label>
                <label className="row small">
                  <input type="checkbox" checked={polyClose} onChange={(e) => setPolyClose(e.target.checked)} />
                  Close the shape (join the last corner back to the first)
                </label>
                <div className="row">
                  <button disabled={poly.length < 2} onClick={() => commitPoly()}>Finish ({poly.length})</button>
                  <button className="mini" disabled={!poly.length} onClick={() => setPoly((p) => p.slice(0, -1))}>Undo corner</button>
                  <button className="mini danger" disabled={!poly.length} onClick={() => setPoly([])}>Cancel</button>
                </div>
                <p className="muted small">Click corners. Enter saves · first dot closes · Backspace undo · Esc cancels.</p>
              </section>
            )}

            {paint && tool !== 'erase' && (
              <section>
                <h3>Paint</h3>
                <div className="brush-list">
                  {KINDS.map(([k, label]) => (
                    <label key={k} className="row small">
                      <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span>Width: {widthM} m</span>
                  <input type="range" min="0.2" max="4" step="0.1" value={widthM}
                    onChange={(e) => setWidthM(Number(e.target.value))} />
                </label>
                <div className="row">
                  {lastStroke && (
                    <button className="mini" onClick={() => act('DELETE', `/api/dm/strokes/${lastStroke.id}`)}>
                      Undo last
                    </button>
                  )}
                  {lastCliff && (
                    <button className="mini" onClick={() =>
                      act('PATCH', `/api/dm/strokes/${lastCliff.id}`, { flipped: lastCliff.flipped ? 0 : 1 })}>
                      Flip last cliff
                    </button>
                  )}
                  {strokes.length > 0 && (
                    <button className="mini danger" onClick={() => {
                      if (confirm('Erase ALL painted strokes on this map?')) {
                        act('DELETE', `/api/dm/maps/${map.id}/strokes`);
                      }
                    }}>Clear all</button>
                  )}
                </div>
                <p className="muted small">Drag to paint. Cliff arrows = the one allowed crossing direction (flip if wrong).</p>
              </section>
            )}

            {tool === 'door' && (
              <section>
                <h3>Door</h3>
                <label className="field"><span>Label</span>
                  <input value={doorForm.label} onChange={(e) => setDoorForm({ ...doorForm, label: e.target.value })} />
                </label>
                <label className="row small">
                  <input type="checkbox" checked={doorForm.reverse}
                    onChange={(e) => setDoorForm({ ...doorForm, reverse: e.target.checked })} />
                  Also create the way back
                </label>
                {doorForm.target && (
                  <p className="muted small">
                    Destination: {global.maps.find((m) => m.id === Number(doorForm.targetMapId))?.name}
                    {' '}({Math.round(doorForm.target.x)}, {Math.round(doorForm.target.y)})
                  </p>
                )}
                <button onClick={() => setDoorPickerOpen(true)}>Pick destination on its map…</button>
              </section>
            )}

            {tool === 'shop' && (
              <section>
                <h3>Place shop</h3>
                <select value={placeShopId} onChange={(e) => setPlaceShopId(e.target.value)}>
                  <option value="">— pick a shop —</option>
                  {global.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </section>
            )}
            {tool === 'npc' && (
              <section>
                <h3>Place NPC</h3>
                <select value={placeNpcId} onChange={(e) => setPlaceNpcId(e.target.value)}>
                  <option value="">— pick an NPC —</option>
                  {global.npcs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </section>
            )}
            {tool === 'chest' && <p className="muted small pad">Click the map to drop a chest.</p>}
            {tool === 'remove' && <p className="muted small pad">Click an object or a painted stroke to remove it (shops/NPCs are unplaced, not deleted).</p>}
          </>
        )}
      </aside>

      {worldPickerOpen && (
        <DoorDestinationPicker
          global={{ maps: global.maps.filter((m) => m.is_world) }}
          initialMapId={global.maps.find((m) => m.is_world)?.id}
          onPick={(mapId, x, y) => {
            act('PATCH', `/api/dm/maps/${map.id}`, { world_x: x, world_y: y });
            setWorldPickerOpen(false);
          }}
          onClose={() => setWorldPickerOpen(false)}
        />
      )}

      {doorPickerOpen && (
        <DoorDestinationPicker
          global={global}
          initialMapId={doorForm.targetMapId || global.maps.find((m) => m.id !== viewMapId)?.id || viewMapId}
          onPick={(mapId, x, y) => {
            setDoorForm({ ...doorForm, targetMapId: mapId, target: { x, y } });
            setDoorPickerOpen(false);
            setTool('door');
          }}
          onClose={() => setDoorPickerOpen(false)}
        />
      )}
    </div>
  );
}

// Dialog showing the destination map — click exactly where travellers arrive.
function DoorDestinationPicker({ global, initialMapId, onPick, onClose }) {
  const [mapId, setMapId] = useState(initialMapId);
  const full = global.maps.find((m) => m.id === Number(mapId)) || null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide door-picker" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>Where does this door lead?</h3>
          <select value={mapId} onChange={(e) => setMapId(Number(e.target.value))}>
            {global.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <p className="muted small">Click the exact arrival point on the destination map.</p>
        <div className="door-picker-map">
          {full && (
            <MapCanvas
              map={full}
              onCanvasClick={(x, y) => onPick(Number(mapId), x, y)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
