// Placeholder default token art, generated once so the app works before the
// DM drops in real images. To replace a default, either upload art on the
// entity itself, or put your own file named default.png (or .jpg/.webp/.svg)
// into the matching data/uploads/<kind>/ folder — user files beat the
// generated default.svg (see resolveDefault below).
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from './config.js';

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

const DEFAULTS = {
  'npc-token': svg(`
    <circle cx="32" cy="32" r="30" fill="#2c2620" stroke="#c9a86a" stroke-width="3"/>
    <circle cx="32" cy="24" r="9" fill="#c9a86a"/>
    <path d="M14 52 Q32 34 50 52 Z" fill="#c9a86a"/>`),
  'npc-art': svg(`
    <rect width="64" height="64" rx="6" fill="#2c2620" stroke="#c9a86a" stroke-width="2"/>
    <circle cx="32" cy="26" r="11" fill="#8a7452"/>
    <path d="M12 56 Q32 36 52 56 Z" fill="#8a7452"/>`),
  'monster-token': svg(`
    <circle cx="32" cy="32" r="30" fill="#301a18" stroke="#c0504d" stroke-width="3"/>
    <path d="M20 40 L26 22 L32 36 L38 22 L44 40 Q32 50 20 40 Z" fill="#c0504d"/>
    <circle cx="26" cy="30" r="2.5" fill="#301a18"/><circle cx="38" cy="30" r="2.5" fill="#301a18"/>`),
  'monster-art': svg(`
    <rect width="64" height="64" rx="6" fill="#301a18" stroke="#c0504d" stroke-width="2"/>
    <path d="M18 44 L25 20 L32 38 L39 20 L46 44 Q32 54 18 44 Z" fill="#c0504d"/>`),
  'chest-token': svg(`
    <rect x="8" y="24" width="48" height="28" rx="5" fill="#6b4a2b" stroke="#3a2b1d" stroke-width="3"/>
    <path d="M8 30 Q32 8 56 30 L56 36 L8 36 Z" fill="#8a5f36" stroke="#3a2b1d" stroke-width="3"/>
    <rect x="27" y="30" width="10" height="14" rx="2" fill="#e3b23c" stroke="#3a2b1d" stroke-width="2"/>`),
  'shop-token': svg(`
    <ellipse cx="26" cy="44" rx="16" ry="7" fill="#e3b23c" stroke="#8a6414" stroke-width="2"/>
    <ellipse cx="26" cy="38" rx="16" ry="7" fill="#f0c75e" stroke="#8a6414" stroke-width="2"/>
    <ellipse cx="38" cy="30" rx="16" ry="7" fill="#e3b23c" stroke="#8a6414" stroke-width="2"/>
    <ellipse cx="38" cy="24" rx="16" ry="7" fill="#f7d987" stroke="#8a6414" stroke-width="2"/>`),
};

export function ensureDefaultArt() {
  for (const [kind, content] of Object.entries(DEFAULTS)) {
    const dir = path.join(UPLOADS_DIR, kind);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'default.svg');
    if (!fs.existsSync(file)) fs.writeFileSync(file, content);
  }
}

// Entities store the stable URL "/uploads/<kind>/default"; this resolves it to
// the best default file present, preferring user-provided rasters.
export function resolveDefault(kind) {
  const dir = path.join(UPLOADS_DIR, kind);
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'svg']) {
    const file = path.join(dir, `default.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export const defaultUrl = (kind) => `/uploads/${kind}/default`;
