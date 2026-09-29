/* =====================================================================
 GLIB 2.8 (portable, ES module port for JANOS) — indexed-colour raster console library
 Ported from the MAGI kit (kit/glib.js). Same code and behaviour, with these changes:
   · ES module: `import { GLIB } from "../magi/glib"` (also the default export). No window.GLIB.
   · FAM.jp falls back to Latin serifs: it only ever renders ENGLISH display words here.
   · ROLE gains three phone roles with legibility floors (CSS px): lab (mono micro labels, ≥10),
     val (mono data values, ≥13) and hd (condensed 700 headline labels, ≥13).
   · T()/TD()/tw() accept o.size (design units) to override the role size (the role floor still applies).
   · FB.destroy(): removes canvases + hit buttons, drops the FB from GL.fbs, disconnects the
     ResizeObserver made by autoLayout(), and zeroes the canvas backing stores (iOS memory).
   · FB canvases get their essential positioning inline (so they work before base.css loads).
   · New primitives: clearTextCache(), blinkState(f), arrow(fb, x, y, s, dir, c) (pixel-authored ▲▼◀▶),
     gauge(fb, x, y, w, h, n, lit, on, base) (10-cell plate gauge: lit solid, unlit = baseline + 25 % dither).

 Two planes per instrument panel:
   lo  raster plane: an index buffer (1 byte per pixel = palette index),
       scaled up nearest-neighbour by an integer number of device pixels.
       Fills, 1–3 px rules, Bresenham lines, scanline polygons, Bayer dither.
   hi  device-resolution plane: ALL text, set in real typefaces (never pixelated).
   hits real <button> elements over the raster (keyboard + screen reader).
 Design space: every panel is drawn in a design space (default 960 × 540) and letterboxed.
 ===================================================================== */
const root = window;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const REDUCED = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------- master palette: the single source of colour ---------- */
const PAL = [
  ['k', '#000000'],    // 0  background black
  ['ink', '#100a04'],  // 1  inactive black (unlit cells)
  ['or', '#ff8000'],   // 2  frame orange
  ['orb', '#ffa31f'],  // 3  bright orange
  ['am', '#ffb800'],   // 4  amber
  ['yel', '#ffe000'],  // 5  warning yellow
  ['grn', '#3ce07a'],  // 6  approval green
  ['red', '#ff2000'],  // 7  rejection red
  ['wht', '#f2eee2'],  // 8  off-white
  ['gry', '#8a877c'],  // 9  neutral gray
  ['dgy', '#34322c'],  // 10 dark gray
  ['dim', '#4d2600'],  // 11 unlit orange
  ['dim2', '#241200'], // 12 deep unlit orange
  ['blu', '#8cc8f0'],  // 13 node blue
  ['cya', '#30b8e0'],  // 14 meter mid band
  ['dbl', '#2f6be0'],  // 15 meter high band
  ['tea', '#00c8b4'],  // 16 heat-field cold band
  ['dred', '#2a0600'], // 17 unlit red
  ['dgrn', '#0c3a1e'], // 18 unlit green
  ['dcya', '#0a3040'], // 19 unlit cyan
  ['dblu', '#0c1c44'], // 20 unlit blue
  ['bdim', '#1c3848'], // 21 unlit node blue
  /* severity ramp (JANOS body map): hard cel bands, never blended; the top band is 'red' (7) */
  ['r1', '#4a0c02'],   // 22 severity 1 LOW
  ['r2', '#7a1204'],   // 23 severity 2 MOD
  ['r3', '#b51906'],   // 24 severity 3 HIGH
];
const C = {}; PAL.forEach(([n], i) => { C[n] = i; });
const HEX = PAL.map(p => p[1]);
const PAL32 = new Uint32Array(PAL.map(([, h]) => { const v = parseInt(h.slice(1), 16); return (0xff000000 | (v & 255) << 16 | (v >> 8 & 255) << 8 | v >> 16) >>> 0; }));
function paletteToCSS() { const s = document.documentElement.style; for (const [n, h] of PAL) s.setProperty('--' + n, h); }
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bay = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + .5) / 16;

/* ---------- type roles (hi plane) ---------- */
const FAM = {
  gro: '"Arimo","Liberation Sans","Helvetica Neue",Helvetica,Arial,sans-serif',
  nar: '"Roboto Condensed","Arial Narrow","Helvetica Neue","DejaVu Sans Condensed","Liberation Sans Narrow","Arimo",sans-serif',
  mono: '"Share Tech Mono","IBM Plex Mono","DejaVu Sans Mono",Menlo,Consolas,monospace',
  jp: '"Noto Serif","Noto Serif JP","DejaVu Serif",Georgia,serif',   // English display words only (owner decision: no kanji)
};
const ROLE = {
  rom: { fam: 'nar', w: 700, size: 19, min: 10, sq: 1 },     // system labels
  big: { fam: 'nar', w: 700, size: 30, min: 13, sq: 1 },     // prominent readouts
  data: { fam: 'mono', w: 400, size: 15, min: 9, sq: 1 },    // axes, counters, info rows
  micro: { fam: 'mono', w: 400, size: 11.5, min: 8, sq: 1 }, // revision labels, units
  /* phone roles (JANOS): sizes in design units, floors (min) in CSS px keep them legible on a 393 px screen */
  lab: { fam: 'mono', w: 400, size: 14, min: 10, sq: 1 },    // micro labels, axes, revision labels
  val: { fam: 'mono', w: 400, size: 18, min: 13, sq: 1 },    // data values in mono
  hd: { fam: 'nar', w: 700, size: 22, min: 13, sq: 1 },      // prominent condensed labels / values
};
const romSafe = s => String(s ?? '').toUpperCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const GCACHE = new Map();
/* drop cached text runs (call after web fonts finish loading, then redraw) */
function clearTextCache() { GCACHE.clear(); }
function gcache(key, make) { let v = GCACHE.get(key); if (!v) { if (GCACHE.size > 1200) GCACHE.clear(); v = make(); GCACHE.set(key, v); } return v; }
const MCTX = document.createElement('canvas').getContext('2d');
function measureTxt(str, fam, weight, px) { MCTX.font = `${weight} ${px}px ${FAM[fam] || fam}`; return MCTX.measureText(str).width; }
/* one run of text, drawn once at device resolution; squeezed (never below 70 %) and then clipped to maxW */
function textRun(str, fam, weight, px, sq, maxW, color) {
  return gcache(`T${fam}${weight}|${px}|${sq}|${maxW || 0}|${color}|${str}`, () => {
    const font = `${weight} ${px}px ${FAM[fam] || fam}`; MCTX.font = font;
    let s = str, m = MCTX.measureText(s), k = sq, w = m.width * k;
    if (maxW && w > maxW) {
      while (s.length > 1 && MCTX.measureText(s).width * sq * .7 > maxW) s = s.slice(0, -1);
      m = MCTX.measureText(s); k = Math.min(sq, maxW / m.width); w = m.width * k;
    }
    const asc = Math.ceil(Math.max(m.actualBoundingBoxAscent || 0, px * .78)), desc = Math.ceil(Math.max(m.actualBoundingBoxDescent || 0, px * .22));
    const pad = 2, cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(w) + pad * 2); cv.height = Math.max(1, asc + desc + pad * 2);
    const x = cv.getContext('2d'); x.font = font; x.textBaseline = 'alphabetic'; x.fillStyle = HEX[color];
    x.setTransform(k, 0, 0, 1, pad, 0); x.fillText(s, 0, asc + pad);
    return { cv, base: asc + pad, pad, adv: Math.ceil(w) };
  });
}

/* ---------- the framebuffer ---------- */
const GL = { fbs: [], dens: 1.25 };
const DENSITY = { coarse: 1, medium: 1.25, fine: 1.8 };   // raster density multiplier on framebuffer rows
class FB {
  /* host: positioned element to fill. o.rows: target framebuffer height in pixels (sets pixel size).
     o.native: no 960x540 design space (1 design unit = 1 framebuffer pixel). o.devPx: force pixel size. */
  constructor(host, o = {}) {
    this.host = host; this.o = Object.assign({ rows: 180, dw: 960, dh: 540 }, o);
    this.lo = document.createElement('canvas'); this.lo.className = 'mg-fb lo';
    this.hi = document.createElement('canvas'); this.hi.className = 'mg-fb hi';
    this.hits = document.createElement('div'); this.hits.className = 'mg-hits';
    for (const el of [this.lo, this.hi, this.hits]) Object.assign(el.style, { position: 'absolute', left: '0', top: '0' });
    this.lo.style.imageRendering = 'pixelated'; this.hi.style.pointerEvents = 'none'; this.hits.style.pointerEvents = 'none';
    host.append(this.lo, this.hi, this.hits);
    this.lctx = this.lo.getContext('2d'); this.hctx = this.hi.getContext('2d');
    this.W = 0; this.H = 0; this.hitList = new Map(); this.focus = null;
    if (!o.solo) GL.fbs.push(this);
  }
  /* call on resize; returns true when the geometry changed (then redraw everything) */
  layout() {
    if (this.destroyed) return false;
    const r = this.host.getBoundingClientRect(), dpr = root.devicePixelRatio || 1;
    if (r.width < 8 || r.height < 8) return false;
    const cwD = Math.floor(r.width * dpr), chD = Math.floor(r.height * dpr);
    const devPx = this.o.devPx || clamp(Math.round(chD / (this.o.rows * GL.dens)), 1, 16);
    this.devRef = clamp(Math.round(chD / this.o.rows), 1, 16);
    const W = Math.floor(cwD / devPx), H = Math.floor(chD / devPx);
    if (W === this.W && H === this.H && devPx === this.devPx && dpr === this.dpr) return false;
    Object.assign(this, { W, H, devPx, dpr });
    if (this.o.native) { this.k = 1; this.ox = 0; this.oy = 0; }
    else { const k = this.k = Math.min(W / this.o.dw, H / this.o.dh); this.ox = Math.floor((W - this.o.dw * k) / 2); this.oy = Math.floor((H - this.o.dh * k) / 2); }
    this.dx = this.o.dx || 0; this.dy = this.o.dy || 0;
    this.kh = this.k * devPx; this.oxh = this.ox * devPx; this.oyh = this.oy * devPx;
    this.lo.width = W; this.lo.height = H; this.hi.width = W * devPx; this.hi.height = H * devPx;
    const cssW = W * devPx / dpr + 'px', cssH = H * devPx / dpr + 'px';
    for (const el of [this.lo, this.hi, this.hits]) { el.style.width = cssW; el.style.height = cssH; }
    this.hctx.imageSmoothingEnabled = false; this.lctx.imageSmoothingEnabled = false;
    this.buf = new Uint8Array(W * H); this.bg = new Uint8Array(W * H);
    this.img = this.lctx.createImageData(W, H); this.u32 = new Uint32Array(this.img.data.buffer);
    this.noClip();
    for (const h of this.hitList.values()) this.placeHit(h);
    return true;
  }
  /* design space → framebuffer pixels */
  X(x) { return this.ox + Math.round((x - this.dx) * this.k); }
  Y(y) { return this.oy + Math.round((y - this.dy) * this.k); }
  L(v) { return Math.max(1, Math.round(v * this.k)); }
  /* design space → hi plane device pixels */
  hx(x) { return this.oxh + Math.round((x - this.dx) * this.kh); }
  hy(y) { return this.oyh + Math.round((y - this.dy) * this.kh); }
  /* ----- lo plane primitives (framebuffer pixel coordinates) ----- */
  noClip() { this.cx0 = 0; this.cy0 = 0; this.cx1 = this.W; this.cy1 = this.H; }
  clip(x0, y0, x1, y1) { this.cx0 = Math.max(0, x0); this.cy0 = Math.max(0, y0); this.cx1 = Math.min(this.W, x1); this.cy1 = Math.min(this.H, y1); }
  cls(c = C.k) { this.buf.fill(c); }
  saveBg() { this.bg.set(this.buf); }
  restore() { this.buf.set(this.bg); }
  p(x, y, c) { if (x >= this.cx0 && y >= this.cy0 && x < this.cx1 && y < this.cy1) this.buf[y * this.W + x] = c; }
  fill(x, y, w, h, c) {
    const x0 = Math.max(this.cx0, x | 0), x1 = Math.min(this.cx1, (x + w) | 0), y0 = Math.max(this.cy0, y | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    if (x1 <= x0) return; for (let yy = y0; yy < y1; yy++) this.buf.fill(c, yy * this.W + x0, yy * this.W + x1);
  }
  frame(x, y, w, h, c, t = 1) { this.fill(x, y, w, t, c); this.fill(x, y + h - t, w, t, c); this.fill(x, y + t, t, h - 2 * t, c); this.fill(x + w - t, y + t, t, h - 2 * t, c); }
  /* Bresenham line; pat = on/off bit pattern (LSB first) of length plen for dotted rules; t = square brush */
  line(x0, y0, x1, y1, c, t = 1, pat = 0, plen = 0) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy, n = 0;
    const o = -((t - 1) >> 1);
    for (;;) {
      if (!plen || (pat >> (n % plen) & 1)) { if (t === 1) this.p(x0, y0, c); else this.fill(x0 + o, y0 + o, t, t, c); }
      n++; if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  /* scanline even-odd polygon fill; pts in framebuffer coords; c = palette index or fn(x, y) → index */
  poly(pts, c) {
    let yMin = Infinity, yMax = -Infinity; for (const [, y] of pts) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
    const y0 = Math.max(this.cy0, Math.floor(yMin)), y1 = Math.min(this.cy1 - 1, Math.ceil(yMax));
    const xs = [], n = pts.length, fn = typeof c === 'function';
    for (let y = y0; y <= y1; y++) {
      const sy = y + .5; xs.length = 0;
      for (let i = 0; i < n; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n]; if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + (sy - ay) / (by - ay) * (bx - ax)); }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(this.cx0, Math.ceil(xs[i] - .5)), xb = Math.min(this.cx1 - 1, Math.floor(xs[i + 1] - .5));
        if (fn) for (let x = xa; x <= xb; x++) this.buf[y * this.W + x] = c(x, y); else if (xb >= xa) this.buf.fill(c, y * this.W + xa, y * this.W + xb + 1);
      }
    }
  }
  /* ordered dither: only across band edges and for "unlit / hollow" textures, never as shading */
  dither(x, y, w, h, c, level) { for (let yy = Math.max(this.cy0, y); yy < Math.min(this.cy1, y + h); yy++) for (let xx = Math.max(this.cx0, x); xx < Math.min(this.cx1, x + w); xx++) if (bay(xx, yy) < level) this.buf[yy * this.W + xx] = c; }
  /* design-space conveniences */
  R(x, y, w, h, c) { const x0 = this.X(x), y0 = this.Y(y); this.fill(x0, y0, this.X(x + w) - x0, this.Y(y + h) - y0, c); }
  F(x, y, w, h, c, t = 1) { const x0 = this.X(x), y0 = this.Y(y); this.frame(x0, y0, this.X(x + w) - x0, this.Y(y + h) - y0, c, t); }
  P(pts, c) { this.poly(pts.map(([x, y]) => [this.ox + (x - this.dx) * this.k, this.oy + (y - this.dy) * this.k]), c); }
  Ln(x0, y0, x1, y1, c, t = 1, pat = 0, plen = 0) { this.line(this.X(x0), this.Y(y0), this.X(x1), this.Y(y1), c, t, pat, plen); }
  /* n pixels at the coarse reference density: markers, LEDs and dots keep their physical size at any density */
  s(n) { return Math.max(1, Math.round(n * (this.devRef || this.devPx) / this.devPx)); }
  present() { if (!this.buf) return; const u = this.u32, b = this.buf; for (let i = 0; i < b.length; i++) u[i] = PAL32[b[i]]; this.lctx.putImageData(this.img, 0, 0); }
  /* ----- hi plane: text ----- */
  hclear() { this.hctx.clearRect(0, 0, this.hi.width, this.hi.height); }
  rpx(role, size) { return Math.max(Math.round(role.min * this.dpr), Math.round((size ?? role.size) * this.kh)); }
  role(o) { return ROLE[o.big ? 'big' : o.font || 'rom'] || ROLE.rom; }
  tw(str, font = 'rom', size) { const r = ROLE[font] || ROLE.rom; return measureTxt(romSafe(str), r.fam, r.w, this.rpx(r, size)) * r.sq / this.kh; }
  TD(str, hxD, hyD, c, o = {}) {
    const r = this.role(o), s = romSafe(str); if (!s) return 0;
    const run = textRun(s, r.fam, r.w, this.rpx(r, o.size), r.sq, o.maxD ? Math.floor(o.maxD) : 0, c);
    let x = hxD - run.pad; if (o.align === 'c') x -= run.adv >> 1; else if (o.align === 'r') x -= run.adv;
    if (o.bg != null) { this.hctx.fillStyle = HEX[o.bg]; this.hctx.fillRect(x, hyD - run.base, run.cv.width, run.cv.height); }
    this.hctx.drawImage(run.cv, x, hyD - run.base); return run.adv;
  }
  /* uppercase label text at design coords (y = baseline); o.font: rom|data|micro|lab|val|hd, o.big, o.align l|c|r, o.maxW, o.size (design units) */
  T(str, x, y, c, o = {}) { return this.TD(str, this.hx(x), this.hy(y), c, Object.assign({}, o, { maxD: o.maxW ? o.maxW * this.kh : 0 })) / this.kh; }
  /* first role that fits: label, then analytical, then metadata squeezed as a last resort */
  fitT(str, x, y, c, maxW, o = {}) {
    for (const font of ['rom', 'data']) if (this.tw(str, font) <= maxW) return this.T(str, x, y, c, Object.assign({}, o, { font }));
    return this.T(str, x, y, c, Object.assign({}, o, { font: 'micro', maxW }));
  }
  /* display type: big Japanese (default, heavy Mincho squeezed .8) or o.fam:'gro' squeezed grotesque titles */
  J(str, x, y, c, o = {}) {
    const fam = o.fam || 'jp', px = Math.max(8, Math.round((o.size || 40) * this.kh)), sq = o.sq ?? .8;
    const run = textRun(str, fam, o.weight || (fam === 'jp' ? 900 : 700), px, sq, o.maxW ? Math.floor(o.maxW * this.kh) : 0, c);
    let x0 = this.hx(x) - run.pad; if (o.align === 'c') x0 -= run.adv >> 1; else if (o.align === 'r') x0 -= run.adv;
    this.hctx.drawImage(run.cv, x0, this.hy(y) - run.base); return run.adv / this.kh;
  }
  /* ----- hit areas: invisible real buttons over the raster; draw their focus yourself (white frame) ----- */
  hit(id, x, y, w, h, label, fn, o = {}) {
    let hb = this.hitList.get(id);
    if (!hb) {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'mg-hit'; el.id = id;
      el.addEventListener('click', e => fn(e));
      el.addEventListener('focus', () => { this.focus = id; if (this.onFocus) this.onFocus(); });
      el.addEventListener('blur', () => { if (this.focus === id) this.focus = null; if (this.onFocus) this.onFocus(); });
      this.hits.appendChild(el); hb = { el }; this.hitList.set(id, hb);
    }
    Object.assign(hb, { x, y, w, h }); hb.el.setAttribute('aria-label', label); if (o.pressed != null) hb.el.setAttribute('aria-pressed', o.pressed);
    this.placeHit(hb); return hb.el;
  }
  placeHit(hb) {
    if (!this.W) return; const f = this.devPx / this.dpr;
    const x0 = this.X(hb.x), y0 = this.Y(hb.y);
    Object.assign(hb.el.style, { left: x0 * f + 'px', top: y0 * f + 'px', width: (this.X(hb.x + hb.w) - x0) * f + 'px', height: (this.Y(hb.y + hb.h) - y0) * f + 'px' });
  }
  /* tear down: canvases, hit buttons, GL.fbs entry and the autoLayout observer; safe to call twice */
  destroy() {
    if (this.destroyed) return; this.destroyed = true;
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    for (const hb of this.hitList.values()) hb.el.remove();
    this.hitList.clear(); this.onFocus = null; this.focus = null;
    this.lo.width = this.lo.height = 0; this.hi.width = this.hi.height = 0;   // release backing stores now (iOS caps total canvas memory)
    this.lo.remove(); this.hi.remove(); this.hits.remove();
    const i = GL.fbs.indexOf(this); if (i >= 0) GL.fbs.splice(i, 1);
    this.buf = this.bg = this.img = this.u32 = null; this.W = this.H = 0;
  }
  toDesign(cx, cy) { const r = this.lo.getBoundingClientRect(); const fx = (cx - r.left) * this.dpr / this.devPx, fy = (cy - r.top) * this.dpr / this.devPx; return [(fx - this.ox) / this.k + this.dx, (fy - this.oy) / this.k + this.dy, fx, fy]; }
}

/* ---------- recipes ---------- */
/* 7-segment digit as rasterized polygons; unlit segments stay visible in the "off" colour */
const SEGMAP = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
function segPolys(x, y, w, h, t) {
  const g = 1, a = t / 2, m = y + h / 2;
  const hz = (x0, x1, yy) => [[x0, yy], [x0 + a, yy - a], [x1 - a, yy - a], [x1, yy], [x1 - a, yy + a], [x0 + a, yy + a]];
  const vt = (xx, y0, y1) => [[xx, y0], [xx + a, y0 + a], [xx + a, y1 - a], [xx, y1], [xx - a, y1 - a], [xx - a, y0 + a]];
  return { a: hz(x + a + g, x + w - a - g, y + a), b: vt(x + w - a, y + a + g, m - g), c: vt(x + w - a, m + g, y + h - a - g), d: hz(x + a + g, x + w - a - g, y + h - a),
    e: vt(x + a, m + g, y + h - a - g), f: vt(x + a, y + a + g, m - g), g: hz(x + a + g, x + w - a - g, m) };
}
function drawDigit(fb, ch, x, y, w, h, t, on, off) {   // x, y, w, h, t in framebuffer pixels
  const segs = segPolys(x, y, w, h, t), lit = SEGMAP[ch] ?? '';
  for (const k in segs) fb.poly(segs[k], lit.includes(k) ? on : off);
}
/* a row of 7-seg digits in design units; ':' and '.' become square dots */
function readout7(fb, str, x, y, dw, dh, gap, on = C.am, off = C.dim) {
  let cx = x; const t = Math.max(2, fb.L(dw * .21));
  for (const ch of String(str)) {
    if (ch === ':') { const d = Math.max(2, dw * .2); fb.R(cx + gap * .2, y + dh * .26, d, d, on); fb.R(cx + gap * .2, y + dh * .66, d, d, on); cx += d + gap * .6; continue; }
    if (ch === '.') { const d = Math.max(2, dw * .16); fb.R(cx, y + dh - d, d, d, on); cx += d + gap * .5; continue; }
    drawDigit(fb, ch, fb.X(cx), fb.Y(y), fb.L(dw), fb.L(dh), t, on, off); cx += dw + gap;
  }
  return cx;
}
/* hard colour bands along a skewed axis (cel-paint "heat field"); Bayer dither only across each band edge */
function bandFn(fb, x0, y0, w, h, cols = [C.red, C.or, C.am, C.yel, C.grn, C.tea], stops = [.2, .38, .55, .71, .86], skew = .35) {
  const dz = 2.2 / (w * fb.k);
  return (x, y) => {
    const u = ((x + .5 - fb.ox) / fb.k - x0) / w, v = ((y + .5 - fb.oy) / fb.k - y0) / h;
    const t = (u - (v - .35) * skew) / (1 + skew * .35);
    let i = 0; while (i < stops.length && t >= stops[i] + dz) i++;
    if (i < stops.length && t > stops[i] - dz) return (t - stops[i] + dz) / (2 * dz) > bay(x, y) ? cols[i + 1] : cols[i];
    return cols[i];
  };
}
/* addressable-cell meter: n cells, 3 hard colour bands, hollow unlit cells, optional peak-hold frame. Design units. */
function segMeter(fb, x, y, w, h, n, lit, o = {}) {
  const x0 = fb.X(x), x1 = fb.X(x + w), y0 = fb.Y(y), ch = fb.Y(y + h) - y0, pitch = Math.max(3, Math.floor((x1 - x0) / n)), cw = pitch - 1;
  const band = o.band || (i => { const t = i / n; return t < 1 / 3 ? C.grn : t < 2 / 3 ? C.cya : C.dbl; });
  for (let i = 0; i < n; i++) { const cx = x0 + i * pitch; if (i < lit) fb.fill(cx, y0, cw, ch, o.color ?? band(i)); else { fb.fill(cx, y0, cw, ch, C.ink); fb.frame(cx, y0, cw, ch, C.dgy, 1); } }
  if (o.peak > lit && o.peak <= n) fb.frame(x0 + (o.peak - 1) * pitch, y0, cw, ch, C.wht, 1);
}
/* shrink a convex polygon (framebuffer coords) by d pixels */
function insetPoly(pts, d) {
  const n = pts.length; let a = 0; for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n]; a += x0 * y1 - x1 * y0; }
  const s = a > 0 ? 1 : -1, L = [];
  for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n], len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len * s, ny = (x1 - x0) / len * s; L.push([x0 + nx * d, y0 + ny * d, x1 + nx * d, y1 + ny * d]); }
  return L.map((l, i) => { const m = L[(i + n - 1) % n]; const [ax, ay, bx, by] = m, [cx, cy, dx, dy] = l; const den = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx); if (Math.abs(den) < 1e-9) return [cx, cy]; const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / den; return [ax + t * (bx - ax), ay + t * (by - ay)]; });
}
/* chamfered "node plate": border, 1 px black gap, flat face. pts in design units. */
function plate(fb, pts, face = C.blu, border = C.or) {
  const P = pts.map(([x, y]) => [fb.ox + (x - fb.dx) * fb.k, fb.oy + (y - fb.dy) * fb.k]), t = Math.max(2, fb.L(3));
  fb.poly(P, border); fb.poly(insetPoly(P, t), C.k); fb.poly(insetPoly(P, t + 1), face);
}
/* rectangle with its two top (or bottom) corners cut at 45° */
const chamfer = (x, y, w, h, c, where = 'bottom') => where === 'bottom'
  ? [[x, y], [x + w, y], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c]]
  : [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h], [x, y + h], [x, y + c]];
/* double-framed stamp; draw its text on the hi plane with fb.J(text, x + w/2, baseline, c, { fam:'gro', align:'c' }) */
function stamp(fb, x, y, w, h, c) { fb.R(x, y, w, h, C.k); fb.F(x, y, w, h, c, Math.max(2, fb.L(3))); fb.F(x + 5, y + 5, w - 10, h - 10, c, 1); }
/* status LED: square, framed, lit or unlit; size in coarse-reference pixels */
function led(fb, x, y, on, col, frameCol = C.k) { const lx = fb.X(x), ly = fb.Y(y), d = fb.s(3); fb.frame(lx - 1, ly - 1, d + 2, d + 2, frameCol, 1); fb.fill(lx, ly, d, d, on ? col : C.ink); }
/* ALERT band field: red hexagon tiling (every 7th tile orange) with hazard-stripe edges. Use on a native FB (rows ≈ 44). */
function hexField(fb) {
  fb.cls(C.k); const r = fb.s(9), h = r * Math.sqrt(3), e = fb.s(3), sp = fb.s(4); let k = 0;
  for (let col = -1; col * r * 1.5 < fb.W + r; col++) for (let row = -1; row * h < fb.H + h; row++) {
    const cx = col * r * 1.5, cy = row * h + (col & 1 ? h / 2 : 0), rr = r - 1.2 * fb.s(1);
    fb.poly([0, 1, 2, 3, 4, 5].map(i => [cx + rr * Math.cos(Math.PI / 3 * i), cy + rr * Math.sin(Math.PI / 3 * i)]), (k++ % 7 === 3) ? C.or : C.red);
  }
  for (let y = 0; y < e; y++) for (let x = 0; x < fb.W; x++) { const c = Math.floor((x + y) / sp) & 1 ? C.red : C.k; fb.p(x, y, c); fb.p(x, fb.H - 1 - y, c); }
}

/* pixel-authored solid triangle ▲▼◀▶ (framebuffer px): tip at (x, y), s = half-height of the base; dir 'l' = ◀ points left */
function arrow(fb, x, y, s, dir, c) {
  x |= 0; y |= 0;
  for (let i = 0; i <= s; i++) {
    if (dir === 'l') fb.fill(x + i, y - i, 1, 2 * i + 1, c); else if (dir === 'r') fb.fill(x - i, y - i, 1, 2 * i + 1, c);
    else if (dir === 'u') fb.fill(x - i, y + i, 2 * i + 1, 1, c); else fb.fill(x - i, y - i, 2 * i + 1, 1, c);
  }
}
/* n-cell plate gauge in design units (§8.9): lit cells solid, unlit cells = 1 px baseline + 25 % dither */
function gauge(fb, x, y, w, h, n, lit, on, base = on) {
  const x0 = fb.X(x), x1 = fb.X(x + w), y0 = fb.Y(y), ch = Math.max(2, fb.Y(y + h) - y0), pitch = Math.max(2, Math.floor((x1 - x0) / n)), cw = Math.max(1, pitch - 1);
  for (let i = 0; i < n; i++) { const cx = x0 + i * pitch; if (i < lit) fb.fill(cx, y0, cw, ch, on); else { fb.dither(cx, y0, cw, ch - 1, base, .25); fb.fill(cx, y0 + ch - 1, cw, 1, base); } }
  return pitch * n;
}

/* ---------- the frame clock: 12 fps, square-wave blinks, nothing eased ---------- */
const FRAME = { f: 0, fps: 12, ms: 1000 / 12, subs: new Set(), timer: 0 };
function startFrameClock() {
  if (FRAME.timer) return;
  FRAME.timer = setInterval(() => {
    FRAME.f++;
    const rootEl = document.documentElement;
    const b2 = REDUCED || Math.floor(FRAME.f / 3) % 2 === 0, b4 = REDUCED || FRAME.f % 3 !== 2;   // 2 Hz warning blink, 4 Hz alarm blink
    rootEl.classList.toggle('b2off', !b2); rootEl.classList.toggle('b4off', !b4);
    for (const fn of [...FRAME.subs]) { try { fn(FRAME.f, performance.now()); } catch (e) { console.error(e); } }
  }, FRAME.ms);
}
const onFrame = fn => { FRAME.subs.add(fn); return () => { FRAME.subs.delete(fn); }; };
/* blink phase of frame f, identical to the clock's root classes: b2 = 2 Hz warning blink visible, b4 = 4 Hz alarm blink visible */
function blinkState(f = FRAME.f) { return { b2: REDUCED || Math.floor(f / 3) % 2 === 0, b4: REDUCED || f % 3 !== 2 }; }
/* relayout every framebuffer when its host resizes; redraw callback per panel */
function autoLayout(fb, redraw) { const ro = new ResizeObserver(() => { if (fb.layout()) redraw(); }); ro.observe(fb.host); fb._ro = ro; if (fb.layout()) redraw(); return ro; }
function setDensity(name) { GL.dens = DENSITY[name] || DENSITY.medium; for (const fb of GL.fbs) fb.W = 0; }

export const GLIB = { PAL, C, HEX, paletteToCSS, bay, FAM, ROLE, romSafe, measureTxt, clearTextCache, GL, DENSITY, setDensity, FB, drawDigit, readout7, bandFn, segMeter, insetPoly, plate, chamfer, stamp, led, hexField, arrow, gauge, FRAME, startFrameClock, onFrame, blinkState, autoLayout, REDUCED, clamp };
export default GLIB;
