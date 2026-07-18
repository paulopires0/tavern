import React, { useRef, useState } from 'react';

// Crop-on-upload for tokens and artwork: pick a file, then choose WHICH PART
// of the image is used — drag the square around, size it with the slider,
// confirm. Crops to a PNG of just the selection ("Use whole image" skips the
// crop). `round` previews the circular token mask while choosing.
export function CropInput({ label, onFile, round = false }) {
  const [src, setSrc] = useState(null); // {url, w, h, file}
  const inputRef = useRef(null);

  function reset() {
    if (src) URL.revokeObjectURL(src.url);
    setSrc(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <label className="field"><span>{label}</span>
        <input ref={inputRef} type="file" accept="image/*" onChange={(e) => {
          const f = e.target.files[0];
          if (!f) return;
          const url = URL.createObjectURL(f);
          const img = new Image();
          img.onload = () => setSrc({ url, w: img.naturalWidth, h: img.naturalHeight, file: f });
          img.onerror = () => { URL.revokeObjectURL(url); };
          img.src = url;
        }} />
      </label>
      {src && (
        <CropDialog
          src={src}
          round={round}
          onCancel={reset}
          onDone={async (file) => { const out = file; reset(); await onFile(out); }}
        />
      )}
    </>
  );
}

function CropDialog({ src, round, onCancel, onDone }) {
  const boxW = Math.min(620, window.innerWidth * 0.82);
  const boxH = Math.min(480, window.innerHeight * 0.55);
  const k = Math.min(boxW / src.w, boxH / src.h, 1); // display px per natural px
  const dw = src.w * k;
  const dh = src.h * k;
  const maxSel = Math.min(dw, dh);
  const [sel, setSel] = useState({ x: (dw - maxSel) / 2, y: (dh - maxSel) / 2, s: maxSel });
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  const clampSel = (x, y, s) => ({
    s,
    x: Math.max(0, Math.min(dw - s, x)),
    y: Math.max(0, Math.min(dh - s, y)),
  });

  function stagePoint(ev) {
    const r = stageRef.current.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function onPointerDown(ev) {
    const p = stagePoint(ev);
    const inside = p.x >= sel.x && p.x <= sel.x + sel.s && p.y >= sel.y && p.y <= sel.y + sel.s;
    // grab the square where it is, or jump it to wherever you pressed
    const start = inside ? sel : clampSel(p.x - sel.s / 2, p.y - sel.s / 2, sel.s);
    if (!inside) setSel(start);
    dragRef.current = { p0: p, x0: start.x, y0: start.y };
    stageRef.current.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev) {
    const d = dragRef.current;
    if (!d) return;
    const p = stagePoint(ev);
    setSel((s) => clampSel(d.x0 + (p.x - d.p0.x), d.y0 + (p.y - d.p0.y), s.s));
  }

  async function confirm() {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src.url;
    });
    const ns = sel.s / k; // selection in natural px
    const out = Math.min(Math.round(ns), 1024);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    canvas.getContext('2d').drawImage(img, sel.x / k, sel.y / k, ns, ns, 0, 0, out, out);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return onDone(src.file);
    const base = src.file.name.replace(/\.[a-z0-9]+$/i, '');
    onDone(new File([blob], `${base}-crop.png`, { type: 'image/png' }));
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog crop-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h3>Choose the part to use</h3>
          <button className="ghost" onClick={onCancel}>✕</button>
        </header>
        <div
          ref={stageRef}
          className="crop-stage"
          style={{ width: dw, height: dh }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => { dragRef.current = null; }}
        >
          <img src={src.url} alt="" width={dw} height={dh} draggable={false} />
          <div
            className={`crop-sel ${round ? 'round' : ''}`}
            style={{ left: sel.x, top: sel.y, width: sel.s, height: sel.s }}
          />
        </div>
        <label className="field">
          <span>Selection size</span>
          <input type="range" min={Math.min(40, maxSel)} max={maxSel} step="1" value={sel.s}
            onChange={(e) => {
              const s = Number(e.target.value);
              setSel((old) => clampSel(old.x + (old.s - s) / 2, old.y + (old.s - s) / 2, s));
            }} />
        </label>
        <div className="row">
          <button onClick={confirm}>Use this part</button>
          <button className="ghost" onClick={() => onDone(src.file)}>Use whole image</button>
          <span className="spacer" />
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
