// Accepts a pasted YouTube URL in any of the common shapes (watch, youtu.be,
// shorts, embed, live) or a bare 11-char video id; returns the id or null.
export function parseYoutubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
