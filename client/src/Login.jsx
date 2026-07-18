import React, { useEffect, useState } from 'react';
import { api } from './api.js';

// Character select + password. The DM logs in through the same form using the
// DM entry (name is ignored server-side when the DM password matches).
export default function Login({ onLogin }) {
  const [characters, setCharacters] = useState([]);
  const [selected, setSelected] = useState(null); // character object or 'dm'
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('GET', '/api/meta').then((m) => setCharacters(m.characters)).catch(() => {});
  }, []);

  async function submit(ev) {
    ev.preventDefault();
    setError('');
    try {
      const name = selected === 'dm' ? '' : selected?.name;
      const res = await api('POST', '/api/login', { name, password });
      onLogin({ token: res.token, role: res.role, characterId: res.characterId });
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="login-screen">
      <h1 className="login-title">Tavern</h1>
      {!selected && (
        <div className="login-grid">
          {characters.map((c) => (
            <button key={c.id} className="login-char" onClick={() => setSelected(c)}>
              <span className="token-dot" style={{ background: c.token_color }} />
              {c.name}
            </button>
          ))}
          <button className="login-char login-dm" onClick={() => setSelected('dm')}>
            Dungeon Master
          </button>
          {characters.length === 0 && (
            <p className="muted">No characters yet — the DM creates them in the roster.</p>
          )}
        </div>
      )}
      {selected && (
        <form className="login-form" onSubmit={submit}>
          <h2>{selected === 'dm' ? 'Dungeon Master' : selected.name}</h2>
          <input
            type="password"
            autoFocus
            placeholder={selected === 'dm' ? 'DM password' : 'Character password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="button" className="ghost" onClick={() => { setSelected(null); setPassword(''); setError(''); }}>
              Back
            </button>
            <button type="submit">Enter</button>
          </div>
        </form>
      )}
    </div>
  );
}
