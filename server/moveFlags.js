// Transient per-token movement metadata (in memory). The TV uses it to decide
// whether a position change should animate (a legal walk) or snap (teleport:
// crossed a wall/cliff, went through a door, was first placed, or was
// force-corrected by the DM).
//
// A move is a ONE-SHOT: it animates when it happens, and only then. The flag
// goes stale shortly after, so simply re-opening a map later shows the token
// standing where it is instead of re-walking its last trip every single time.
const flags = new Map(); // "c:<id>" | "m:<id>" -> { teleport, path, at }
const FRESH_MS = 8000;   // generous: covers the walk plus any delivery lag

export const tokenKeyOf = (kind, id) =>
  `${kind === 'monster' ? 'm' : kind === 'npc' ? 'n' : 'c'}:${id}`;

// `at` is injectable so tests can age a move without waiting for real seconds.
export function setMoveFlag(kind, id, teleport, path = null, at = Date.now()) {
  flags.set(tokenKeyOf(kind, id), { teleport: !!teleport, path, at });
}

function freshFlag(kind, id) {
  const f = flags.get(tokenKeyOf(kind, id));
  return f && Date.now() - f.at < FRESH_MS ? f : null;
}

export function wasTeleport(kind, id) {
  return freshFlag(kind, id)?.teleport ?? true; // unknown or old = snap, don't replay
}

// The walked route ([[x,y],...]) of the last move — the TV animates along it.
export function movePathOf(kind, id) {
  return freshFlag(kind, id)?.path ?? null;
}
