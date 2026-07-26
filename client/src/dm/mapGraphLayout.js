// Layout for the "all maps" graph.
//
// Door networks are almost always TREES — a town opens into its tavern, the
// tavern into a back room — so a force simulation was the wrong tool: it let
// unrelated branches drift into each other and crossed the lines. This lays the
// maps out as a tidy left-to-right tree instead, the way a family tree reads:
//   - depth (doors away from the root) picks the COLUMN
//   - leaves take consecutive rows; a parent sits centred on its children
// which is crossing-free for any tree, and keeps each branch visually together.
//
// Names are long ("Wakeharbor Castle Outside"), so a node's label lives to the
// RIGHT of its dot and counts as part of the node's block: columns are spaced by
// the widest block in the previous column, and branches leave from the right
// edge of the parent's label. Nothing ever overlaps.
//
// Doors that close a loop (rare) aren't part of the spanning tree; they come
// back as `treeEdges`-excluded and the view draws them as dashed shortcuts.
export const GRAPH = {
  FONT: 15,
  ROW: 58,        // vertical gap between two leaves
  COL_GAP: 54,    // horizontal room left for the branch curve
  LABEL_PAD: 9,   // dot -> label
  COMP_GAP: 0.7,  // extra rows between two separate door networks
  PAD: 26,
};

export const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const labelWidth = (m) => (String(m.name).length + (m.is_template ? 4 : 0)) * GRAPH.FONT * 0.55;

export function layoutGraph(maps, edges) {
  const empty = { nodes: [], treeEdges: new Set(), view: { x: 0, y: 0, w: 200, h: 120 } };
  if (!maps.length) return empty;

  const adj = new Map(maps.map((m) => [m.id, []]));
  for (const e of edges) {
    if (!adj.has(e.a) || !adj.has(e.b) || e.a === e.b) continue;
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  const degOf = (id) => adj.get(id).length;
  const radiusOf = (id) => 11 + Math.sqrt(degOf(id)) * 5;

  // --- spanning forest ------------------------------------------------------
  // Roots are picked deliberately: the kingdom map if it is in the set, then
  // whatever is best connected. That makes the busiest hub the trunk instead of
  // whichever map happened to be created first.
  const children = new Map(maps.map((m) => [m.id, []]));
  const depth = new Map();
  const treeEdges = new Set();
  const seen = new Set();
  const components = [];

  const rootOrder = [...maps].sort((a, b) =>
    (b.is_world ? 1 : 0) - (a.is_world ? 1 : 0) || degOf(b.id) - degOf(a.id) || a.id - b.id);

  for (const start of rootOrder) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    depth.set(start.id, 0);
    const queue = [start.id];
    while (queue.length) {
      const cur = queue.shift();
      // busiest child first, so the heavy branch reads at the top
      const nbrs = [...adj.get(cur)].sort((x, y) => degOf(y) - degOf(x) || x - y);
      for (const nb of nbrs) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        children.get(cur).push(nb);
        depth.set(nb, depth.get(cur) + 1);
        treeEdges.add(edgeKey(cur, nb));
        queue.push(nb);
      }
    }
    components.push(start.id);
  }

  // --- rows: leaves stack, parents centre on their children -----------------
  const leaves = new Map();
  const countLeaves = (id) => {
    const kids = children.get(id);
    if (!kids.length) { leaves.set(id, 1); return 1; }
    let sum = 0;
    for (const k of kids) sum += countLeaves(k);
    leaves.set(id, sum);
    return sum;
  };
  for (const root of components) countLeaves(root);

  const byId = new Map(maps.map((m) => [m.id, m]));
  for (const [, kids] of children) {
    kids.sort((x, y) => leaves.get(y) - leaves.get(x)
      || String(byId.get(x).name).localeCompare(String(byId.get(y).name)));
  }

  const yOf = new Map();
  let slot = 0;
  const placeY = (id) => {
    const kids = children.get(id);
    if (!kids.length) { yOf.set(id, slot * GRAPH.ROW); slot += 1; return; }
    for (const k of kids) placeY(k);
    yOf.set(id, (yOf.get(kids[0]) + yOf.get(kids[kids.length - 1])) / 2);
  };
  for (const root of components) {
    placeY(root);
    slot += GRAPH.COMP_GAP; // breathing room before the next network
  }

  // --- columns: wide enough for the widest label in the previous column -----
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const colBlock = new Array(maxDepth + 1).fill(0);
  for (const m of maps) {
    const d = depth.get(m.id);
    colBlock[d] = Math.max(colBlock[d], radiusOf(m.id) + GRAPH.LABEL_PAD + labelWidth(m));
  }
  const colX = [0];
  for (let d = 1; d <= maxDepth; d++) colX[d] = colX[d - 1] + colBlock[d - 1] + GRAPH.COL_GAP;

  const nodes = maps.map((m) => {
    const r = radiusOf(m.id);
    return {
      id: m.id,
      name: m.name,
      template: !!m.is_template,
      world: !!m.is_world,
      deg: degOf(m.id),
      depth: depth.get(m.id),
      lonely: degOf(m.id) === 0,
      x: colX[depth.get(m.id)],
      y: yOf.get(m.id),
      r,
      labelW: labelWidth(m),
    };
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    maxX = Math.max(maxX, n.x + n.r + GRAPH.LABEL_PAD + n.labelW);
    minY = Math.min(minY, n.y - n.r - GRAPH.FONT * 0.8);
    maxY = Math.max(maxY, n.y + n.r + GRAPH.FONT * 0.8);
  }
  const view = {
    x: minX - GRAPH.PAD, y: minY - GRAPH.PAD,
    w: (maxX - minX) + GRAPH.PAD * 2, h: (maxY - minY) + GRAPH.PAD * 2,
  };
  return { nodes, treeEdges, view };
}

// The curve for one door. Branches leave the right edge of the parent's label
// block and arrive at the child's dot, so a line never runs through a name.
// Same-depth links (loop-closing doors) bow out to the right instead.
export function edgePath(a, b) {
  const [p, c] = a.depth <= b.depth ? [a, b] : [b, a];
  const x1 = p.x + p.r + GRAPH.LABEL_PAD + p.labelW;
  const y1 = p.y;
  const y2 = c.y;
  if (a.depth === b.depth) {
    const x2 = c.x + c.r + GRAPH.LABEL_PAD + c.labelW;
    const bow = 34 + Math.abs(y2 - y1) * 0.22;
    return `M${x1},${y1} C${x1 + bow},${y1} ${x2 + bow},${y2} ${x2},${y2}`;
  }
  const x2 = c.x - c.r;
  const mx = x1 + (x2 - x1) * 0.5;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}
