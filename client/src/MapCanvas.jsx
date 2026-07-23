import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  TOKEN_METERS, TOKEN_MIN_SCREEN_PX, TOKEN_MAX_VIEW_FRACTION,
  MAP_LABEL_OF_TOKEN, MAP_LABEL_MIN_SCREEN_PX,
  MAP_SETTLE_MS, MAP_TILE_PX, MAP_BASE_PX, MAP_TILE_PAD,
} from '../../shared/gameRules.js';
import { strokeSegments, cliffNormal, polylineLength } from '../../shared/geometry.js';

// Continuous-map renderer shared by the TV, DM live console and map editor.
// Interaction model:
//   wheel               zoom toward the cursor (also +/- buttons)
//   drag the background pan (any view); with a paint tool armed it paints
//   drag a token        move it (all shift-selected tokens move together)
//   click a token       select (shift-click adds to the selection)
//   click the table     onCanvasClick(x, y) — placements, ruler…
// You can zoom past the art: the world beyond is a wooden table.
//
// props:
//   map          {image, image_w, image_h, scale, token_scale, cell_px, ...}
//   strokes      painted physics (DM views only)
//   fogGrid      {"cx,cy": 0|1|2} or null
//   tokens       [{tokenKey, kind, id, x, y, icon, color, label, sub, scale, draggable}]
//   objects      [{objKey, kind: chest|shop|npc|connection, x, y, icon, label, opened, scale}]
//   rings        [{x, y, radiusPx, color, label, fill}]
//   notes        DM annotations [{id, x, y, text, open, box_dx, box_dy}] (DM views only)
//   guide        in-progress polyline {kind, points:[[x,y]…], close} | null (editor)
//   ruler        measure mode: points:[[x,y]…] | null — draws the path with
//                per-leg and total distances (metres, via map.scale)
//   selectedKeys Set of tokenKey
//   ink          DM drawing everyone sees [{id, tool, points, color, width}]
//   paint        null | {kind: wall|sight|cliff|ink, tool: brush|line|rect|eraser,
//                        width: px, color: css (ink only)}
//   onStroke({kind, tool, points, width, color})
//   onErase(points, radius)  — an eraser drag, in image px
//   onTokenClick(token, shiftKey)
//   onTokensMove([{token, x, y}]) — the dragged token's move comes FIRST
//   onNoteToggle(note)   click an open card or its pin: fold/unfold
//   onNoteMove(note, {box_dx, box_dy})  after dragging an open card
//   onObjectClick(object)  click an object flagged {clickable:true} (DM) — e.g. loot
//   onCanvasClick(x, y)
const STROKE_STYLE = {
  wall: { stroke: '#c0504d', opacity: 0.8, dash: null },
  sight: { stroke: '#7fb3ff', opacity: 0.75, dash: '10 7' },
  cliff: { stroke: '#e0a050', opacity: 0.85, dash: null },
};

// --- vector maps, rendered like a map app -----------------------------------
// A viewBox change re-draws vector content, so a 159k-path SVG re-renders every
// path on every pan frame. But the browser CULLS to the region you ask for:
// drawing a 1/40 crop costs ~3 ms where the whole map costs ~105 ms. So we never
// draw the vector per frame — we render the VISIBLE REGION to a bitmap whenever
// the view settles, at the resolution the screen is actually showing. Zoom in
// and you get true vector detail (the crop gets cheaper the deeper you go); pan
// and zoom stay smooth because they only move an already-rendered bitmap.
// Budgets and timing live in shared/gameRules.js with the rest of the tunables.
const BASE_RASTER_PX = MAP_BASE_PX;
const DETAIL_RASTER_PX = MAP_TILE_PX;

// Rasterise a region of an already-decoded SVG image. `scale` is the wanted
// bitmap px per image px; it is capped so one tile can't blow up memory.
// Resolves { url, k } where k is the resolution actually achieved — it can be
// below what was asked for once the pixel cap bites, and the caller must know
// that or it will think the tile is sharper than it is and never refine it.
function renderRegion(img, x, y, w, h, maxPx, scale) {
  const k = Math.min(scale ?? 1, Math.sqrt(maxPx / Math.max(1, w * h)));
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, w, h, 0, 0, tw, th);
      // WebP encodes and decodes several times faster than PNG at this size and
      // is visually indistinguishable here — that speed is what stops the
      // refresh from being perceptible. Browsers that lack it fall back to PNG.
      canvas.toBlob((b) => resolve(b ? { url: URL.createObjectURL(b), k } : null), 'image/webp', 0.92);
    } catch {
      resolve(null); // keep the vector rather than break the map
    }
  });
}

// The slice of the map on screen, padded so small pans reuse the same tile.
function visibleRegion(vb, map) {
  const padX = vb.w * MAP_TILE_PAD;
  const padY = vb.h * MAP_TILE_PAD;
  const x = Math.max(0, vb.x - padX);
  const y = Math.max(0, vb.y - padY);
  return {
    x,
    y,
    w: Math.min(map.image_w - x, vb.w + padX * 2),
    h: Math.min(map.image_h - y, vb.h + padY * 2),
  };
}

export default function MapCanvas({
  map, strokes = [], ink = [], fogGrid = null, tokens = [], objects = [], rings = [],
  notes = [], guide = null, ruler = null, frameBox = null, selectedKeys = null, paint = null,
  onStroke, onErase, onTokenClick, onTokensMove, onNoteToggle, onNoteMove,
  onObjectClick, onCanvasClick,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gestureRef = useRef(null);
  const [vb, setVb] = useState(null);            // viewBox {x, y, w, h}
  const [size, setSize] = useState({ w: 800, h: 600 }); // container px
  const [dragDelta, setDragDelta] = useState(null);     // token drag ghost
  const [noteDrag, setNoteDrag] = useState(null);       // note card drag ghost
  const [preview, setPreview] = useState(null);         // paint preview stroke
  const [hoverPt, setHoverPt] = useState(null);         // cursor in svg space (poly guide)

  // --- viewport ---------------------------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the map (or, for kingdom/dungeon maps, the explored frameBox) whenever
  // the map itself changes.
  useEffect(() => {
    if (!map) return;
    fitView();
  }, [map?.id, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow-only reframe: when the explored area (frameBox) pushes past the current
  // view, zoom out to include it — so the map "grows" as the party discovers,
  // without jittering back on every step within an already-shown area.
  useEffect(() => {
    if (!map || !frameBox) return;
    setVb((cur) => (cur && boxInside(frameBox, cur) ? cur : vbForBox(frameBox)));
  }, [map?.id, frameBox?.x, frameBox?.y, frameBox?.w, frameBox?.h, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  function vbForImage() {
    const aspect = size.h / size.w;
    let w = map.image_w * 1.12;
    let h = w * aspect;
    if (h < map.image_h * 1.12) { h = map.image_h * 1.12; w = h / aspect; }
    return { x: (map.image_w - w) / 2, y: (map.image_h - h) / 2, w, h };
  }

  function vbForBox(box) {
    const pad = Math.max(box.w, box.h) * 0.14 + (map.scale || 20);
    const bx = box.x - pad, by = box.y - pad, bw = box.w + pad * 2, bh = box.h + pad * 2;
    const aspect = size.h / size.w;
    let w = bw, h = w * aspect;
    if (h < bh) { h = bh; w = h / aspect; }
    return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h };
  }

  const boxInside = (b, v) => b.x >= v.x && b.y >= v.y
    && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h;

  function fitView() {
    setVb(frameBox ? vbForBox(frameBox) : vbForImage());
  }

  function zoomBy(factor, cx = null, cy = null) {
    setVb((v) => {
      if (!v) return v;
      const w = Math.min(Math.max(v.w / factor, map.image_w / 20), map.image_w * 6);
      const h = w * (v.h / v.w);
      const fx = cx == null ? v.x + v.w / 2 : cx;
      const fy = cy == null ? v.y + v.h / 2 : cy;
      const kx = (fx - v.x) / v.w;
      const ky = (fy - v.y) / v.h;
      return { x: fx - kx * w, y: fy - ky * h, w, h };
    });
  }

  // React registers wheel listeners passively; zoom needs preventDefault.
  // Attached once per map (not per render — re-attaching every frame lags).
  // The <svg> only exists once vb is set, so the effect must also re-run on
  // that flip — keying on map.id alone left the wheel dead until the DM
  // switched maps (the "zoom sometimes doesn't work" bug).
  const svgMounted = vb != null;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (ev) => {
      ev.preventDefault();
      const p = toSvg(ev);
      zoomBy(ev.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [map?.id, svgMounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- fog --------------------------------------------------------------------
  // The fog is CONTINUOUS — never a grid. Cell states are painted into a tiny
  // per-cell canvas, then that canvas is supersampled and BLURRED (baked once,
  // no live SVG filter) before being stretched over the map as a single
  // <image>. The blur melts the cell edges so the squares all but vanish, while
  // the interior of an unexplored region stays FULLY opaque (you can't see the
  // map through the dark). Cheap: one cached bitmap, rebuilt only when fog changes.
  const fogImage = useMemo(() => {
    if (!fogGrid || !map?.cell_px || !map?.cells_x) return null;
    const { cells_x: cw, cells_y: ch } = map;
    const cells = document.createElement('canvas');
    cells.width = cw;
    cells.height = ch;
    const cctx = cells.getContext('2d');
    const img = cctx.createImageData(cw, ch);
    const put = (o, r, g, b, a) => {
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
    };
    for (const [k, st] of Object.entries(fogGrid)) {
      if (st === 2) continue;
      const [cx, cy] = k.split(',').map(Number);
      if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
      const o = (cy * cw + cx) * 4;
      if (st === 1) put(o, 54, 59, 67, 122);   // explored, unwatched: light grey wash
      else put(o, 6, 8, 12, 255);              // never seen: TOTALLY opaque
    }
    cctx.putImageData(img, 0, 0);

    // supersample + sub-cell blur to dissolve the grid
    const S = 4;
    const out = document.createElement('canvas');
    out.width = cw * S;
    out.height = ch * S;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.filter = `blur(${S * 0.6}px)`; // ~0.6 of a cell
    octx.drawImage(cells, 0, 0, out.width, out.height);
    return { url: out.toDataURL(), w: cw * map.cell_px, h: ch * map.cell_px };
  }, [fogGrid, map?.cell_px, map?.cells_x, map?.cells_y]);

  const strokeLayer = useMemo(
    () => strokes.map((st) => renderStroke(st, `s${st.id}`)),
    [strokes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- big vector maps --------------------------------------------------------
  // A viewBox change invalidates vector rendering, so an SVG background is
  // re-drawn path-by-path EVERY pan/zoom frame — a 150k-path map is hopeless
  // (a browser tab feels fine only because it rasterises once and then scrolls a
  // cached bitmap). So we do the same: rasterise the SVG at the resolution it is
  // actually shown at. Panning then costs one bitmap blit, and we re-rasterise
  // (debounced) only when the zoom changes enough to be visible — so it stays
  // as sharp as the screen can show instead of a fixed, blurry snapshot.
  const isSvg = !!map?.image && /\.svg(\?|$)/i.test(map.image);
  const svgRef2 = useRef(null);             // the decoded vector, parsed once
  const [base, setBase] = useState(null);   // whole-map underlay
  const [tile, setTile] = useState(null);   // { url, x, y, w, h } crisp detail

  // Decode the vector once, then draw a whole-map underlay so the board is
  // always covered even while you fling around.
  useEffect(() => {
    if (!isSvg || !map) return undefined;
    let cancelled = false;
    let mine = null;
    const img = new Image();
    img.onload = async () => {
      if (cancelled) return;
      svgRef2.current = img;
      const made = await renderRegion(img, 0, 0, map.image_w, map.image_h, BASE_RASTER_PX, 1);
      if (cancelled) { if (made) URL.revokeObjectURL(made.url); return; }
      if (!made) return;
      mine = made.url;
      setBase(made.url);
    };
    img.src = map.image;
    return () => {
      cancelled = true;
      svgRef2.current = null;
      setBase(null);
      setTile(null);
      if (mine) URL.revokeObjectURL(mine);
    };
  }, [isSvg, map?.image, map?.image_w, map?.image_h]);

  // Whenever the view settles, re-render exactly what's on screen at screen
  // resolution — this is what keeps fine detail readable however far you zoom.
  useEffect(() => {
    if (!isSvg || !vb || !map) return undefined;
    let cancelled = false; // a render that lands after the view moved is stale
    const timer = setTimeout(async () => {
      const img = svgRef2.current;
      if (!img) return;
      const want = size.w / vb.w;                       // bitmap px per image px
      const region = visibleRegion(vb, map);
      if (region.w <= 0 || region.h <= 0) return;       // panned right off the map
      // Compare against what a tile CAN reach, not what we'd like: once the
      // pixel cap bites, the achieved k stays below `want` and we would
      // otherwise re-render the same tile forever.
      const target = Math.min(want, Math.sqrt(DETAIL_RASTER_PX / Math.max(1, region.w * region.h)));
      // already covered at a good-enough resolution? leave it alone
      if (tile && tile.k >= target * 0.9
          && tile.x <= region.x && tile.y <= region.y
          && tile.x + tile.w >= region.x + region.w
          && tile.y + tile.h >= region.y + region.h) return;
      const made = await renderRegion(img, region.x, region.y, region.w, region.h, DETAIL_RASTER_PX, want);
      if (!made) return;
      // Decode BEFORE showing it. Swapping straight to a fresh blob makes the
      // browser fetch+decode while it paints, so the old tile is already gone
      // and the blurry underlay shows through for a frame — that's the flash.
      try {
        const pre = new Image();
        pre.src = made.url;
        if (pre.decode) await pre.decode();
      } catch { /* decode is an optimisation; show it anyway */ }
      if (cancelled) { URL.revokeObjectURL(made.url); return; }
      setTile((prev) => {
        // hold the old bitmap a moment longer: revoking it the instant we swap
        // can pull it out from under a paint that hasn't happened yet
        if (prev?.url) setTimeout(() => URL.revokeObjectURL(prev.url), 2000);
        return { url: made.url, ...region, k: made.k };
      });
    }, MAP_SETTLE_MS); // only once you stop moving
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isSvg, map?.image, vb?.x, vb?.y, vb?.w, size.w, size.h, base, tile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Until the vector is decoded, show it directly so the map is never blank.
  const background = isSvg ? base : map?.image;
  const rawVector = isSvg && !base ? map.image : null;

  if (!map) return <div className="map-empty">No map selected</div>;

  function toSvg(ev) {
    const pt = new DOMPoint(ev.clientX, ev.clientY);
    return pt.matrixTransform(svgRef.current.getScreenCTM().inverse());
  }

  // --- pointer gestures ---------------------------------------------------------
  function onPointerDown(ev) {
    if (ev.button === 2) return;
    svgRef.current.setPointerCapture(ev.pointerId);
    const p = toSvg(ev);
    if (paint?.tool === 'eraser' && onErase) {
      gestureRef.current = { type: 'erase', points: [[p.x, p.y]], last: p };
      setPreview({ ...paint, points: [[p.x, p.y]] });
      return;
    }
    if (paint && onStroke) {
      gestureRef.current = { type: 'paint', points: [[p.x, p.y]], last: p };
      setPreview({ ...paint, tool: paint.tool, points: [[p.x, p.y]] });
      return;
    }
    gestureRef.current = {
      type: 'pan', startClient: [ev.clientX, ev.clientY], vb0: vb, p0: p, moved: false,
    };
  }

  function onTokenPointerDown(t, ev) {
    if (paint || ruler) return; // drawing/measuring: clicks fall through to the map, not the token
    if (!(t.draggable || onTokenClick)) return;
    ev.stopPropagation();
    svgRef.current.setPointerCapture(ev.pointerId);
    gestureRef.current = { type: 'drag', token: t, p0: toSvg(ev), moved: false, shift: ev.shiftKey };
  }

  // Map icons the DM can act on (a chest to loot, a shop to stock). A click
  // opens it; a small drag is treated as a pan of the map instead, so the icon
  // never traps a pan that merely started on top of it.
  function onObjectPointerDown(o, ev) {
    if (paint || ruler || !onObjectClick) return;
    ev.stopPropagation();
    svgRef.current.setPointerCapture(ev.pointerId);
    gestureRef.current = { type: 'object', object: o, p0: toSvg(ev), vb0: vb, startClient: [ev.clientX, ev.clientY], moved: false };
  }

  // Open note cards drag freely (even off the map art, onto the table); a
  // click without movement folds them instead.
  function onNotePointerDown(n, base, ev) {
    if (paint || ruler) return; // ditto: notes don't catch the brush or ruler
    ev.stopPropagation();
    svgRef.current.setPointerCapture(ev.pointerId);
    gestureRef.current = { type: 'note', note: n, base, p0: toSvg(ev), moved: false };
  }

  function onPointerMove(ev) {
    const g = gestureRef.current;
    if (!g) {
      // no active gesture: track the cursor so the poly guide / ruler rubber-bands
      if (guide || ruler) setHoverPt(toSvg(ev));
      return;
    }
    if (g.type === 'pan') {
      const dx = (ev.clientX - g.startClient[0]) * (g.vb0.w / size.w);
      const dy = (ev.clientY - g.startClient[1]) * (g.vb0.h / size.h);
      if (Math.hypot(ev.clientX - g.startClient[0], ev.clientY - g.startClient[1]) > 4) g.moved = true;
      if (g.moved) setVb({ ...g.vb0, x: g.vb0.x - dx, y: g.vb0.y - dy });
    } else if (g.type === 'drag') {
      const p = toSvg(ev);
      if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) > 5) g.moved = true;
      if (g.moved) setDragDelta({ dx: p.x - g.p0.x, dy: p.y - g.p0.y, key: g.token.tokenKey });
    } else if (g.type === 'note') {
      const p = toSvg(ev);
      if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) > 5) g.moved = true;
      if (g.moved) setNoteDrag({ id: g.note.id, dx: p.x - g.p0.x, dy: p.y - g.p0.y });
    } else if (g.type === 'object') {
      // a drag starting on an icon just pans the map
      const dx = (ev.clientX - g.startClient[0]) * (g.vb0.w / size.w);
      const dy = (ev.clientY - g.startClient[1]) * (g.vb0.h / size.h);
      if (Math.hypot(ev.clientX - g.startClient[0], ev.clientY - g.startClient[1]) > 4) g.moved = true;
      if (g.moved) setVb({ ...g.vb0, x: g.vb0.x - dx, y: g.vb0.y - dy });
    } else if (g.type === 'erase') {
      const p = toSvg(ev);
      if (Math.hypot(p.x - g.last.x, p.y - g.last.y) > Math.max(3, paint.width / 3)) {
        g.points.push([p.x, p.y]);
        g.last = p;
        setPreview({ ...paint, points: [...g.points] });
      }
    } else if (g.type === 'paint') {
      const p = toSvg(ev);
      if (paint.tool === 'brush') {
        if (Math.hypot(p.x - g.last.x, p.y - g.last.y) > Math.max(3, paint.width / 3)) {
          g.points.push([p.x, p.y]);
          g.last = p;
          setPreview({ ...paint, points: [...g.points] });
        }
      } else {
        g.points = [g.points[0], [p.x, p.y]];
        setPreview({ ...paint, points: [...g.points] });
      }
    }
  }

  function onPointerUp(ev) {
    const g = gestureRef.current;
    gestureRef.current = null;
    setDragDelta(null);
    setNoteDrag(null);
    setPreview(null);
    if (!g) return;
    if (g.type === 'pan') {
      if (!g.moved && onCanvasClick) onCanvasClick(g.p0.x, g.p0.y);
      return;
    }
    if (g.type === 'note') {
      if (!g.moved) { onNoteToggle?.(g.note); return; }
      const p = toSvg(ev);
      onNoteMove?.(g.note, {
        box_dx: g.base.bx + (p.x - g.p0.x) - g.note.x,
        box_dy: g.base.by + (p.y - g.p0.y) - g.note.y,
      });
      return;
    }
    if (g.type === 'object') {
      if (!g.moved) onObjectClick?.(g.object);
      return;
    }
    if (g.type === 'drag') {
      if (!g.moved) { onTokenClick?.(g.token, g.shift); return; }
      if (!onTokensMove) return;
      const p = toSvg(ev);
      const dx = p.x - g.p0.x;
      const dy = p.y - g.p0.y;
      const group = selectedKeys?.has(g.token.tokenKey)
        ? tokens.filter((t) => selectedKeys.has(t.tokenKey))
        : [g.token];
      // the DRAGGED token goes first: its drop point is the group's anchor
      // (a door there carries the whole selection across)
      group.sort((a, b) => (b.tokenKey === g.token.tokenKey) - (a.tokenKey === g.token.tokenKey));
      onTokensMove(group.map((t) => ({ token: t, x: t.x + dx, y: t.y + dy })));
      return;
    }
    if (g.type === 'erase') {
      onErase?.(g.points, paint.width / 2); // a tap erases too: one point is enough
      return;
    }
    if (g.type === 'paint') {
      const pts = g.points;
      const long = pts.length > 1 &&
        Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) > 3;
      if (paint.tool === 'brush' ? pts.length >= 2 : long) {
        onStroke({
          kind: paint.kind, tool: paint.tool, points: pts, width: paint.width, color: paint.color,
        });
      }
    }
  }



  // --- the DM's ink -----------------------------------------------------------------
  // Plain coloured lines in map coordinates, so they sit on the art and travel
  // with it. Rects draw as outlines, everything else as a polyline.
  function renderInk(s, keyName) {
    const common = {
      fill: 'none', stroke: s.color || '#e4b343', strokeWidth: s.width,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    };
    if (s.tool === 'rect' && s.points.length >= 2) {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]];
      return <rect key={keyName} pointerEvents="none"
        x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])}
        width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} {...common} />;
    }
    const pts = s.tool === 'line' && s.points.length >= 2
      ? [s.points[0], s.points[s.points.length - 1]] : s.points;
    if (pts.length === 1) { // a dot: a zero-length line still marks the spot
      return <circle key={keyName} pointerEvents="none" cx={pts[0][0]} cy={pts[0][1]}
        r={s.width / 2} fill={s.color || '#e4b343'} />;
    }
    return <path key={keyName} pointerEvents="none"
      d={'M' + pts.map(([x, y]) => `${x},${y}`).join('L')} {...common} />;
  }

  // --- painted strokes ------------------------------------------------------------
  function renderStroke(s, keyName) {
    const st = STROKE_STYLE[s.kind] || STROKE_STYLE.wall;
    const parts = [];
    if (s.tool === 'rect' && s.points.length >= 2) {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]];
      parts.push(<rect key="r" x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])}
        width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])}
        fill="none" stroke={st.stroke} strokeOpacity={st.opacity}
        strokeWidth={s.width} strokeDasharray={st.dash} strokeLinejoin="round" />);
    } else {
      const d = 'M' + s.points.map(([x, y]) => `${x},${y}`).join('L');
      parts.push(<path key="p" d={d} fill="none" stroke={st.stroke} strokeOpacity={st.opacity}
        strokeWidth={s.width} strokeDasharray={st.dash} strokeLinecap="round" strokeLinejoin="round" />);
    }
    if (s.kind === 'cliff') {
      // arrows showing the allowed crossing direction
      const ticks = [];
      for (const [a, b] of strokeSegments(s)) {
        const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const n = cliffNormal(a, b, s.flipped);
        const steps = Math.max(1, Math.floor(segLen / 55));
        for (let i = 1; i <= steps; i++) {
          const t = i / (steps + 1);
          const mx = a.x + (b.x - a.x) * t;
          const my = a.y + (b.y - a.y) * t;
          const tipX = mx + n.x * s.width * 2.2;
          const tipY = my + n.y * s.width * 2.2;
          ticks.push(`M${mx},${my}L${tipX},${tipY}` +
            `M${tipX},${tipY}L${tipX - n.x * 6 + n.y * 5},${tipY - n.y * 6 - n.x * 5}` +
            `M${tipX},${tipY}L${tipX - n.x * 6 - n.y * 5},${tipY - n.y * 6 + n.x * 5}`);
        }
      }
      parts.push(<path key="t" d={ticks.join('')} fill="none" stroke={st.stroke}
        strokeOpacity={0.9} strokeWidth={2.5} />);
    }
    return <g key={keyName} pointerEvents="none">{parts}</g>;
  }

  // --- sizes ----------------------------------------------------------------------
  // Tokens are world-sized (TOKEN_METERS × ruler scale) but their clamps are
  // in SCREEN pixels tied to the current zoom: zoomed way out a token freezes
  // at TOKEN_MIN_SCREEN_PX on screen (always findable); zoomed way in it
  // freezes at a fraction of the viewport. Characters, NPCs and monsters all
  // pass through sizedToken, which keeps their per-entity size multiplier.
  const zoomK = vb ? size.w / vb.w : 1; // screen px per image px
  const worldToken = TOKEN_METERS * (map.scale || 20) * (map.token_scale || 1);
  const minTokenImg = TOKEN_MIN_SCREEN_PX / zoomK;
  const maxTokenImg = Math.max(minTokenImg, (Math.min(size.w, size.h) * TOKEN_MAX_VIEW_FRACTION) / zoomK);
  // A token is worldToken across on the map. At scale 1 it never shrinks below
  // the on-screen floor (always findable) nor grows past the cap (never swallows
  // the view). The per-entity size multiplier ALWAYS applies on top of that
  // floor, so a bigger monster/NPC is visibly bigger — and its name, a fraction
  // of the token, grows with it. Without this, on a small-scale map (where the
  // base token already sits at the floor) every size multiplier would collapse
  // to the same floored size and nothing — token or name — would scale.
  const sizedToken = (scale = 1) => Math.min(Math.max(worldToken, minTokenImg) * scale, maxTokenImg);
  const baseToken = sizedToken(1);
  // Map ICONS (doors, chests, shops) share the reference token's footprint and
  // scale with it, so they read as things standing on the map, not fixed HUD
  // marks. The editor's icon-size knob is a per-map fine-tune on top (1 = the
  // token size exactly).
  const iconS = baseToken * (map.icon_scale || 1);
  const labelFs = Math.max(baseToken * 0.3, map.image_w / 115); // objects, rings, doors
  // A token's NAME follows the size of that token — a doubled-size monster gets
  // a doubled-size name — with a screen-space floor so it stays readable.
  const labelForToken = (s) => Math.max(s * MAP_LABEL_OF_TOKEN, MAP_LABEL_MIN_SCREEN_PX / zoomK);
  // The door is a diamond (a square turned 45°); sizing its SIDE to iconS/√2
  // makes its overall footprint match the token square exactly.
  const doorSide = iconS / Math.SQRT2;

  return (
    <div className="map-wrap" ref={wrapRef}>
      {vb && (
        <svg
          ref={svgRef}
          className="mapcanvas"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          preserveAspectRatio="none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => hoverPt && setHoverPt(null)}
        >
          <defs>
            {/* wooden table beyond the map art */}
            <pattern id="wood" width="220" height="150" patternUnits="userSpaceOnUse">
              <rect width="220" height="150" fill="#332516" />
              <g stroke="#26190e" strokeWidth="3">
                <line x1="0" y1="0" x2="220" y2="0" /><line x1="0" y1="75" x2="220" y2="75" />
              </g>
              <g stroke="#3d2c1a" strokeWidth="1.4" opacity="0.8">
                <path d="M0,18 C60,14 160,24 220,18" fill="none" />
                <path d="M0,40 C70,44 150,34 220,42" fill="none" />
                <path d="M0,58 C50,60 170,52 220,60" fill="none" />
                <path d="M0,95 C60,90 160,100 220,94" fill="none" />
                <path d="M0,118 C70,122 150,112 220,120" fill="none" />
                <path d="M0,138 C50,140 170,132 220,140" fill="none" />
              </g>
              <g fill="#26190e" opacity="0.7">
                <ellipse cx="55" cy="30" rx="5" ry="9" /><ellipse cx="170" cy="110" rx="4" ry="8" />
              </g>
            </pattern>
          </defs>

          {/* the table, then the framed map art */}
          <rect x={vb.x - 10} y={vb.y - 10} width={vb.w + 20} height={vb.h + 20} fill="url(#wood)" />
          <rect x={-8} y={-8} width={map.image_w + 16} height={map.image_h + 16}
            fill="#0d0a06" stroke="#5a4426" strokeWidth={6} rx={4} />
          <rect width={map.image_w} height={map.image_h} fill="#221a12" />
          {rawVector && <image href={rawVector} width={map.image_w} height={map.image_h} />}
          {background && <image href={background} width={map.image_w} height={map.image_h} />}
          {tile && (
            <image href={tile.url} x={tile.x} y={tile.y} width={tile.w} height={tile.h}
              preserveAspectRatio="none" />
          )}

          {strokeLayer}
          {ink.map((s) => renderInk(s, `ink${s.id}`))}
          {preview && (preview.tool === 'eraser'
            // the rubber shows where it is about to bite
            ? (
              <g pointerEvents="none">
                <path d={'M' + preview.points.map(([x, y]) => `${x},${y}`).join('L')}
                  fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={preview.width}
                  strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={preview.points[preview.points.length - 1][0]}
                  cy={preview.points[preview.points.length - 1][1]} r={preview.width / 2}
                  fill="none" stroke="#fff" strokeWidth={Math.max(1, preview.width / 12)} />
              </g>
            )
            : preview.kind === 'ink'
              ? renderInk({ ...preview, id: 'preview' }, 'preview')
              : renderStroke({ ...preview, id: 'preview', flipped: 0 }, 'preview'))}

          {guide && guide.points.length > 0 && (() => {
            const col = (STROKE_STYLE[guide.kind] || STROKE_STYLE.wall).stroke;
            const r = Math.max(3, map.image_w / 320);
            const lw = Math.max(1.5, map.image_w / 520);
            const pts = guide.points;
            const solid = 'M' + pts.map(([x, y]) => `${x},${y}`).join('L');
            const rubber = hoverPt ? `M${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}L${hoverPt.x},${hoverPt.y}` : '';
            const closing = guide.close && pts.length >= 2
              ? `M${(hoverPt || { x: pts[pts.length - 1][0] }).x},${(hoverPt || { y: pts[pts.length - 1][1] }).y}L${pts[0][0]},${pts[0][1]}`
              : '';
            return (
              <g pointerEvents="none">
                {pts.length >= 2 && (
                  <path d={solid} fill="none" stroke={col} strokeWidth={lw * 2}
                    strokeOpacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
                )}
                {(rubber || closing) && (
                  <path d={rubber + closing} fill="none" stroke={col} strokeWidth={lw}
                    strokeOpacity={0.6} strokeDasharray={`${r} ${r}`} strokeLinecap="round" />
                )}
                {pts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={i === 0 ? r * 1.3 : r}
                    fill={i === 0 ? col : '#fff'} stroke={col} strokeWidth={lw} />
                ))}
              </g>
            );
          })()}

          {ruler && ruler.length > 0 && (() => {
            const col = '#7ff0e0'; // aqua: distinct from ink (gold) and sight (blue)
            const r = Math.max(3, map.image_w / 320);
            const lw = Math.max(1.5, map.image_w / 520);
            const scale = map.scale || 1;
            // the live chain includes the segment out to the cursor, so the total
            // updates as you move before committing the next point
            const chain = hoverPt ? [...ruler, [hoverPt.x, hoverPt.y]] : ruler;
            const fmt = (m) => `${m.toFixed(m < 100 ? 1 : 0)} m`;
            const legs = [];
            let total = 0;
            for (let i = 1; i < chain.length; i++) {
              const segM = Math.hypot(chain[i][0] - chain[i - 1][0], chain[i][1] - chain[i - 1][1]) / scale;
              total += segM;
              legs.push({ mx: (chain[i][0] + chain[i - 1][0]) / 2, my: (chain[i][1] + chain[i - 1][1]) / 2, m: segM });
            }
            const end = chain[chain.length - 1];
            return (
              <g pointerEvents="none">
                <path d={'M' + chain.map(([x, y]) => `${x},${y}`).join('L')} fill="none"
                  stroke={col} strokeWidth={lw * 2} strokeOpacity={0.9}
                  strokeDasharray={hoverPt ? `${r * 2} ${r}` : undefined}
                  strokeLinecap="round" strokeLinejoin="round" />
                {chain.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={i === 0 ? r * 1.3 : r}
                    fill={i === 0 ? col : '#fff'} stroke={col} strokeWidth={lw} />
                ))}
                {legs.length > 1 && legs.map((s, i) => (
                  <text key={i} x={s.mx} y={s.my - r * 1.6} textAnchor="middle" fontSize={labelFs}
                    fill={col} stroke="#000" strokeWidth={0.7} paintOrder="stroke">{fmt(s.m)}</text>
                ))}
                {chain.length >= 2 && (
                  <text x={end[0]} y={end[1] - r * 2.6} textAnchor="middle"
                    fontSize={labelFs * 1.4} fontWeight="700"
                    fill="#fff" stroke="#000" strokeWidth={1} paintOrder="stroke">{fmt(total)}</text>
                )}
              </g>
            );
          })()}

          {rings.map((ring, i) => (
            <g key={`ring${i}`} pointerEvents="none">
              <circle cx={ring.x} cy={ring.y} r={ring.radiusPx}
                fill={ring.fill || ring.color || '#e4b343'} fillOpacity={ring.fill ? 0.13 : 0.06}
                stroke={ring.color || '#e4b343'} strokeWidth={2.5} strokeDasharray="9 6" />
              {ring.label && (
                <text x={ring.x} y={ring.y - ring.radiusPx - 6} textAnchor="middle" fontSize={labelFs}
                  fill={ring.color || '#e4b343'} stroke="#000" strokeWidth={0.6} paintOrder="stroke">
                  {ring.label}
                </text>
              )}
            </g>
          ))}

          {objects.map((o) => {
            if (o.x == null) return null;
            if (o.kind === 'connection') {
              return (
                <g key={o.objKey} pointerEvents="none">
                  <rect x={-doorSide / 2} y={-doorSide / 2} width={doorSide} height={doorSide} rx={doorSide * 0.22}
                    transform={`translate(${o.x},${o.y}) rotate(45)`}
                    fill="#f3ead6" stroke="#1c150c" strokeWidth={Math.max(2, doorSide * 0.13)} />
                  {o.label && (
                    <text x={o.x} y={o.y + iconS * 0.62 + labelFs} textAnchor="middle" fontSize={labelFs}
                      fill="#f3ead6" stroke="#000" strokeWidth={0.7} paintOrder="stroke">{o.label}</text>
                  )}
                </g>
              );
            }
            // NPCs are creatures (world-sized tokens); chests/shops are icons.
            const isNpc = o.kind === 'npc';
            const s = isNpc ? sizedToken(o.scale || 1) : iconS;
            const fs = isNpc ? labelForToken(s) : labelFs; // an NPC's name follows its token
            const icon = o.icon
              || (o.kind === 'chest' ? '/uploads/chest-token/default'
                : o.kind === 'shop' ? '/uploads/shop-token/default'
                  : '/uploads/npc-token/default');
            // The parent flags which icons it wants to act on (a chest to loot);
            // everything else, and the read-only party view, stays inert.
            const clickable = onObjectClick && !paint && o.clickable;
            return (
              <g key={o.objKey} opacity={o.hidden ? 0.35 : o.opened ? 0.65 : 1}
                pointerEvents={clickable ? 'auto' : 'none'}
                style={clickable ? { cursor: 'pointer' } : undefined}
                onPointerDown={clickable ? (ev) => onObjectPointerDown(o, ev) : undefined}>
                <image href={icon} x={o.x - s / 2} y={o.y - s / 2} width={s} height={s}
                  preserveAspectRatio="xMidYMid meet" />
                {o.label && (
                  <text x={o.x} y={o.y + s * 0.62 + fs} textAnchor="middle" fontSize={fs}
                    fill="#f3ead6" stroke="#000" strokeWidth={0.7} paintOrder="stroke">{o.label}</text>
                )}
              </g>
            );
          })}

          {tokens.map((t) => {
            if (t.x == null) return null;
            const isDragged = dragDelta && (dragDelta.key === t.tokenKey ||
              (selectedKeys?.has(dragDelta.key) && selectedKeys?.has(t.tokenKey)));
            const tokenSize = sizedToken(t.scale || 1);
            return (
              <TokenNode
                key={t.tokenKey}
                t={t}
                size={tokenSize}
                labelFs={labelForToken(tokenSize)}
                selected={!!selectedKeys?.has(t.tokenKey)}
                dragDelta={isDragged ? dragDelta : null}
                onPointerDown={(ev) => onTokenPointerDown(t, ev)}
              />
            );
          })}

          {fogImage && (
            <image href={fogImage.url} x={0} y={0} width={fogImage.w} height={fogImage.h}
              preserveAspectRatio="none" pointerEvents="none" />
          )}

          {/* Kingdom/dungeon on the party TV: everything OUTSIDE the explored
              window is covered by table, so the party never sees the map's true
              size — only their growing square. (The DM passes no frameBox and
              sees the whole map.) */}
          {frameBox && (
            <>
              <path fillRule="evenodd" fill="url(#wood)" pointerEvents="none"
                d={`M${vb.x - 40},${vb.y - 40}h${vb.w + 80}v${vb.h + 80}h${-(vb.w + 80)}Z`
                  + `M${frameBox.x},${frameBox.y}h${frameBox.w}v${frameBox.h}h${-frameBox.w}Z`} />
              <rect x={frameBox.x} y={frameBox.y} width={frameBox.w} height={frameBox.h}
                fill="none" stroke="#5a4426" strokeWidth={Math.max(2, map.image_w / 400)}
                rx={map.image_w / 200} pointerEvents="none" />
            </>
          )}

          {/* DM-only sticky notes: a pin when folded, a parchment callout with
              a leader line to its anchor when open. Click to fold/unfold; DRAG
              the card anywhere — off the map art onto the table too — the line
              always points back to the pinned spot. */}
          {notes.map((n) => {
            const fs = Math.max(13, map.image_w / 110);
            if (!n.open) {
              return (
                <g key={`note${n.id}`} className="map-note-hit" transform={`translate(${n.x},${n.y})`}
                  onPointerDown={(ev) => ev.stopPropagation()} onClick={() => onNoteToggle?.(n)}>
                  <circle r={fs * 0.8} fill="#e4c76b" stroke="#3c2c14" strokeWidth={fs * 0.12} />
                  <circle r={fs * 0.22} fill="#3c2c14" />
                </g>
              );
            }
            const w = Math.min(map.image_w * 0.34, fs * 19);
            const lines = Math.max(1, Math.min(8, Math.ceil((n.text || ' ').length / 26)));
            const h = fs * (1.6 + lines * 1.45);
            let bx, by;
            if (n.box_dx != null && n.box_dy != null) {
              // wherever the DM parked it, no clamping — even beyond the art
              bx = n.x + n.box_dx;
              by = n.y + n.box_dy;
            } else {
              bx = Math.max(4, Math.min(map.image_w - w - 4,
                n.x + (n.x > map.image_w / 2 ? -(w + fs * 3) : fs * 3)));
              by = Math.max(4, Math.min(map.image_h - h - 4,
                n.y + (n.y > map.image_h / 2 ? -(h + fs * 2.2) : fs * 2.2)));
            }
            const drag = noteDrag?.id === n.id ? noteDrag : null;
            const dx = bx + (drag ? drag.dx : 0);
            const dy = by + (drag ? drag.dy : 0);
            return (
              <g key={`note${n.id}`} className="map-note-hit"
                onPointerDown={(ev) => onNotePointerDown(n, { bx, by }, ev)}>
                <line x1={n.x} y1={n.y} x2={dx + w / 2} y2={dy + h / 2}
                  stroke="#e4c76b" strokeWidth={Math.max(1.5, fs * 0.12)} strokeDasharray="5 4" />
                <circle cx={n.x} cy={n.y} r={fs * 0.4} fill="#e4c76b" stroke="#3c2c14" strokeWidth={1.5} />
                <foreignObject x={dx} y={dy} width={w} height={h}>
                  <div className="map-note" style={{ fontSize: fs }}>{n.text}</div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      )}
      <div className="zoom-controls">
        <button onClick={() => zoomBy(1.35)}>+</button>
        <button onClick={() => zoomBy(1 / 1.35)}>−</button>
        <button onClick={fitView}>fit</button>
      </div>
    </div>
  );
}


// One token. When `animate` is set (TV view) the token WALKS its server-computed
// path (around walls) at a steady pace; teleports and drags just snap.
function TokenNode({ t, size, labelFs, selected, dragDelta, onPointerDown }) {
  const pos = useWalkPosition(t);
  const x = pos.x + (dragDelta ? dragDelta.dx : 0);
  const y = pos.y + (dragDelta ? dragDelta.dy : 0);
  const s = size;
  const clip = t.shape === 'circle' ? `circle(${s / 2}px at ${s / 2}px ${s / 2}px)`
    : t.shape === 'square' ? `inset(0 round ${s * 0.12}px)` : null;
  return (
    <g
      style={{ transform: `translate(${x}px, ${y}px)` }}
      className={t.draggable ? 'token draggable' : 'token'}
      onPointerDown={onPointerDown}
    >
      {selected && (
        <circle r={s * 0.62} fill="none" stroke="#ffe9b0" strokeWidth={3} strokeDasharray="6 5" />
      )}
      {t.icon ? (
        <image href={t.icon} x={-s / 2} y={-s / 2} width={s} height={s}
          preserveAspectRatio={clip ? 'xMidYMid slice' : 'xMidYMid meet'}
          style={clip ? { clipPath: clip } : undefined} />
      ) : (
        <>
          <circle r={s / 2} fill={t.color || '#888'} fillOpacity={0.92} />
          <text y={s * 0.18} textAnchor="middle" fontSize={s * 0.52}
            fill="#fff" fontWeight="700" pointerEvents="none">
            {(t.label || '?')[0]}
          </text>
        </>
      )}
      {t.label && (
        <text y={s / 2 + labelFs} textAnchor="middle" fontSize={labelFs}
          fill="#fff" stroke="#000" strokeWidth={0.7} paintOrder="stroke" pointerEvents="none">
          {t.label}
        </text>
      )}
      {t.sub && (
        <text y={s / 2 + labelFs * 2.1} textAnchor="middle" fontSize={labelFs * 0.85}
          fill="#ffd27f" stroke="#000" strokeWidth={0.6} paintOrder="stroke" pointerEvents="none">
          {t.sub}
        </text>
      )}
    </g>
  );
}

function useWalkPosition(t) {
  const [pos, setPos] = useState({ x: t.x, y: t.y });
  const rafRef = useRef();
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const target = { x: t.x, y: t.y };
    if (!t.animate) { setPos(target); return undefined; }
    const pts = (t.path && t.path.length >= 2)
      ? t.path.map(([px, py]) => ({ x: px, y: py }))
      : [pos, target]; // eslint-disable-line react-hooks/exhaustive-deps
    if (Math.hypot(pts[pts.length - 1].x - target.x, pts[pts.length - 1].y - target.y) > 2) {
      pts.push(target); // stale path: still end where the server says
    }
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (d > 0) { segs.push({ a: pts[i - 1], b: pts[i], d }); total += d; }
    }
    if (total < 2) { setPos(target); return undefined; }
    // ~walking pace, unless a slower kingdom-journey duration is supplied
    const dur = t.walkMs != null ? t.walkMs : Math.min(2600, Math.max(450, total * 2.2));
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      let dist = k * total;
      let p = target;
      for (const seg of segs) {
        if (dist <= seg.d) {
          p = { x: seg.a.x + (seg.b.x - seg.a.x) * (dist / seg.d),
            y: seg.a.y + (seg.b.y - seg.a.y) * (dist / seg.d) };
          break;
        }
        dist -= seg.d;
      }
      setPos(k < 1 ? p : target);
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [t.x, t.y, t.animate]); // eslint-disable-line react-hooks/exhaustive-deps
  return pos;
}
