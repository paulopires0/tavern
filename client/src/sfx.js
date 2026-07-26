// A soundboard cue is a ONE-SHOT tied to the moment the DM pressed the button.
// It has to be judged fresh the same way a kingdom journey is (see journey.js):
// the cue sits in the campaign config, so without a freshness window a screen
// that connects later — or a viewer who taps "enable sound" later — would fire
// a sound that was played minutes or days ago.
export const SFX_FRESH_MS = 5000;

export function sfxIsLive(cue) {
  if (!cue?.nonce || !cue.url) return false;
  return Date.now() - cue.nonce < SFX_FRESH_MS;
}
