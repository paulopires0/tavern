// A kingdom-journey cue is a ONE-SHOT: it only plays while it is still fresh.
// Once the walk's time has passed — or the cue is simply left over from an
// earlier journey/session — the marker must not animate again. Without this,
// re-opening the kingdom map after the party had already arrived would replay
// the whole trip.
export function journeyIsLive(cue) {
  if (!cue?.nonce || !Array.isArray(cue.path) || cue.path.length < 2) return false;
  return Date.now() - cue.nonce < (cue.durationMs || 2600) + 1500;
}
