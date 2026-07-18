import { Router } from 'express';
import { db } from './db.js';
import { login, signToken } from './auth.js';

export const publicRouter = Router();

// Login screen data: character names only — no stats, no passwords.
publicRouter.get('/meta', (_req, res) => {
  const characters = db.prepare('SELECT id, name, token_color, portrait FROM characters ORDER BY name').all();
  res.json({ characters });
});

// One login endpoint decides the view: DM password => DM console,
// character name + password => that character's player view.
publicRouter.post('/login', (req, res) => {
  const { name, password } = req.body || {};
  const viewer = login(name, password ?? '');
  if (!viewer) return res.status(401).json({ error: 'Wrong name or password' });
  res.json({ token: signToken(viewer), ...viewer });
});
