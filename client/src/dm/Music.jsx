import React, { useRef, useState } from 'react';
import { upload } from '../api.js';
import { Field } from '../fields.jsx';

// Per-map YouTube playlists (audio plays on the TV, no video shown), a
// per-map default track, and the soundboard of uploaded one-shot sounds.
export default function Music({ global, viewMapId, setViewMapId, act }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [sndName, setSndName] = useState('');
  const sndFileRef = useRef(null);

  const music = global.music;
  const mapRow = global.maps.find((m) => m.id === viewMapId);
  const tracks = global.tracks.filter((t) => t.map_id === viewMapId);

  return (
    <div className="panel">
      <div className="card">
        <div className="row">
          <h3>Now playing</h3>
          <span className="spacer" />
          {music.track
            ? <span>{music.playing ? '▶' : '⏸'} {music.track.name}</span>
            : <span className="muted">nothing</span>}
          {music.track && (
            <>
              <button onClick={() => act('POST', '/api/dm/music', { trackId: music.track.id, playing: !music.playing })}>
                {music.playing ? 'Pause' : 'Resume'}
              </button>
              <button onClick={() => act('POST', '/api/dm/music', { trackId: null, playing: false })}>Stop</button>
            </>
          )}
        </div>
        <p className="muted small">
          The TV plays audio only (no video shown). It needs one tap after loading and
          internet for YouTube. Quick controls also live in the Live tab sidebar.
        </p>
      </div>

      <div className="card">
        <div className="row">
          <h3>Tracks for</h3>
          <select value={viewMapId ?? ''} onChange={(e) => setViewMapId(Number(e.target.value))}>
            {global.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <ul className="inv-list">
          {tracks.map((t) => (
            <li key={t.id}>
              <span>
                {music.track?.id === t.id && music.playing ? '▶ ' : ''}{t.name}
                {mapRow?.default_track_id === t.id && <span className="cat-badge inline">default</span>}
                {t.youtube_id && (
                  <a className="muted small" style={{ marginLeft: 8 }} target="_blank" rel="noreferrer"
                    href={`https://www.youtube.com/watch?v=${t.youtube_id}`}>open</a>
                )}
              </span>
              <span>
                <button className="mini" onClick={() => act('POST', '/api/dm/music', { trackId: t.id, playing: true })}>Play</button>
                <button className="mini" title="Auto-start when this map goes on the TV"
                  onClick={() => act('PATCH', `/api/dm/maps/${viewMapId}`,
                    { default_track_id: mapRow?.default_track_id === t.id ? null : t.id })}>
                  {mapRow?.default_track_id === t.id ? 'Unset default' : 'Set default'}
                </button>
                <button className="mini danger" onClick={() => act('DELETE', `/api/dm/tracks/${t.id}`)}>del</button>
              </span>
            </li>
          ))}
          {tracks.length === 0 && <li className="muted">No tracks for this map yet.</li>}
        </ul>
        <div className="row">
          <input placeholder="Track name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="YouTube link" className="grow" value={link} onChange={(e) => setLink(e.target.value)} />
          <button onClick={async () => {
            if (!link.trim()) return;
            if (await act('POST', '/api/dm/tracks', { mapId: viewMapId, name: name.trim() || 'track', youtubeUrl: link.trim() })) {
              setName(''); setLink('');
            }
          }}>Add track</button>
        </div>
      </div>

      <div className="card">
        <h3>Soundboard</h3>
        <p className="muted small">Short audio files (wav/mp3/ogg) fired once on the TV — door slams, thunder, a scream. Buttons also appear in the Live tab.</p>
        <ul className="inv-list">
          {global.sounds.map((snd) => (
            <li key={snd.id}>
              <span className="row">
                <button className="mini" onClick={() => act('POST', `/api/dm/sounds/${snd.id}/play`)}>Play on TV</button>
                <Field label="" value={snd.name} onSave={(v) => act('PATCH', `/api/dm/sounds/${snd.id}`, { name: v })} />
              </span>
              <button className="mini danger" onClick={() => act('DELETE', `/api/dm/sounds/${snd.id}`)}>del</button>
            </li>
          ))}
          {global.sounds.length === 0 && <li className="muted small">No sounds yet.</li>}
        </ul>
        <div className="row">
          <input placeholder="Sound name" value={sndName} onChange={(e) => setSndName(e.target.value)} />
          <input type="file" accept="audio/*" ref={sndFileRef} />
          <button onClick={async () => {
            const f = sndFileRef.current?.files[0];
            if (!f) return;
            const path = await upload('music', f);
            if (await act('POST', '/api/dm/sounds', { name: sndName.trim() || f.name, file: path })) {
              setSndName(''); sndFileRef.current.value = '';
            }
          }}>Upload sound</button>
        </div>
      </div>
    </div>
  );
}
