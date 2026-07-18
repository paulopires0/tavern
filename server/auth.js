// Minimal token auth: base64url(JSON payload) + "." + HMAC signature.
// Payload: { role: 'dm' } or { role: 'player', characterId }.
// No expiry — this is a LAN app for one gaming table (see README).
import crypto from 'node:crypto';
import { SESSION_SECRET, DM_PASSWORD } from './config.js';
import { db, parseChar, getConfig } from './db.js';

function hmac(data) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
}

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

// Resolve a login attempt to a viewer descriptor, or null. A DM password set
// in Settings (config) overrides the env/default one.
export function login(name, password) {
  const dmPassword = getConfig('dm_password', null) || DM_PASSWORD;
  if (password === dmPassword) return { role: 'dm' };
  const row = db.prepare('SELECT * FROM characters WHERE name = ?').get(name || '');
  if (row && row.password === password) {
    return { role: 'player', characterId: row.id };
  }
  return null;
}

// Turn a socket handshake / request into a viewer: {role, characterId?} or null.
export function viewerFromCredentials({ token, tvKey }) {
  if (tvKey) {
    return tvKey === getConfig('spectator_key') ? { role: 'tv' } : null;
  }
  const payload = verifyToken(token);
  if (!payload) return null;
  if (payload.role === 'dm') return { role: 'dm' };
  if (payload.role === 'player') {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(payload.characterId);
    return row ? { role: 'player', characterId: row.id } : null;
  }
  return null;
}

// Express middlewares.
export function requireDM(req, res, next) {
  const viewer = viewerFromCredentials({ token: req.headers['x-auth-token'] });
  if (viewer?.role !== 'dm') return res.status(401).json({ error: 'DM auth required' });
  next();
}

export function requirePlayer(req, res, next) {
  const viewer = viewerFromCredentials({ token: req.headers['x-auth-token'] });
  if (!viewer || viewer.role === 'tv') return res.status(401).json({ error: 'auth required' });
  req.viewer = viewer;
  next();
}

export function characterOf(viewer) {
  return parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(viewer.characterId));
}
