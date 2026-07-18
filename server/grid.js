// The map is continuous; only FOG is bookkept on an internal square lattice
// (FOG_CELL_METERS per cell — never rendered as a grid). This decorates a map
// row with the cell geometry clients and fog code share.
import { FOG_CELL_METERS } from '../shared/gameRules.js';
import { getMap, effectiveMap } from './db.js';

export function decorateGrid(map) {
  if (!map) return null;
  const scale = map.scale > 0 ? map.scale : 20; // px per meter
  // Kingdom-scale maps (few px per meter) would explode the lattice; cap the
  // density so the fog grid never exceeds ~100 cells across.
  const cellPx = Math.max(scale * FOG_CELL_METERS, map.image_w / 100, 8);
  return {
    ...map,
    cell_px: cellPx,
    cells_x: Math.max(1, Math.ceil(map.image_w / cellPx)),
    cells_y: Math.max(1, Math.ceil(map.image_h / cellPx)),
  };
}

export function getGridMap(mapId) {
  return decorateGrid(effectiveMap(getMap(mapId)));
}

export const cellKey = (cx, cy) => `${cx},${cy}`;
export const cellOf = (map, x, y) => [Math.floor(x / map.cell_px), Math.floor(y / map.cell_px)];
export const cellCenter = (map, cx, cy) => ({
  x: (cx + 0.5) * map.cell_px,
  y: (cy + 0.5) * map.cell_px,
});
