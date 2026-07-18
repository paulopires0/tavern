// Player self-service: this is the character's own sheet, so players edit it
// like a paper one — HP, gold, armor, stats, inventory, powers, diary, and
// their own art/token images. Everything is scoped to the logged-in character.
import express, { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db, addToInventory, removeFromInventory } from './db.js';
import { viewerFromCredentials } from './auth.js';
import { pushAll } from './state.js';
import { logInventory } from './activity.js';
import { UPLOADS_DIR } from './config.js';

export const playerRouter = Router();

playerRouter.use((req, res, next) => {
  const viewer = viewerFromCredentials({ token: req.headers['x-auth-token'] });
  if (viewer?.role !== 'player') return res.status(401).json({ error: 'player auth required' });
  req.characterId = viewer.characterId;
  next();
});

function ok(res, extra = {}) {
  pushAll();
  res.json({ ok: true, ...extra });
}

// --- sheet ----------------------------------------------------------------
const SELF_FIELDS = ['hp', 'max_hp', 'gold', 'armor', 'level', 'token_scale'];
playerRouter.patch('/me', (req, res) => {
  const body = req.body || {};
  const sets = [];
  const vals = [];
  for (const f of SELF_FIELDS) {
    if (f in body) {
      let v = Number(body[f]) || 0;
      if (f === 'token_scale') v = Math.min(6, Math.max(0.2, v || 1));
      sets.push(`${f} = ?`);
      vals.push(v);
    }
  }
  if (['circle', 'square', 'free'].includes(body.token_shape)) {
    sets.push('token_shape = ?');
    vals.push(body.token_shape);
  }
  if (body.stats && typeof body.stats === 'object') {
    sets.push('stats = ?'); vals.push(JSON.stringify(body.stats));
  }
  if (sets.length) {
    db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.characterId);
  }
  ok(res);
});

// --- inventory ---------------------------------------------------------------
// Players may only add plain items/consumables from the catalog — weapons,
// armor, lore and campaign gear are the DM's to hand out. This guard mirrors
// the filtered pick-list on the phone so a crafted request can't sneak gear in.
playerRouter.post('/inventory/add', (req, res) => {
  const { itemId, quantity = 1 } = req.body || {};
  const item = db.prepare('SELECT id, category FROM items WHERE id = ?').get(Number(itemId));
  if (!item) return res.status(400).json({ error: 'no such item' });
  if (!['item', 'consumable'].includes(item.category)) {
    return res.status(400).json({ error: 'only the DM can hand out weapons, armor and story items' });
  }
  const qty = Math.max(1, Number(quantity));
  addToInventory('character', req.characterId, item.id, qty);
  logInventory(req.characterId, item.id, qty, 'added');
  ok(res);
});

// A player invents something they picked up: a custom item/consumable created
// on the fly and dropped straight into their own bag. Reused by name so the
// catalog doesn't fill with duplicates.
playerRouter.post('/inventory/custom', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const category = req.body?.category === 'consumable' ? 'consumable' : 'item';
  const weight = Math.max(0, Number(req.body?.weight) || 0);
  const quantity = Math.max(1, Number(req.body?.quantity) || 1);
  let item = db.prepare(
    "SELECT id FROM items WHERE lower(name) = lower(?) AND category = ? AND tags LIKE '%custom%'"
  ).get(name, category);
  if (!item) {
    const info = db.prepare(`INSERT INTO items (name, description, category, measure, weight, value, tags)
      VALUES (?,?,?,?,?,?,?)`).run(name, '', category, 'unit', weight, 0, JSON.stringify(['custom']));
    item = { id: info.lastInsertRowid };
  }
  addToInventory('character', req.characterId, item.id, quantity);
  logInventory(req.characterId, item.id, quantity, 'added');
  ok(res);
});

playerRouter.post('/inventory/remove', (req, res) => {
  const { entryId, quantity = 1 } = req.body || {};
  const entry = db.prepare('SELECT * FROM inventory_entries WHERE id = ?').get(Number(entryId));
  if (!entry || entry.owner_type !== 'character' || entry.owner_id !== req.characterId) {
    return res.status(400).json({ error: 'not your item' });
  }
  const qty = Math.min(Math.max(1, Number(quantity)), entry.quantity);
  removeFromInventory(entry.id, qty);
  logInventory(req.characterId, entry.item_id, -qty, 'dropped');
  ok(res);
});

// --- powers --------------------------------------------------------------------
playerRouter.post('/powers', (req, res) => {
  const { name, description = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO powers (character_id, name, description) VALUES (?,?,?)')
    .run(req.characterId, name, description);
  ok(res, { id: info.lastInsertRowid });
});

playerRouter.patch('/powers/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM powers WHERE id = ? AND character_id = ?')
    .get(Number(req.params.id), req.characterId);
  if (!row) return res.status(400).json({ error: 'no such power' });
  const b = req.body || {};
  db.prepare('UPDATE powers SET name = ?, description = ? WHERE id = ?')
    .run(b.name ?? row.name, b.description ?? row.description, row.id);
  ok(res);
});

playerRouter.delete('/powers/:id', (req, res) => {
  db.prepare('DELETE FROM powers WHERE id = ? AND character_id = ?')
    .run(Number(req.params.id), req.characterId);
  ok(res);
});

// --- diary -----------------------------------------------------------------------
playerRouter.post('/diary', (req, res) => {
  const { title = '', body = '' } = req.body || {};
  const info = db.prepare('INSERT INTO diary_entries (character_id, title, body) VALUES (?,?,?)')
    .run(req.characterId, title, body);
  ok(res, { id: info.lastInsertRowid });
});

playerRouter.patch('/diary/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM diary_entries WHERE id = ? AND character_id = ?')
    .get(Number(req.params.id), req.characterId);
  if (!row) return res.status(400).json({ error: 'no such entry' });
  const b = req.body || {};
  db.prepare('UPDATE diary_entries SET title = ?, body = ? WHERE id = ?')
    .run(b.title ?? row.title, b.body ?? row.body, row.id);
  ok(res);
});

playerRouter.delete('/diary/:id', (req, res) => {
  db.prepare('DELETE FROM diary_entries WHERE id = ? AND character_id = ?')
    .run(Number(req.params.id), req.characterId);
  ok(res);
});

// --- own art & token ------------------------------------------------------------------
// kind=art -> portrait (sheet picture); kind=token -> the PNG that walks the map
playerRouter.put('/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const kind = req.query.kind === 'token' ? 'token' : 'art';
  if (!req.body?.length) return res.status(400).json({ error: 'empty upload' });
  const dir = kind === 'token' ? 'char-token' : 'char-art';
  const safe = path.basename(String(req.query.name || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${Date.now()}-${safe}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, dir, filename), req.body);
  const url = `/uploads/${dir}/${filename}`;
  const column = kind === 'token' ? 'token' : 'portrait';
  db.prepare(`UPDATE characters SET ${column} = ? WHERE id = ?`).run(url, req.characterId);
  ok(res, { path: url });
});
