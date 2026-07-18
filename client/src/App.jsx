import React, { useState } from 'react';
import { getAuth, setAuth } from './api.js';
import Login from './Login.jsx';
import PlayerView from './PlayerView.jsx';
import TVView from './TVView.jsx';
import DMView from './dm/DMView.jsx';

// One URL for everything. ?tv=<spectator-key> renders the party screen with
// no login; otherwise the stored login decides between Player and DM views.
export default function App() {
  const [auth, setAuthState] = useState(getAuth);
  const tvKey = new URLSearchParams(window.location.search).get('tv');

  const login = (a) => { setAuth(a); setAuthState(a); };
  const logout = () => { setAuth(null); setAuthState(null); };

  if (tvKey) return <TVView tvKey={tvKey} />;
  if (!auth) return <Login onLogin={login} />;
  if (auth.role === 'dm') return <DMView onLogout={logout} />;
  return <PlayerView onLogout={logout} />;
}
