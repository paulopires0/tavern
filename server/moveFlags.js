// Transient per-token movement metadata (in memory, survives until the next
// move). The TV uses it to decide whether a position change should animate
// (a legal walk) or snap (teleport: crossed a wall/cliff, went through a door,
// was first placed, or was force-corrected by the DM).
const flags = new Map(); // "c:<id>" | "m:<id>" -> { teleport, path }

export const tokenKeyOf = (kind, id) =>
  `${kind === 'monster' ? 'm' : kind === 'npc' ? 'n' : 'c'}:${id}`;

export function setMoveFlag(kind, id, teleport, path = null) {
  flags.set(tokenKeyOf(kind, id), { teleport: !!teleport, path });
}

export function wasTeleport(kind, id) {
  return flags.get(tokenKeyOf(kind, id))?.teleport ?? true; // unknown = snap
}

// The walked route ([[x,y],...]) of the last move — the TV animates along it.
export function movePathOf(kind, id) {
  return flags.get(tokenKeyOf(kind, id))?.path ?? null;
}
