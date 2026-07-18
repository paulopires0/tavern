import React, { useEffect, useRef, useState } from 'react';
import { connectSocket } from '../socket.js';
import { api, getAuth } from '../api.js';
import LiveMap from './LiveMap.jsx';
import MapEditor from './MapEditor.jsx';
import Roster from './Roster.jsx';
import Bestiary from './Bestiary.jsx';
import Items from './Items.jsx';
import Shops from './Shops.jsx';
import NPCs from './NPCs.jsx';
import Images from './Images.jsx';
import Music from './Music.jsx';
import Settings from './Settings.jsx';
import Help from './Help.jsx';
import { DiaryTab } from '../PlayerView.jsx';

const TABS = [
  ['play', 'Live'], ['maps', 'Map editor'], ['roster', 'Roster'], ['bestiary', 'Bestiary'],
  ['items', 'Items'], ['shops', 'Shops'], ['npcs', 'NPCs'],
  ['images', 'Images'], ['music', 'Music'], ['diary', 'Diary'], ['settings', 'Settings'],
  ['help', 'Help'],
];

export default function DMView({ onLogout }) {
  const [global, setGlobal] = useState(null);
  const [mapDetail, setMapDetail] = useState(null);
  const [viewMapId, setViewMapId] = useState(null);
  const [tab, setTab] = useState('play');
  const [toast, setToast] = useState('');
  const socketRef = useRef(null);
  const viewMapRef = useRef(null);
  viewMapRef.current = viewMapId;

  useEffect(() => {
    const s = connectSocket({ token: getAuth()?.token });
    socketRef.current = s;
    s.on('state', setGlobal);
    s.on('state:map', setMapDetail);
    s.on('connect', () => { // re-watch after reconnects
      if (viewMapRef.current != null) s.emit('watch', viewMapRef.current);
    });
    s.on('connect_error', (e) => { if (e.message === 'unauthorized') onLogout(); });
    return () => s.close();
  }, []);

  // Default the DM's viewed map to the active (TV) map once state arrives.
  useEffect(() => {
    if (viewMapId == null && global?.activeMapId != null) setViewMapId(global.activeMapId);
  }, [global, viewMapId]);

  useEffect(() => {
    if (viewMapId != null) socketRef.current?.emit('watch', viewMapId);
  }, [viewMapId]);

  // All mutations flow through here so failures surface as a toast.
  async function act(method, path, body) {
    try {
      return await api(method, path, body);
    } catch (e) {
      setToast(e.message);
      setTimeout(() => setToast(''), 4000);
      return null;
    }
  }

  if (!global) return <div className="dm-screen"><p className="muted pad">Loading…</p></div>;

  const detail = mapDetail && mapDetail.mapId === viewMapId ? mapDetail : null;
  const panelProps = { global, detail, viewMapId, setViewMapId, act };

  return (
    <div className="dm-screen">
      <nav className="dm-tabs">
        <span className="dm-brand">Tavern</span>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <a className="tab" href={`/?tv=${global.spectatorKey}`} target="_blank" rel="noreferrer">
          Open TV view
        </a>
        <button className="tab" onClick={onLogout}>Log out</button>
      </nav>
      <main className="dm-main">
        {tab === 'play' && <LiveMap {...panelProps} />}
        {tab === 'maps' && <MapEditor {...panelProps} />}
        {tab === 'roster' && <Roster {...panelProps} />}
        {tab === 'bestiary' && <Bestiary {...panelProps} />}
        {tab === 'items' && <Items {...panelProps} />}
        {tab === 'shops' && <Shops {...panelProps} />}
        {tab === 'npcs' && <NPCs {...panelProps} />}
        {tab === 'images' && <Images {...panelProps} />}
        {tab === 'music' && <Music {...panelProps} />}
        {tab === 'diary' && (
          <div className="panel">
            <DiaryTab entries={global.diary} act={act} base="/api/dm/diary" />
          </div>
        )}
        {tab === 'settings' && <Settings {...panelProps} />}
        {tab === 'help' && <Help />}
      </main>
      <InventoryNotifications activity={global.activity} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// Inventory changes pop as notifications on the left edge (any tab), then fade
// on their own. The server feed is newest-first; we only surface events that
// arrive AFTER mount, so a refresh or reconnect never replays the backlog.
const FEED_VERBS = {
  added: 'picked up', dropped: 'dropped', bought: 'bought',
  sold: 'sold', looted: 'looted', dm: 'received',
};
const NOTIFY_MS = 6500;

function InventoryNotifications({ activity }) {
  const events = activity || [];
  const [toasts, setToasts] = useState([]);
  const seenRef = useRef(null); // highest event id already handled
  const timersRef = useRef([]);

  useEffect(() => {
    const maxId = events.length ? events[0].id : 0; // newest-first ⇒ [0] is the max
    // First payload sets a baseline; a lower max than before means the server
    // restarted (its feed ids reset) — re-baseline instead of replaying.
    if (seenRef.current === null || maxId < seenRef.current) {
      seenRef.current = maxId;
      return;
    }
    const fresh = events.filter((e) => e.id > seenRef.current).reverse(); // oldest-new first
    if (!fresh.length) return;
    seenRef.current = maxId;
    setToasts((cur) => [...cur, ...fresh].slice(-5));
    for (const e of fresh) {
      const timer = setTimeout(
        () => setToasts((cur) => cur.filter((x) => x.id !== e.id)),
        NOTIFY_MS,
      );
      timersRef.current.push(timer);
    }
  }, [events]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  if (!toasts.length) return null;
  return (
    <div className="feed-toasts">
      {toasts.map((e) => (
        <div key={e.id} className={`feed-toast ${e.delta < 0 ? 'minus' : 'plus'}`}>
          <span className="feed-toast-amt">{e.delta < 0 ? '−' : '+'}{Math.abs(e.delta)}</span>
          <span className="feed-toast-body">
            <strong>{e.characterName}</strong> {FEED_VERBS[e.reason] || 'changed'} <em>{e.itemName}</em>
          </span>
        </div>
      ))}
    </div>
  );
}
