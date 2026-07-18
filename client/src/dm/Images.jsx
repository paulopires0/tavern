import React, { useRef, useState } from 'react';
import { upload } from '../api.js';

// Image library: letters the party finds, faces, scenes. "Show on TV" flashes
// the picture over the party screen until hidden.
export default function Images({ global, act }) {
  const fileRef = useRef(null);
  const [name, setName] = useState('');

  return (
    <div className="panel">
      <div className="card">
        <h3>Add image</h3>
        <div className="row">
          <input placeholder="Name (e.g. Smuggler's letter)" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="file" accept="image/*" ref={fileRef} />
          <button onClick={async () => {
            const f = fileRef.current?.files[0];
            if (!f) return;
            const path = await upload('images', f);
            if (await act('POST', '/api/dm/images', { name: name.trim() || f.name, path })) {
              setName(''); fileRef.current.value = '';
            }
          }}>Upload</button>
        </div>
      </div>

      {global.tvOverlay && (
        <div className="card row spread">
          <span>Now on TV: <strong>{global.tvOverlay.title || global.tvOverlay.url}</strong></span>
          <button onClick={() => act('DELETE', '/api/dm/tv-overlay')}>Hide from TV</button>
        </div>
      )}

      <div className="image-grid">
        {global.images.map((img) => (
          <figure key={img.id} className="image-tile">
            <img src={img.path} alt={img.name} />
            <figcaption>{img.name}</figcaption>
            <div className="row">
              <button onClick={() => act('POST', '/api/dm/tv-overlay', { url: img.path, title: img.name })}>
                Show on TV
              </button>
              <button className="mini danger" onClick={() => {
                if (confirm(`Delete image "${img.name}"?`)) act('DELETE', `/api/dm/images/${img.id}`);
              }}>del</button>
            </div>
          </figure>
        ))}
      </div>
      {global.images.length === 0 && <p className="muted pad">No images uploaded yet.</p>}
    </div>
  );
}
