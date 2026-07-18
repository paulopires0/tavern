// A small in-memory feed of recent inventory changes, shown live in the DM
// console so the DM can watch what the party picks up, drops, buys and sells.
// Ephemeral on purpose: it is a running ticker, not a ledger — it resets when
// the server restarts and keeps only the last MAX events.
import { db } from './db.js';

const MAX = 60;
let seq = 0;
const events = []; // oldest first

// reason: 'added' | 'dropped' | 'bought' | 'sold' | 'looted' | 'dm'
export function logInventory(characterId, itemId, delta, reason) {
  if (!delta) return;
  const c = db.prepare('SELECT name FROM characters WHERE id = ?').get(Number(characterId));
  const it = db.prepare('SELECT name FROM items WHERE id = ?').get(Number(itemId));
  if (!c || !it) return; // character or item gone: nothing meaningful to show
  events.push({
    id: ++seq,
    ts: Date.now(),
    characterId: Number(characterId),
    characterName: c.name,
    itemName: it.name,
    delta: Number(delta),
    reason,
  });
  while (events.length > MAX) events.shift();
}

// Newest first, for the DM feed.
export function recentActivity() {
  return events.slice().reverse();
}
