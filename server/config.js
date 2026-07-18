// Environment-driven configuration. Everything has a LAN-friendly default.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const PORT = Number(process.env.PORT || 8030);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tavern.db');
export const DM_PASSWORD = process.env.DM_PASSWORD || 'buceta'; // change this! (README)
export const CLIENT_DIST = path.join(root, 'client', 'dist');

export const UPLOAD_KINDS = [
  'maps', 'music', 'images',
  'char-art', 'char-token',
  'npc-art', 'npc-token',
  'monster-art', 'monster-token',
  'chest-token', 'shop-token',
];
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
for (const sub of UPLOAD_KINDS) {
  fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
}

// Session secret: env var if provided, otherwise generated once and persisted
// so logins survive server restarts.
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
export const SESSION_SECRET = loadSecret();
