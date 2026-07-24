// Which maps still need setup work, for the editor's checklist:
//   - ruler:    scale is untouched at the default 20 px/m (never measured)
//   - music:    no default (ambient) track set to auto-play on the TV
//   - kingdom:  no marker placed on the world map
// Templates are library pieces, not live locations, so they are left out; the
// world map itself is exempt from the kingdom-location check.
export function mapSetupIssues(maps) {
  const out = [];
  for (const m of maps) {
    if (m.is_template) continue;
    const missing = [];
    if (!(m.scale > 0) || m.scale === 20) missing.push('Ruler not measured (still the default 20 px/m)');
    if (m.default_track_id == null) missing.push('No ambient music set');
    if (!m.is_world && (m.world_x == null || m.world_y == null)) missing.push('Not placed on the kingdom map');
    if (missing.length) out.push({ map: m, missing });
  }
  return out;
}
