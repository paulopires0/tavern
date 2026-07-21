import React, { useEffect, useMemo, useRef, useState } from 'react';
import { connectSocket } from './socket.js';
import MapCanvas from './MapCanvas.jsx';
import YouTubePlayer from './YouTubePlayer.jsx';
import { journeyIsLive } from './journey.js';

// Kingdom & dungeon maps FRAME only what the party has revealed (fog cells that
// are seen/observed, plus the party's own tokens). Returned in image px, or
// null when nothing is revealed yet. Quantized so a single step doesn't nudge
// the frame; MapCanvas only ever grows the view to fit it.
function revealBox(md, extraPoints = []) {
  const cp = md.map?.cell_px;
  if (!cp) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const [k, st] of Object.entries(md.fogGrid || {})) {
    if (st < 1) continue;
    any = true;
    const i = k.indexOf(',');
    const cx = +k.slice(0, i), cy = +k.slice(i + 1);
    minX = Math.min(minX, cx * cp); minY = Math.min(minY, cy * cp);
    maxX = Math.max(maxX, (cx + 1) * cp); maxY = Math.max(maxY, (cy + 1) * cp);
  }
  for (const c of md.characters || []) {
    if (c.x == null) continue;
    any = true;
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y);
  }
  for (const [px, py] of extraPoints) {
    any = true;
    minX = Math.min(minX, px); minY = Math.min(minY, py);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
  }
  if (!any) return null;
  // A SQUARE slightly larger than what they've explored — so the party never
  // sees the map's true extent, only their growing window. Quantized so single
  // steps don't nudge it; MapCanvas clips the map to this box and only grows it.
  const q = cp * 3;
  const cx = Math.round((minX + maxX) / 2 / q) * q;
  const cy = Math.round((minY + maxY) / 2 / q) * q;
  let side = Math.max(maxX - minX, maxY - minY) * 1.12 + cp * 2;
  side = Math.ceil(side / q) * q;
  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
}

// The shared party screen: active map on the wooden table, fog union, tokens,
// drag-to-pan + wheel zoom, DM-pushed image overlays, and the (audio-only)
// music + soundboard speaker.
// Wheel to zoom into a shown letter/portrait, drag to pan, double-click resets.
function ZoomableImage({ src, alt }) {
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (ev) => {
      ev.preventDefault();
      setView((v) => {
        const s = Math.min(8, Math.max(1, v.s * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)));
        return s === 1 ? { s: 1, x: 0, y: 0 } : { ...v, s };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return (
    <div
      ref={hostRef}
      className="zoomable-img"
      onPointerDown={(ev) => {
        dragRef.current = { x0: ev.clientX, y0: ev.clientY, vx: view.x, vy: view.y };
        ev.currentTarget.setPointerCapture(ev.pointerId);
      }}
      onPointerMove={(ev) => {
        const d = dragRef.current;
        if (d) setView((v) => ({ ...v, x: d.vx + (ev.clientX - d.x0), y: d.vy + (ev.clientY - d.y0) }));
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onDoubleClick={() => setView({ s: 1, x: 0, y: 0 })}
    >
      <img src={src} alt={alt}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
    </div>
  );
}

export default function TVView({ tvKey }) {
  const [global, setGlobal] = useState(null);
  const [mapDetail, setMapDetail] = useState(null);
  const [denied, setDenied] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [travel, setTravel] = useState(null); // {path, nonce} being walked right now
  const sfxRef = useRef(null);
  const lastSfxNonce = useRef(0);
  const lastTravelNonce = useRef(0);

  useEffect(() => {
    const s = connectSocket({ tvKey });
    s.on('state', setGlobal);
    s.on('state:map', setMapDetail);
    s.on('connect_error', (e) => { if (e.message === 'unauthorized') setDenied(true); });
    return () => s.close();
  }, [tvKey]);

  // Fire soundboard sounds once per nonce.
  const sfx = global?.sfx;
  useEffect(() => {
    if (!audioReady || !sfx?.nonce || sfx.nonce === lastSfxNonce.current) return;
    lastSfxNonce.current = sfx.nonce;
    const el = sfxRef.current;
    if (el) {
      el.src = sfx.url;
      el.play().catch(() => {});
    }
  }, [sfx?.nonce, audioReady]);

  // A kingdom journey walks a marker along its road ONCE. Picking the cue up and
  // dropping it again are deliberately separate effects: the drop used to live
  // in this one, and its cleanup fired the moment the server cleared the cue —
  // cancelling the drop, so the marker stayed and re-walked on every later view.
  const worldTravel = global?.worldTravel;
  useEffect(() => {
    if (!worldTravel?.nonce || worldTravel.nonce === lastTravelNonce.current) return;
    lastTravelNonce.current = worldTravel.nonce; // consumed, whether or not we play it
    if (journeyIsLive(worldTravel)) setTravel(worldTravel); // ignore a stale cue
  }, [worldTravel?.nonce]);

  // …and the marker always goes away when its walk is over.
  useEffect(() => {
    if (!travel) return undefined;
    const left = (travel.durationMs || 2600) + 1500 - (Date.now() - travel.nonce);
    const t = setTimeout(() => setTravel(null), Math.max(0, left));
    return () => clearTimeout(t);
  }, [travel]);

  // The frame includes the travel path so it grows to the whole journey BEFORE
  // the marker starts walking.
  const frameBox = useMemo(() => {
    if (!mapDetail?.map || !(mapDetail.map.is_world || mapDetail.map.is_dungeon)) return null;
    const extra = (mapDetail.map.is_world && travel?.path) ? travel.path : [];
    return revealBox(mapDetail, extra);
  }, [mapDetail, travel]);

  if (denied) return <div className="tv-message">This spectator link is not valid.</div>;
  if (!mapDetail?.map) return <div className="tv-message">Waiting for the Dungeon Master to set an active map…</div>;

  const music = global?.music;
  const overlay = global?.tvOverlay;

  // While a kingdom journey plays, the map shows ONLY the walking party marker
  // (the derived "you are here" dots are hidden until they arrive).
  const journeying = mapDetail.map.is_world && journeyIsLive(travel);
  const tokens = journeying ? [] : (mapDetail.characters || []).map((c) => ({
    tokenKey: `c${c.id}`, kind: 'character', id: c.id, x: c.x, y: c.y,
    color: c.token_color, label: c.name, icon: c.token, scale: c.token_scale,
    shape: c.token_shape, animate: !c.teleport, path: c.path, draggable: false,
  })).concat((mapDetail.monsters || []).map((m) => ({
    tokenKey: `m${m.id}`, kind: 'monster', id: m.id, x: m.x, y: m.y,
    color: '#7a2f2f', label: m.name, icon: m.icon, scale: m.token_scale,
    shape: m.token_shape, animate: !m.teleport, path: m.path, draggable: false,
  }))).concat((mapDetail.npcs || []).map((n) => ({
    tokenKey: `n${n.id}`, kind: 'npc', id: n.id, x: n.x, y: n.y,
    color: '#8a7452', label: n.name, icon: n.token, scale: n.token_scale,
    shape: n.token_shape, animate: !n.teleport, path: n.path, draggable: false,
  })));

  // The travelling party: a marker that walks the kingdom route once, at the
  // journey's (slower) pace.
  if (journeying) {
    const end = travel.path[travel.path.length - 1];
    tokens.push({
      tokenKey: `travel-${travel.nonce}`, kind: 'travel',
      x: end[0], y: end[1], color: '#e4b343', label: 'Party',
      shape: 'circle', animate: true, path: travel.path, walkMs: travel.durationMs, draggable: false,
    });
  }

  // No doors here: connections are DM knowledge, the party map never marks them.
  const objects = (mapDetail.chests || []).map((c) => ({
    objKey: `chest${c.id}`, kind: 'chest', x: c.x, y: c.y, icon: c.icon, opened: c.state === 'opened',
  })).concat((mapDetail.shops || []).map((s2) => ({
    objKey: `shop${s2.id}`, kind: 'shop', x: s2.x, y: s2.y, icon: s2.icon, label: s2.name,
  })));

  return (
    <div className="tv-screen">
      <MapCanvas
        map={mapDetail.map}
        fogGrid={mapDetail.fogGrid}
        tokens={tokens}
        objects={objects}
        frameBox={frameBox}
      />
      <div className="tv-topbar">
        <span className="tv-mapname">{mapDetail.map.name}</span>
      </div>

      {overlay && (
        <div className="tv-overlay">
          <div className="tv-overlay-card">
            <ZoomableImage src={overlay.url} alt={overlay.title || ''} />
            {overlay.title && <p>{overlay.title}</p>}
          </div>
        </div>
      )}

      {/* audio only: the YouTube player is parked offscreen */}
      {audioReady && music?.track?.youtube_id && (
        <div className="yt-hidden">
          <YouTubePlayer videoId={music.track.youtube_id} playing={music.playing} />
        </div>
      )}
      {audioReady && music?.track && !music.track.youtube_id && music.track.file && (
        <audio src={music.track.file} autoPlay={music.playing} loop />
      )}
      <audio ref={sfxRef} />
      {!audioReady && (
        <button className="tv-audio-unlock" onClick={() => setAudioReady(true)}>
          Tap once to enable sound
        </button>
      )}
    </div>
  );
}
