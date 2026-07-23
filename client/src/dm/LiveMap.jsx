import React, { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from '../MapCanvas.jsx';
import ChestDialog from './ChestDialog.jsx';
import TradeDialog from './TradeDialog.jsx';
import MapGraph from './MapGraph.jsx';
import JourneyPlanner from './JourneyPlanner.jsx';
import PaintBar from './PaintBar.jsx';
import { upload } from '../api.js';
import { NumField } from '../fields.jsx';
import { CropInput } from '../ImageCropper.jsx';
import {
  WEATHERS, INK_DEFAULT_COLOR, INK_DEFAULT_WIDTH_M, INK_ERASER_M,
} from '../../../shared/gameRules.js';
import { journeyIsLive } from '../journey.js';
import { polylineLength } from '../../../shared/geometry.js';

// The DM's table: drag tokens (shift-click selects several and they move
// together), walls/cliffs enforce themselves, doors teleport, weapon ranges
// draw as rings, private notes pin to the map, and music/sfx are a click away.
export default function LiveMap({ global, detail, viewMapId, setViewMapId, act }) {
  const [selected, setSelected] = useState(new Set()); // tokenKeys
  const [rangeItem, setRangeItem] = useState('');
  const [placing, setPlacing] = useState(null);
  const [chestOpen, setChestOpen] = useState(null);
  const [monsterForm, setMonsterForm] = useState({ name: '', hp: 10 });
  const [templateId, setTemplateId] = useState('');
  const [graphOpen, setGraphOpen] = useState(false);
  const [travelPath, setTravelPath] = useState(null); // kingdom "simulate travel" drawing
  const [journeyPlan, setJourneyPlan] = useState(null); // flagged door: draw the road first
  const [paint, setPaint] = useState(null); // drawing over the map: null = off
  const [rulerPath, setRulerPath] = useState(null); // measuring: null = off, [] = on

  const worldMapObj = global.maps.find((m) => m.is_world);

  useEffect(() => { setTravelPath(null); setRulerPath(null); }, [viewMapId]); // don't carry a half-drawn route/measure between maps

  // When a kingdom JOURNEY (flagged door) finishes, follow the party to the
  // destination city here in Live too — the TV already switched.
  const arriveRef = useRef(null);
  useEffect(() => {
    const wt = global.worldTravel;
    if (wt) { arriveRef.current = wt.arriveMapId ?? arriveRef.current; }
    else if (arriveRef.current != null) {
      const dest = arriveRef.current;
      arriveRef.current = null;
      setSelected(new Set());
      setViewMapId(dest);
    }
  }, [global.worldTravel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Maps reachable from the current one through a door (either direction), plus
  // the one you're viewing and whatever is on the TV — so you can always get back.
  const connectedIds = useMemo(() => {
    const s = new Set([viewMapId, global.activeMapId]);
    for (const l of global.mapLinks || []) {
      if (l.map_id === viewMapId) s.add(l.target_map_id);
      if (l.target_map_id === viewMapId) s.add(l.map_id);
    }
    return s;
  }, [global.mapLinks, viewMapId, global.activeMapId]);

  const map = detail?.map;
  const chars = detail?.characters || [];
  const monsters = detail?.monsters || [];

  const selectedList = [...selected];
  const singleChar = selectedList.length === 1 && selectedList[0].startsWith('c')
    ? global.characters.find((c) => `c${c.id}` === selectedList[0]) : null;
  const singleCharPos = singleChar ? chars.find((c) => c.id === singleChar.id) : null;
  const singleMonster = selectedList.length === 1 && selectedList[0].startsWith('m')
    ? monsters.find((m) => `m${m.id}` === selectedList[0]) : null;
  const npcs = detail?.npcs || [];
  const singleNpc = selectedList.length === 1 && selectedList[0].startsWith('n')
    ? npcs.find((n) => `n${n.id}` === selectedList[0]) : null;

  // The weapon-range ring defaults to the selected character's longest-range
  // weapon.
  useEffect(() => {
    if (!singleChar) { setRangeItem(''); return; }
    const best = (singleChar.inventory || [])
      .filter((e) => e.category === 'weapon' && e.range > 0)
      .sort((a, b) => b.range - a.range)[0];
    setRangeItem(best ? String(best.entry_id) : '');
  }, [singleChar?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onTokensMove(moves) {
    if (moves.length === 1) {
      const { token, x, y } = moves[0];
      const res = await act('POST', '/api/dm/move-token', {
        kind: token.kind, id: token.id, mapId: viewMapId, x, y,
      });
      if (!res) return;
      if (res.result === 'chest') setChestOpen({ chestId: res.chestId, characterId: token.id });
      // a flagged door asks the DM to draw the road before anyone travels
      if (res.result === 'world-journey-plan') setJourneyPlan(res);
      else if (res.result === 'travelled') setViewMapId(res.mapId);
      return;
    }
    // moves[0] is the DRAGGED token (MapCanvas puts it first): its drop point
    // is the anchor — a door there carries the whole selection across together
    const dragged = moves[0];
    const res = await act('POST', '/api/dm/move-tokens', {
      anchor: { mapId: viewMapId, x: dragged.x, y: dragged.y },
      moves: moves.map(({ token, x, y }) => ({ kind: token.kind, id: token.id, mapId: viewMapId, x, y })),
    });
    if (res?.journeyPlan) setJourneyPlan(res.journeyPlan);
    else if (res?.travelled) setViewMapId(res.mapId);
    if (res?.blocked?.length) {
      alert(res.blocked.map((b) => `${b.kind} #${b.id}: ${b.error}`).join('\n'));
    }
  }

  function onTokenClick(token, shiftKey) {
    setSelected((prev) => {
      const next = new Set(shiftKey ? prev : []);
      if (prev.has(token.tokenKey) && (shiftKey || prev.size === 1)) next.delete(token.tokenKey);
      else next.add(token.tokenKey);
      return next;
    });
  }

  async function onCanvasClick(x, y) {
    if (rulerPath) { setRulerPath((p) => [...p, [x, y]]); return; } // measuring a distance
    if (travelPath) { setTravelPath((p) => [...p, [x, y]]); return; } // drawing a kingdom journey
    if (!placing) { setSelected(new Set()); return; }
    if (placing.kind === 'note') {
      const text = window.prompt('Note to self (players never see it):', '');
      if (text?.trim()) {
        await act('POST', '/api/dm/annotations', { mapId: viewMapId, x, y, text: text.trim() });
      }
      setPlacing(null);
      return;
    }
    if (placing.kind === 'character' || placing.kind === 'monster-move') {
      await act('POST', '/api/dm/move-token', {
        kind: placing.kind === 'character' ? 'character' : 'monster',
        id: placing.id, mapId: viewMapId, x, y,
      });
    } else if (placing.kind === 'monster') {
      await act('POST', '/api/dm/monsters', placing.templateId
        ? { templateId: placing.templateId, map_id: viewMapId, x, y }
        : { name: placing.name || 'Monster', hp: placing.hp, max_hp: placing.hp, map_id: viewMapId, x, y });
    }
    setPlacing(null);
  }

  const isWorld = !!map?.is_world;
  // While a kingdom journey plays, the DM (like the TV) sees just the walking
  // party marker on the world map.
  const journey = global.worldTravel;
  const journeying = isWorld && journeyIsLive(journey); // never replay a finished trip
  const tokens = journeying ? [{
    tokenKey: `travel-${journey.nonce}`, kind: 'travel',
    x: journey.path[journey.path.length - 1][0], y: journey.path[journey.path.length - 1][1],
    color: '#e4b343', label: 'Party', shape: 'circle',
    animate: true, path: journey.path, walkMs: journey.durationMs, draggable: false,
  }] : chars.map((c) => ({
    tokenKey: `c${c.id}`, kind: 'character', id: c.id, x: c.x, y: c.y,
    color: c.token_color, label: c.name, icon: c.token, scale: c.token_scale,
    shape: c.token_shape, draggable: !isWorld, sub: isWorld ? null : `${c.hp}/${c.max_hp}`,
  })).concat(monsters.map((m) => ({
    tokenKey: `m${m.id}`, kind: 'monster', id: m.id, x: m.x, y: m.y,
    color: '#7a2f2f', label: m.name, icon: m.icon, scale: m.token_scale,
    shape: m.token_shape, draggable: true, sub: `${m.hp}/${m.max_hp}`,
  }))).concat(npcs.map((n) => ({
    tokenKey: `n${n.id}`, kind: 'npc', id: n.id, x: n.x, y: n.y,
    color: '#8a7452', label: n.show_name ? n.name : null, icon: n.token, scale: n.token_scale,
    shape: n.token_shape, draggable: true,
  })));

  const objects = (detail?.chests || []).map((c) => ({
    objKey: `chest${c.id}`, kind: 'chest', id: c.id, x: c.x, y: c.y, icon: c.icon,
    opened: c.state === 'opened', hidden: c.hidden, clickable: true, // click to edit loot
  })).concat((detail?.shops || []).map((s) => ({
    objKey: `shop${s.id}`, kind: 'shop', x: s.x, y: s.y, icon: s.icon, label: s.name,
  }))).concat((detail?.connections || []).map((c) => ({
    objKey: `conn${c.id}`, kind: 'connection', x: c.x, y: c.y, label: c.label,
  })));

  // The only overlay ring is the selected weapon's reach.
  const rings = [];
  const weapons = (singleChar?.inventory || []).filter((e) => e.category === 'weapon' && e.range > 0);
  if (singleCharPos && map && rangeItem) {
    const w = weapons.find((e) => String(e.entry_id) === String(rangeItem));
    if (w) {
      rings.push({
        x: singleCharPos.x, y: singleCharPos.y, radiusPx: w.range * map.scale,
        color: '#7fb3ff', label: `${w.name} — ${w.range} m`,
      });
    }
  }

  // Ink thickness is chosen in METRES and converted with this map's ruler, so
  // the same brush reads the same on a cellar and on the kingdom. The rubber is
  // deliberately fatter than the pen — you rub things out with a broad sweep.
  const inkPxPerM = map?.scale || 20;
  const inkWidthM = paint?.widthM ?? INK_DEFAULT_WIDTH_M;
  const paintProps = paint && {
    kind: 'ink',
    tool: paint.tool || 'brush',
    color: paint.color || INK_DEFAULT_COLOR,
    width: inkPxPerM * (paint.tool === 'eraser'
      ? Math.max(inkWidthM * 2, INK_ERASER_M) : inkWidthM),
  };

  // The ruler: distance of the committed path (the on-map readout also adds the
  // live segment out to the cursor). Turning it on parks the other map tools.
  const rulerMeters = rulerPath && map ? polylineLength(rulerPath) / (map.scale || 1) : 0;
  const toggleRuler = () => {
    if (rulerPath) { setRulerPath(null); return; }
    setRulerPath([]); setPaint(null); setPlacing(null); setTravelPath(null);
  };

  const offMapChars = global.characters.filter((c) => c.map_id !== viewMapId);
  const mapTracks = global.tracks.filter((t) => t.map_id === viewMapId);
  const music = global.music;

  return (
    <div className="livemap">
      <div className={`map-pane ${placing ? 'placing' : ''} ${paint ? 'painting' : ''} ${rulerPath ? 'measuring' : ''}`}>
        <MapCanvas
          map={map}
          strokes={detail?.strokes || []}
          ink={detail?.ink || []}
          tokens={tokens}
          objects={objects}
          rings={rings}
          notes={detail?.annotations || []}
          guide={travelPath ? { kind: 'sight', points: travelPath, close: false } : null}
          ruler={rulerPath}
          selectedKeys={selected}
          paint={paintProps}
          onStroke={(s) => act('POST', '/api/dm/ink', {
            mapId: viewMapId, tool: s.tool, points: s.points, color: s.color, width: s.width,
          })}
          onErase={(points, radius) =>
            act('POST', `/api/dm/maps/${viewMapId}/ink-erase`, { points, radius })}
          onTokenClick={onTokenClick}
          onTokensMove={isWorld ? null : onTokensMove}
          onNoteToggle={(n) => act('PATCH', `/api/dm/annotations/${n.id}`, { open: n.open ? 0 : 1 })}
          onNoteMove={(n, off) => act('PATCH', `/api/dm/annotations/${n.id}`, off)}
          onObjectClick={(o) => { if (o.kind === 'chest') setChestOpen({ chestId: o.id }); }}
          onCanvasClick={onCanvasClick}
        />
        {map && (
          <PaintBar
            paint={paint}
            setPaint={(v) => { setRulerPath(null); setPaint(v); }}
            hasInk={(detail?.ink || []).length > 0}
            onUndo={() => act('POST', `/api/dm/maps/${viewMapId}/ink-undo`)}
            onClear={() => act('DELETE', `/api/dm/maps/${viewMapId}/ink`)}
          />
        )}
        {map && (
          <button className={`ruler-toggle ${rulerPath ? 'on' : ''}`} onClick={toggleRuler}
            title="Measure distance along a path you click out on the map">
            {rulerPath ? 'Stop measuring' : 'Measure'}
          </button>
        )}
        {placing && (
          <div className="placing-hint">
            Click the map to place {placing.name || 'token'}
            <button className="ghost small" onClick={() => setPlacing(null)}>Cancel</button>
          </div>
        )}
        {travelPath && (
          <div className="placing-hint">
            Click the route across the kingdom, then “Start the journey”.
            <button className="ghost small" onClick={() => setTravelPath(null)}>Cancel</button>
          </div>
        )}
        {rulerPath && (
          <div className="placing-hint">
            <span className="ruler-total">{rulerMeters.toFixed(rulerMeters < 100 ? 1 : 0)} m</span>
            <span className="muted small">Click points along the path to measure it.</span>
            <span className="spacer" />
            <button className="ghost small" disabled={!rulerPath.length}
              onClick={() => setRulerPath((p) => p.slice(0, -1))}>Undo point</button>
            <button className="ghost small" disabled={!rulerPath.length}
              onClick={() => setRulerPath([])}>Clear</button>
            <button className="ghost small" onClick={() => setRulerPath(null)}>Done</button>
          </div>
        )}
      </div>

      <aside className="side-panel">
        <section>
          <h3>Map</h3>
          <div className="row">
            <select value={viewMapId ?? ''} onChange={(e) => { setSelected(new Set()); setViewMapId(Number(e.target.value)); }}>
              {global.maps
                .filter((m) => !m.is_world && connectedIds.has(m.id) && (!m.is_template || m.id === viewMapId))
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.is_template ? ' (template)' : ''}</option>
                ))}
            </select>
            <button className="mini" title="Every map, as a graph" onClick={() => setGraphOpen(true)}>All maps…</button>
          </div>
          <div className="row">
            <p className="muted small" style={{ flex: 1 }}>The list shows maps this one has doors to. “All maps” opens the whole graph.</p>
            {worldMapObj && !isWorld && (
              <button className="mini" title="The kingdom overview" onClick={() => { setSelected(new Set()); setViewMapId(worldMapObj.id); }}>
                Kingdom map
              </button>
            )}
          </div>
          {map && !isWorld && <p className="muted small">Mobility ×{map.mobility} · scale {Math.round(map.scale)} px/m</p>}
          {isWorld && <p className="muted small">Kingdom map: shows where the party is and the routes they've travelled.</p>}
          {map && <VisibilitySlider map={map} act={act} kingdom={isWorld} />}
          {isWorld && (
            <div className="travel-box">
              {!travelPath ? (
                <button onClick={() => { setTravelPath([]); setRulerPath(null); }}>Simulate travel…</button>
              ) : (
                <>
                  <p className="muted small">Click the route across the kingdom — from where they are to where they're going ({travelPath.length} points).</p>
                  <div className="row">
                    <button disabled={travelPath.length < 2} onClick={async () => {
                      if (await act('POST', '/api/dm/world-travel', { path: travelPath })) setTravelPath(null);
                    }}>Start the journey</button>
                    <button className="mini" disabled={!travelPath.length} onClick={() => setTravelPath((p) => p.slice(0, -1))}>Undo</button>
                    <button className="mini danger" onClick={() => setTravelPath(null)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}
          {map && (
            <div className="chips" title="Campaign-wide weather — every map uses its matching look, or its normal one">
              {WEATHERS.map((w) => (
                <button key={w}
                  className={`chip ${(global.weather || 'normal') === w ? 'active' : ''}`}
                  onClick={() => act('POST', '/api/dm/weather', { weather: w })}>
                  {w}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <button
              disabled={viewMapId === global.activeMapId}
              onClick={() => act('POST', `/api/dm/maps/${viewMapId}/set-active`)}>
              {viewMapId === global.activeMapId ? 'On TV now' : 'Show on TV'}
            </button>
            {global.tvOverlay && (
              <button onClick={() => act('DELETE', '/api/dm/tv-overlay')}>Hide TV image</button>
            )}
          </div>
          {map && (
            <div className="reveal-row">
              <label className="row small">
                <input type="checkbox" checked={!!map.reveal_map}
                  onChange={(e) => act('POST', `/api/dm/maps/${map.id}/reveal`, { map: e.target.checked })} />
                Give map (remember layout)
              </label>
              <label className="row small">
                <input type="checkbox" checked={!!map.reveal_vision}
                  onChange={(e) => act('POST', `/api/dm/maps/${map.id}/reveal`, { vision: e.target.checked })} />
                Give vision (see all, live)
              </label>
              <button className="mini danger" onClick={() => {
                if (confirm('Forget everything the party has seen on this map?')) {
                  act('POST', `/api/dm/maps/${map.id}/reset-fog`);
                }
              }}>Reset explored fog</button>
            </div>
          )}
        </section>

        <section>
          <h3>Music & sounds</h3>
          <div className="row">
            <select value={music.track?.id ?? ''} onChange={(e) => {
              const id = Number(e.target.value);
              if (id) act('POST', '/api/dm/music', { trackId: id, playing: true });
            }}>
              <option value="">— pick a track —</option>
              {mapTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {music.track && (
              <>
                <button className="mini" onClick={() => act('POST', '/api/dm/music', { trackId: music.track.id, playing: !music.playing })}>
                  {music.playing ? 'Pause' : 'Play'}
                </button>
                <button className="mini" onClick={() => act('POST', '/api/dm/music', { trackId: null, playing: false })}>Stop</button>
              </>
            )}
          </div>
          {global.sounds.length > 0 && (
            <div className="chips">
              {global.sounds.map((snd) => (
                <button key={snd.id} className="chip" title="Play once on the TV"
                  onClick={() => act('POST', `/api/dm/sounds/${snd.id}/play`)}>
                  ♪ {snd.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3>Party</h3>
          <ul className="party-list">
            {global.characters.map((c) => {
              const mapName = global.maps.find((m) => m.id === c.map_id)?.name;
              return (
                <li key={c.id}>
                  <span className="token-dot" style={{ background: c.token_color }} />
                  <button className="linkish" title="Jump view to this character's map"
                    onClick={() => c.map_id && setViewMapId(c.map_id)}>
                    {c.name}
                  </button>
                  <span className="muted small">{mapName || 'off-map'}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Shift-click to select several.</p>
        </section>

        <section>
          <h3>My notes</h3>
          <p className="muted small">Private pins only you see.</p>
          <button onClick={() => setPlacing({ kind: 'note', name: 'a note' })}>Pin a note…</button>
          {(detail?.annotations || []).length > 0 && (
            <ul className="note-list">
              {(detail?.annotations || []).map((n) => (
                <li key={n.id}>
                  <button className="linkish" title={n.open ? 'Fold on the map' : 'Open on the map'}
                    onClick={() => act('PATCH', `/api/dm/annotations/${n.id}`, { open: n.open ? 0 : 1 })}>
                    {n.open ? '▾' : '▸'}
                  </button>
                  <span className="note-text">{n.text}</span>
                  <button className="mini" onClick={() => {
                    const text = window.prompt('Edit note:', n.text);
                    if (text != null && text.trim()) act('PATCH', `/api/dm/annotations/${n.id}`, { text: text.trim() });
                  }}>edit</button>
                  <button className="mini danger" onClick={() => act('DELETE', `/api/dm/annotations/${n.id}`)}>del</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!isWorld && offMapChars.length > 0 && (
          <section>
            <h3>Not on this map</h3>
            <div className="chips">
              {offMapChars.map((c) => (
                <button key={c.id} className="chip" onClick={() => setPlacing({ kind: 'character', id: c.id, name: c.name })}>
                  + {c.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {!isWorld && (
        <section>
          <h3>Spawn monster</h3>
          {global.monsterTemplates.length > 0 && (
            <div className="row">
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">— from bestiary —</option>
                {global.monsterTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} (HP {t.hp})</option>
                ))}
              </select>
              <button disabled={!templateId} onClick={() => {
                const t = global.monsterTemplates.find((x) => x.id === Number(templateId));
                setPlacing({ kind: 'monster', templateId: Number(templateId), name: t?.name });
              }}>Place</button>
            </div>
          )}
          <div className="row">
            <input placeholder="One-off: name" value={monsterForm.name}
              onChange={(e) => setMonsterForm({ ...monsterForm, name: e.target.value })} />
            <input type="number" className="num" title="HP" value={monsterForm.hp}
              onChange={(e) => setMonsterForm({ ...monsterForm, hp: Number(e.target.value) })} />
            <button onClick={() => setPlacing({ kind: 'monster', ...monsterForm })}>Place</button>
          </div>
          {global.monsters.filter((m) => !m.map_id).length > 0 && (
            <div className="chips">
              {global.monsters.filter((m) => !m.map_id).map((m) => (
                <button key={m.id} className="chip"
                  onClick={() => setPlacing({ kind: 'monster-move', id: m.id, name: m.name })}>
                  + {m.name}
                </button>
              ))}
            </div>
          )}
        </section>
        )}

        {selectedList.length > 1 && (
          <section className="sel-panel">
            <h3>{selectedList.length} tokens selected</h3>
            <p className="muted small">Drag any to move the group.</p>
          </section>
        )}

        {singleChar && (
          <section className="sel-panel">
            <h3>{singleChar.name}</h3>
            {weapons.length > 0 && (
              <label className="field"><span>Show weapon range</span>
                <select value={rangeItem} onChange={(e) => setRangeItem(e.target.value)}>
                  <option value="">— none —</option>
                  {weapons.map((w) => (
                    <option key={w.entry_id} value={w.entry_id}>{w.name} ({w.range} m)</option>
                  ))}
                </select>
              </label>
            )}
            <div className="row">
              <button onClick={() => act('POST', '/api/dm/unplace', { kind: 'character', id: singleChar.id })}>Remove from map</button>
            </div>
          </section>
        )}

        {singleNpc && (
          <section className="sel-panel">
            <h3>{singleNpc.name} <span className="muted small">(NPC)</span></h3>
            <div className="field-grid">
              <NumField label="Token size ×" value={singleNpc.token_scale} step={0.1}
                onSave={(v) => act('PATCH', `/api/dm/npcs/${singleNpc.id}`, { token_scale: Math.max(0.2, v || 1) })} />
            </div>
            <label className="row small">
              <input type="checkbox" checked={!!singleNpc.show_name}
                onChange={(e) => act('PATCH', `/api/dm/npcs/${singleNpc.id}`, { show_name: e.target.checked })} />
              Show name on the map (everyone) — hidden by default
            </label>
            <div className="row">
              <button onClick={() => act('POST', '/api/dm/unplace', { kind: 'npc', id: singleNpc.id })}>Remove from map</button>
            </div>
            {singleNpc.notes && <p className="muted small">{singleNpc.notes}</p>}
          </section>
        )}

        {singleMonster && (
          <section className="sel-panel">
            <h3>{singleMonster.name}</h3>
            {singleMonster.art && <img className="portrait" src={singleMonster.art} alt="" />}
            <div className="field-grid">
              <NumField label="HP" value={singleMonster.hp}
                onSave={(v) => act('PATCH', `/api/dm/monsters/${singleMonster.id}`, { hp: v })} />
              <NumField label="Token size ×" value={singleMonster.token_scale} step={0.1}
                onSave={(v) => act('PATCH', `/api/dm/monsters/${singleMonster.id}`, { token_scale: Math.max(0.2, v || 1) })} />
              <label className="field"><span>Token shape</span>
                <select value={singleMonster.token_shape || 'free'}
                  onChange={(e) => act('PATCH', `/api/dm/monsters/${singleMonster.id}`, { token_shape: e.target.value })}>
                  <option value="free">free (raw image)</option>
                  <option value="circle">circle</option>
                  <option value="square">square</option>
                </select>
              </label>
            </div>
            <div className="row">
              <CropInput label="Token image" round={singleMonster.token_shape === 'circle'}
                onFile={async (f) => act('PATCH', `/api/dm/monsters/${singleMonster.id}`, { icon: await upload('monster-token', f) })} />
              <CropInput label="Art"
                onFile={async (f) => act('PATCH', `/api/dm/monsters/${singleMonster.id}`, { art: await upload('monster-art', f) })} />
            </div>
            <div className="row">
              <button onClick={() => act('POST', '/api/dm/unplace', { kind: 'monster', id: singleMonster.id })}>Remove from map</button>
              <button className="danger" onClick={() => { act('DELETE', `/api/dm/monsters/${singleMonster.id}`); setSelected(new Set()); }}>Delete</button>
            </div>
            <p className="muted small">Stats: {JSON.stringify(singleMonster.stats)}</p>
            {singleMonster.notes && <p className="muted small">{singleMonster.notes}</p>}
          </section>
        )}
      </aside>

      {chestOpen && (
        <ChestDialog
          chestId={chestOpen.chestId}
          characterId={chestOpen.characterId}
          characters={global.characters}
          items={global.items}
          session={global.chestSession}
          act={act}
          onClose={() => setChestOpen(null)}
        />
      )}
      {global.shopSession && (
        <TradeDialog session={global.shopSession} global={global} act={act} />
      )}
      {journeyPlan && (
        <JourneyPlanner
          plan={journeyPlan}
          maps={global.maps}
          act={act}
          onStart={async (path) => {
            const res = await act('POST', '/api/dm/world-journey', { ...journeyPlan, path });
            setJourneyPlan(null);
            if (res) { setSelected(new Set()); setViewMapId(journeyPlan.worldId); } // watch them go
          }}
          onClose={() => setJourneyPlan(null)}
        />
      )}
      {graphOpen && (
        <MapGraph
          maps={global.maps.filter((m) => !m.is_template && !m.is_world)}
          links={global.mapLinks || []}
          currentId={viewMapId}
          activeId={global.activeMapId}
          onPick={(id) => { setSelected(new Set()); setViewMapId(id); }}
          onToggleLink={(a, b, on) => act('POST', '/api/dm/map-travel-link', { a, b, on })}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
  );
}

// Light level, adjusted live: drag, release, and everyone's sight follows.
// Commits on release so a sweep is one PATCH, not fifty. On the kingdom map the
// same value scales how much of the world each visited place uncovers.
function VisibilitySlider({ map, act, kingdom }) {
  const [v, setV] = useState(map.visibility ?? 1);
  const [prev, setPrev] = useState(map.visibility);
  if (map.visibility !== prev) { setPrev(map.visibility); setV(map.visibility ?? 1); }
  const commit = () => {
    if (Number(v) !== map.visibility) act('PATCH', `/api/dm/maps/${map.id}`, { visibility: Number(v) });
  };
  return (
    <label className="field">
      <span>{kingdom ? 'Reveal size' : 'Visibility (light)'} ×{Number(v).toFixed(2)}</span>
      <input type="range" min="0.1" max={kingdom ? 4 : 2} step="0.05" value={v}
        onChange={(e) => setV(e.target.value)}
        onPointerUp={commit}
        onKeyUp={(e) => e.key !== 'Tab' && commit()} />
    </label>
  );
}
