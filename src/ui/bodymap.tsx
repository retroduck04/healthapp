// JANOS body map: per-muscle fatigue on a FRONT and a BACK anatomical schematic (MAGI raster instrument).
//
// Lo plane: each muscle region is its own scanline polygon, painted flat in a hard severity band
// (FRESH = hollow ink cell with a dark-gray outline, LOW r1, MOD r2, HIGH r3, MAX red) with a 1 px black seam
// between neighbouring regions, so the bands read as cel paint. Neutral parts (head, hands, knees, feet,
// pelvis, shins) are flat dark gray. The silhouette gets the node-plate treatment: orange contour, 1 px black gap.
// Hi plane: the FRONT / BACK labels, the legend and the three most fatigued muscles (ready time).
//
// VITALS (from Garmin): an x-ray layer on the FRONT figure (dithered cyan lungs that breathe at the logged
// sleep respiration rate, a red heart that pulses at resting heart rate) and a sweep ECG strip under the
// figures whose beat-to-beat spacing varies with last night's HRV. These animate on the 12 fps frame clock;
// with reduced motion (or no Garmin data) they hold still. The "MAX" tag of the ranked list blinks at 2 Hz.

import { useRef } from "react";
import { GLIB } from "../magi/glib";
import type { FB, GlibApi } from "../magi/glib";
import { Raster, type FrameInfo } from "./raster";
import { MUSCLES, MUSCLE_LABEL, type Muscle } from "../engine/volume";
import { BAND_LABEL as BAND_WORD } from "../engine/fatigue";
import { beatPlan, beatWindow, ecgAt, type BeatPlan } from "../engine/vitals";

const { C } = GLIB;

export interface BodyMapMuscle {
  band: 0 | 1 | 2 | 3 | 4;
  readyInH: number | null;
  level: number;
}

/** Latest Garmin vitals; null fields are shown as "---". */
export interface Vitals {
  /** resting heart rate, bpm */
  hr: number | null;
  /** last night's HRV (rMSSD), ms */
  hrv: number | null;
  /** average sleep respiration, breaths/min */
  resp: number | null;
  /** average stress 0–100 */
  stress: number | null;
  /** body battery at wake 0–100 */
  bb: number | null;
  /** day the numbers are from (YYYY-MM-DD) */
  date: string | null;
}

export interface BodyMapProps {
  id: string;
  muscles: Record<Muscle, BodyMapMuscle>;
  /** Garmin vitals for the heart, lungs and ECG layer; omitted = no vitals layer */
  vitals?: Vitals | null;
  /** revision micro label, e.g. "MYOMAP R01" */
  rev?: string;
  /** screen-reader mirror; defaults to a summary of every fatigued muscle */
  srText?: string;
  /** accessible name (default "MUSCLE FATIGUE MAP") */
  label?: string;
  /** POST lines override; false disables POST */
  post?: string[] | false;
}

/** lit fill per band (band 0 is drawn hollow: ink fill, dgy outline) */
const BAND_FILL = [C.ink, C.r1, C.r2, C.r3, C.red];

// ---- anatomy ------------------------------------------------------------------------------------
// Figure-local units: x = 0 on the body's midline (right half drawn, mirrored for the left), y = 0 at the
// crown, 336 at the soles. A part with `full` is already a whole symmetric polygon (head, neck).
// Later parts paint over earlier ones; every part instance is its own region (own seam).

type Pt = [number, number];
interface Part {
  m: Muscle | null;
  pts: Pt[];
  full?: boolean;
}
const N = null;

const HEAD: Pt[] = [[-10, 0], [10, 0], [16, 6], [17, 20], [15, 30], [9, 38], [-9, 38], [-15, 30], [-17, 20], [-16, 6]];
const ARM_LOWER: Part[] = [
  { m: N, pts: [[57, 130], [64, 131], [70, 126], [73, 134], [67, 140], [59, 139]] }, // elbow
  { m: "forearms", pts: [[59, 141], [67, 141], [73, 135], [78, 146], [80, 162], [79, 178], [72, 184], [66, 172], [61, 156]] },
  { m: N, pts: [[67, 186], [79, 181], [84, 190], [84, 204], [80, 214], [73, 214], [69, 202]] }, // hand
];

const FRONT: Part[] = [
  { m: N, pts: HEAD, full: true },
  { m: N, pts: [[-8, 36], [8, 36], [9, 54], [-9, 54]], full: true }, // neck
  { m: "back", pts: [[9, 41], [16, 44], [40, 50], [30, 54], [9, 52]] }, // upper traps
  { m: "shoulders", pts: [[30, 54], [40, 50], [52, 52], [60, 60], [64, 74], [62, 88], [55, 93], [49, 80], [46, 66], [40, 58]] },
  { m: "chest", pts: [[1, 54], [9, 52], [30, 54], [40, 58], [46, 66], [49, 80], [46, 90], [36, 96], [18, 98], [1, 96]] },
  { m: "biceps", pts: [[49, 80], [55, 93], [62, 88], [66, 96], [70, 110], [70, 124], [64, 130], [57, 128], [52, 114], [49, 100]] },
  ...ARM_LOWER,
  { m: N, pts: [[26, 156], [34, 162], [41, 154], [47, 166], [46, 176], [30, 184], [16, 190], [6, 194], [1, 194], [1, 178], [10, 175], [18, 166]] }, // pelvis
  { m: "abs", pts: [[1, 99], [20, 98], [22, 112], [1, 113]] },
  { m: "abs", pts: [[1, 116], [22, 115], [23, 130], [1, 131]] },
  { m: "abs", pts: [[1, 134], [23, 133], [23, 148], [1, 149]] },
  { m: "abs", pts: [[1, 152], [22, 151], [18, 166], [10, 174], [1, 176]] },
  { m: "abs", pts: [[25, 100], [37, 96], [46, 91], [45, 104], [43, 120], [40, 138], [40, 152], [34, 160], [26, 152], [26, 130]] }, // obliques
  { m: "quads", pts: [[30, 186], [46, 177], [50, 192], [51, 214], [47, 240], [42, 262], [36, 268], [30, 262], [25, 246], [22, 222], [25, 202]] },
  { m: "quads", pts: [[14, 236], [21, 228], [25, 248], [29, 264], [22, 268], [15, 262], [12, 250]] }, // vastus medialis
  { m: "adductors", pts: [[3, 196], [16, 192], [29, 187], [23, 205], [20, 224], [14, 234], [8, 224], [4, 210]] },
  { m: N, pts: [[20, 268], [28, 266], [38, 268], [38, 278], [33, 283], [25, 283], [20, 278]] }, // knee
  { m: N, pts: [[25, 285], [34, 285], [36, 300], [33, 318], [27, 318], [24, 300]] }, // shin
  { m: "calves", pts: [[15, 280], [22, 284], [23, 300], [25, 316], [19, 312], [14, 297]] },
  { m: "calves", pts: [[36, 284], [41, 279], [44, 294], [39, 310], [36, 300]] },
  { m: N, pts: [[21, 320], [34, 320], [38, 328], [43, 335], [17, 335], [19, 326]] }, // foot
];

const BACK: Part[] = [
  { m: N, pts: HEAD, full: true },
  { m: N, pts: [[-8, 36], [8, 36], [9, 46], [-9, 46]], full: true }, // neck
  // shoulder girdle tiles on shared vertices: (40,50) acromion, (32,57), (20,70), (10,88), (1,104)
  { m: "back", pts: [[1, 38], [8, 38], [12, 44], [40, 50], [32, 57], [20, 70], [10, 88], [1, 104]] }, // trapezius
  { m: "shoulders", pts: [[40, 50], [50, 51], [58, 56], [63, 68], [64, 82], [60, 90], [53, 90], [47, 78], [40, 64], [32, 57]] }, // rear delt
  { m: "back", pts: [[32, 57], [40, 64], [47, 78], [49, 89], [38, 93], [26, 86], [20, 70]] }, // infraspinatus / teres
  { m: "back", pts: [[10, 88], [20, 70], [26, 86], [38, 93], [49, 89], [48, 104], [43, 124], [35, 142], [22, 156], [12, 160], [9, 132]] }, // lats
  { m: "back", pts: [[1, 104], [10, 88], [9, 132], [12, 160], [1, 164]] }, // erectors
  { m: "triceps", pts: [[56, 93], [62, 89], [67, 96], [70, 110], [64, 113], [58, 104]] }, // lateral head
  { m: "triceps", pts: [[51, 94], [56, 93], [58, 104], [64, 113], [70, 113], [70, 126], [62, 130], [56, 126], [52, 112]] }, // long head
  ...ARM_LOWER,
  { m: "glutes", pts: [[2, 164], [12, 161], [22, 157], [35, 155], [43, 161], [47, 175], [44, 193], [34, 201], [18, 203], [3, 199], [2, 181]] },
  { m: "hamstrings", pts: [[27, 205], [44, 197], [49, 212], [47, 236], [41, 256], [35, 266], [31, 244], [29, 222]] }, // biceps femoris
  { m: "hamstrings", pts: [[6, 205], [25, 205], [27, 224], [29, 246], [32, 266], [22, 266], [16, 248], [10, 226]] }, // semitendinosus
  { m: N, pts: [[17, 268], [40, 268], [40, 277], [17, 277]] }, // back of the knee
  { m: "calves", pts: [[13, 279], [26, 279], [27, 296], [24, 312], [18, 308], [12, 292]] }, // medial head
  { m: "calves", pts: [[28, 279], [41, 279], [44, 290], [40, 304], [31, 300]] }, // lateral head
  { m: "calves", pts: [[20, 315], [26, 302], [31, 302], [38, 307], [35, 321], [24, 322]] }, // soleus
  { m: N, pts: [[23, 324], [34, 324], [37, 335], [20, 335]] }, // heel
];

interface Inst {
  m: Muscle | null;
  pts: Pt[];
}
/** place a figure: mirror the half parts, scale s, centre cx, crown at y0 (design units) */
function place(parts: Part[], cx: number, y0: number, s: number): Inst[] {
  const out: Inst[] = [];
  for (const p of parts) {
    const map = (sx: number) => p.pts.map(([x, y]) => [cx + sx * x * s, y0 + y * s] as Pt);
    out.push({ m: p.m, pts: map(1) });
    if (!p.full) out.push({ m: p.m, pts: map(-1) });
  }
  return out;
}

// ---- layout (design units) -------------------------------------------------------------------------
const DW = 480;
const FIG_S = 1.0;
const FIG_TOP = 40;
const FIG_H = 336 * FIG_S;
const CX_FRONT = 122;
const CX_BACK = 358;
const ECG_Y = FIG_TOP + FIG_H + 26; // ECG strip top (vitals layout only)
const ECG_H = 70;
const ECG_X0 = 12;
const ECG_X1 = 468;
const VIT_Y = ECG_Y + ECG_H + 34; // readout value baseline
const ROW_H = 32;
/** vertical layout: with vitals the legend and list move below the ECG and readouts */
const layoutFor = (vitals: boolean) => {
  const legY = vitals ? VIT_Y + 22 : FIG_TOP + FIG_H + 22;
  const listY = legY + 40;
  return { legY, listY, dh: listY + 3 * ROW_H + 26 };
};
const R_BODY = 0.467; // rows per design unit at coarse density: ≈ 1.33 CSS px pixels at 393 px wide
const GAP = 255;

/** paint both figures into the lo plane (framebuffer pixel pass: ids → seams → contour → colour) */
function paintFigures(fb: FB, bands: Record<Muscle, number>): void {
  const W = fb.W;
  const H = fb.H;
  const buf = fb.buf!;
  const insts = [...place(FRONT, CX_FRONT, FIG_TOP, FIG_S), ...place(BACK, CX_BACK, FIG_TOP, FIG_S)];
  const dx = fb.dx || 0;
  const dy = fb.dy || 0;
  fb.noClip();
  fb.cls(0);
  insts.forEach((p, i) => fb.poly(p.pts.map(([x, y]) => [fb.ox + (x - dx) * fb.k, fb.oy + (y - dy) * fb.k]), i + 1));
  const ids = buf.slice();
  // seams: a pixel whose right or lower neighbour belongs to another region becomes a 1 px black gap
  const g = ids.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = ids[i];
      if (!a) continue;
      const r = x + 1 < W ? ids[i + 1] : 0;
      const d = y + 1 < H ? ids[i + W] : 0;
      if ((r && r !== a) || (d && d !== a)) g[i] = GAP;
    }
  }
  // silhouette: ring 1 (black gap) hugs the body; the contour is drawn on the pixels just outside it,
  // but only where they connect to the open background (interior holes stay black)
  const ring = new Uint8Array(W * H); // 1 = ring 1, 2 = far background reachable from the edge, 3 = contour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ids[i]) continue;
      if ((x > 0 && ids[i - 1]) || (x + 1 < W && ids[i + 1]) || (y > 0 && ids[i - W]) || (y + 1 < H && ids[i + W])) ring[i] = 1;
    }
  }
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!ids[i] && !ring[i]) {
      ring[i] = 2;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x);
    seed((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    seed(y * W);
    seed(y * W + W - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    if (x > 0) seed(i - 1);
    if (x + 1 < W) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i + W < W * H) seed(i + W);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ring[i] !== 2) continue;
      if ((x > 0 && ring[i - 1] === 1) || (x + 1 < W && ring[i + 1] === 1) || (y > 0 && ring[i - W] === 1) || (y + 1 < H && ring[i + W] === 1)) ring[i] = 3;
    }
  }
  // colour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = g[i];
      if (a === 0) {
        buf[i] = ring[i] === 3 ? C.or : C.k;
        continue;
      }
      if (a === GAP) {
        buf[i] = C.k;
        continue;
      }
      const m = insts[a - 1].m;
      if (!m) {
        buf[i] = C.dgy;
        continue;
      }
      const b = bands[m] ?? 0;
      if (b > 0) {
        buf[i] = BAND_FILL[b];
        continue;
      }
      const edge = (x === 0 || g[i - 1] !== a) || (x + 1 >= W || g[i + 1] !== a) || (y === 0 || g[i - W] !== a) || (y + 1 >= H || g[i + W] !== a);
      buf[i] = edge ? C.dgy : C.ink;
    }
  }
}

// ---- vitals: organs, ECG ------------------------------------------------------------------------------
// Organs in FRONT figure-local units (x > 0 = the body's left, drawn on the viewer's right).
const LUNG_LEFT: Pt[] = [[8, 60], [16, 57], [26, 63], [33, 75], [36, 91], [36, 107], [30, 116], [18, 116], [13, 110], [10, 100], [8, 86], [7, 70]];
const LUNG_RIGHT: Pt[] = [[-8, 60], [-16, 57], [-27, 63], [-35, 77], [-38, 94], [-38, 110], [-30, 118], [-16, 118], [-9, 112], [-7, 92], [-7, 70]];
const HEART_C: Pt = [4, 92];
const HEART: Pt[] = [[-11, -6], [-5, -11], [3, -11], [9, -8], [13, -2], [15, 6], [11, 13], [4, 17], [-3, 13], [-9, 6], [-12, 0]];

/** poly in FRONT figure-local units, scaled by s around the anchor a */
function organPts(pts: Pt[], a: Pt, s: number, off: Pt = [0, 0]): number[][] {
  return pts.map(([x, y]) => [CX_FRONT + (a[0] + (x + off[0] - a[0]) * s) * FIG_S, FIG_TOP + (a[1] + (y + off[1] - a[1]) * s) * FIG_S]);
}

function outline(fb: FB, pts: number[][], c: number, t: number): void {
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    fb.Ln(x0, y0, x1, y1, c, t);
  }
}

/**
 * Draws the vitals layer into the lo plane (over the restored figures): lungs, heart, ECG strip.
 * `now` is ms; `still` = reduced motion or no data (lungs half full, heart at rest, full trace, no sweep).
 */
function paintVitals(fb: FB, v: Vitals, plan: BeatPlan | null, now: number, still: boolean): { beatAge: number } {
  const bay = GLIB.bay;
  const W = fb.W;
  const buf = fb.buf!;
  // lungs: breathe at the sleep respiration rate (default 14/min when Garmin has none)
  const period = 60000 / Math.max(6, Math.min(40, v.resp ?? 14));
  const phase = still ? 0.5 : (now % period) / period;
  const vol = phase < 0.4 ? (1 - Math.cos((Math.PI * phase) / 0.4)) / 2 : (1 + Math.cos((Math.PI * (phase - 0.4)) / 0.6)) / 2;
  const ls = 0.86 + 0.14 * vol;
  for (const [lung, anchor] of [[LUNG_LEFT, [22, 58]], [LUNG_RIGHT, [-22, 58]]] as [Pt[], Pt][]) {
    const pts = organPts(lung, anchor, ls);
    fb.P(pts, (x, y) => (bay(x, y) < 0.3 ? C.dcya : buf[y * W + x]));
    outline(fb, pts, C.k, fb.s(2));
    outline(fb, pts, C.cya, 1);
  }
  // heart: pulses on each R peak
  let beatAge = 1e9;
  if (plan && v.hr) {
    const { i, off } = beatWindow(plan, still ? plan.cum[2] + 400 : now);
    beatAge = off - plan.cum[i];
  }
  const pulse = beatAge < 1e8 ? Math.exp(-beatAge / 110) : 0;
  const hs = 1 + 0.16 * pulse;
  fb.P(organPts(HEART, HEART_C, hs * 1.14, HEART_C), C.k);
  fb.P(organPts(HEART, HEART_C, hs, HEART_C), pulse > 0.35 ? C.red : C.r3);
  outline(fb, organPts(HEART, HEART_C, hs, HEART_C), pulse > 0.35 ? C.wht : C.red, 1);

  // ECG strip: sweep trace, 5 s across, dotted grid
  const x0 = fb.X(ECG_X0);
  const x1 = fb.X(ECG_X1);
  const y0 = fb.Y(ECG_Y);
  const y1 = fb.Y(ECG_Y + ECG_H);
  fb.fill(x0, y0, x1 - x0, y1 - y0, C.k);
  for (let gx = ECG_X0; gx <= ECG_X1; gx += 19) for (let gy = ECG_Y + 7; gy < ECG_Y + ECG_H; gy += 14) fb.p(fb.X(gx), fb.Y(gy), C.dgrn);
  fb.frame(x0, y0, x1 - x0, y1 - y0, C.dgrn, 1);
  const mid = y0 + Math.round((y1 - y0) * 0.64);
  const amp = (y1 - y0) * 0.52;
  const hot = v.stress !== null && v.stress >= 50;
  const col = hot ? C.am : C.grn;
  if (!plan || !v.hr) {
    fb.fill(x0 + 1, mid, x1 - x0 - 2, 1, C.dgrn); // flat line: no signal
    return { beatAge };
  }
  const span = 5000;
  const head = still ? span : now % span;
  const wpx = x1 - x0 - 2;
  let prev: number | null = null;
  for (let c = 0; c < wpx; c++) {
    const p0 = (c / wpx) * span;
    const p1 = ((c + 1) / wpx) * span;
    let tBase: number;
    if (p0 <= head) tBase = now - head;
    else {
      if (p0 - head < 260) {
        prev = null; // erase gap ahead of the write head
        continue;
      }
      tBase = now - head - span;
    }
    let lo = Infinity;
    let hi = -Infinity;
    let last = 0;
    for (let k = 0; k <= 5; k++) {
      const val = ecgAt(plan, tBase + p0 + ((p1 - p0) * k) / 5);
      lo = Math.min(lo, val);
      hi = Math.max(hi, val);
      last = val;
    }
    const yHi = Math.round(mid - hi * amp);
    const yLo = Math.round(mid - lo * amp);
    const top = Math.max(y0 + 1, Math.min(yHi, prev ?? yHi));
    const bot = Math.min(y1 - 2, Math.max(yLo, prev ?? yLo));
    fb.fill(x0 + 1 + c, top, 1, bot - top + 1, col);
    prev = Math.round(mid - last * amp);
  }
  if (!still) {
    const hx = x0 + 1 + Math.min(wpx - 1, Math.round((head / span) * wpx));
    const hy = Math.round(mid - ecgAt(plan, now) * amp);
    fb.fill(hx - fb.s(1), Math.max(y0 + 1, hy - fb.s(1)), fb.s(2) + 1, fb.s(2) + 1, C.wht);
  }
  return { beatAge };
}

/** a band swatch in design units: lit = flat band fill, band 0 = hollow ink cell with dgy outline */
function swatch(fb: FB, x: number, y: number, w: number, h: number, band: number): void {
  const x0 = fb.X(x);
  const y0 = fb.Y(y);
  const ww = fb.X(x + w) - x0;
  const hh = fb.Y(y + h) - y0;
  if (band > 0) fb.fill(x0, y0, ww, hh, BAND_FILL[band]);
  else {
    fb.fill(x0, y0, ww, hh, C.ink);
    fb.frame(x0, y0, ww, hh, C.dgy, 1);
  }
}

/** 10-cell severity gauge: cell i is lit when level ≥ (i + 1) / 10 − 0.05, painted in the band of its level */
function sevGauge(fb: FB, x: number, y: number, w: number, h: number, level: number): void {
  const n = 10;
  const x0 = fb.X(x);
  const y0 = fb.Y(y);
  const ch = Math.max(2, fb.Y(y + h) - y0);
  const pitch = Math.max(3, Math.floor((fb.X(x + w) - x0) / n));
  const cw = pitch - 1;
  const lit = Math.max(level > 0 ? 1 : 0, Math.round(Math.min(1, level) * n));
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * pitch;
    if (i < lit) {
      const lv = (i + 0.5) / n;
      const b = lv >= 0.8 ? 4 : lv >= 0.55 ? 3 : lv >= 0.3 ? 2 : 1;
      fb.fill(cx, y0, cw, ch, BAND_FILL[b]);
    } else {
      fb.fill(cx, y0, cw, ch, C.ink);
      fb.frame(cx, y0, cw, ch, C.dgy, 1);
    }
  }
}

const fmtReady = (h: number | null): string => (h === null ? "NO DATA" : h <= 0 ? "READY" : h >= 48 ? `READY IN ${Math.round(h / 24)} D` : `READY IN ${Math.round(h)} H`);

const fmtNum = (v: number | null, w = 3) => (v === null ? "---" : String(Math.round(v)).padStart(w, "0"));

export function BodyMapPanel(p: BodyMapProps) {
  const bands = Object.fromEntries(MUSCLES.map((m) => [m, Math.max(0, Math.min(4, Math.round(p.muscles[m]?.band ?? 0)))])) as Record<Muscle, number>;
  const ranked = MUSCLES.filter((m) => bands[m] >= 1).sort((a, b) => (p.muscles[b]?.level ?? 0) - (p.muscles[a]?.level ?? 0));
  const top = ranked.slice(0, 3);
  const anyMax = MUSCLES.some((m) => bands[m] === 4);
  const v = p.vitals ?? null;
  const L = layoutFor(!!v);
  const live = !!(v && v.hr) && !GLIB.REDUCED;
  const planKey = v && v.hr ? `${v.hr}|${v.hrv ?? "-"}|${v.date ?? ""}` : "";
  const planRef = useRef<{ key: string; plan: BeatPlan | null }>({ key: "", plan: null });
  if (planRef.current.key !== planKey) planRef.current = { key: planKey, plan: v && v.hr ? beatPlan(v.hr, v.hrv, planKey) : null };
  const sig = MUSCLES.map((m) => `${bands[m]}:${(p.muscles[m]?.level ?? 0).toFixed(3)}:${p.muscles[m]?.readyInH ?? "-"}`).join("|") + `|${planKey}|${v ? `${v.resp}|${v.stress}|${v.bb}` : "-"}`;
  const cache = useRef<{ fb: FB | null; key: string }>({ fb: null, key: "" });

  const draw = (fb: FB, _G: GlibApi, fr: FrameInfo) => {
    const key = `${fb.W}x${fb.H}x${fb.devPx}|${sig}`;
    if (cache.current.fb !== fb || cache.current.key !== key) {
      paintFigures(fb, bands);
      // legend swatches
      BAND_WORD.forEach((_, b) => swatch(fb, 12 + b * 93, L.legY, 22, 14, b));
      // list: rule, gauges
      fb.fill(fb.X(8), fb.Y(L.listY - 8), fb.X(472) - fb.X(8), 1, C.or);
      top.forEach((m, i) => sevGauge(fb, 168, L.listY + i * ROW_H + 6, 100, 14, p.muscles[m].level));
      fb.saveBg();
      cache.current = { fb, key };
    } else fb.restore();
    let beatAge = 1e9;
    if (v) beatAge = paintVitals(fb, v, planRef.current.plan, performance.now(), !live).beatAge;
    fb.present();
    fb.hclear();

    fb.J("FRONT", CX_FRONT, 28, C.or, { fam: "gro", size: 26, align: "c", maxW: 200 });
    fb.J("BACK", CX_BACK, 28, C.or, { fam: "gro", size: 26, align: "c", maxW: 200 });
    if (v) {
      const beat = beatAge < 160;
      fb.T(v.hr ? `ECG · SIMULATED FROM GARMIN RESTING HR${v.date ? ` · ${v.date.slice(5)}` : ""}` : "NO SIGNAL · AWAITING GARMIN", ECG_X0, ECG_Y - 7, v.hr ? C.or : C.red, { font: "lab", maxW: 380 });
      if (v.hr && (beat || !live)) fb.T("■ BEAT", ECG_X1 - 4, ECG_Y - 7, C.red, { font: "lab", align: "r" });
      const cells: [string, string, number][] = [
        ["HR BPM", fmtNum(v.hr), v.hr ? C.wht : C.gry],
        ["HRV MS", fmtNum(v.hrv), v.hrv ? C.wht : C.gry],
        ["RESP /MIN", v.resp === null ? "--.-" : v.resp.toFixed(1), v.resp ? C.cya : C.gry],
        ["STRESS", fmtNum(v.stress), v.stress === null ? C.gry : v.stress >= 50 ? C.am : C.wht],
        ["BATTERY", fmtNum(v.bb), v.bb === null ? C.gry : v.bb < 25 ? C.red : C.grn],
      ];
      cells.forEach(([lab, val, c], i) => {
        const x = ECG_X0 + i * 92;
        fb.T(lab, x, VIT_Y - 20, C.or, { font: "lab", maxW: 88 });
        fb.T(val, x, VIT_Y, c, { font: "val", size: 20, maxW: 88 });
      });
    }
    BAND_WORD.forEach((w, b) => fb.T(w, 12 + b * 93 + 28, L.legY + 13, C.or, { font: "lab", maxW: 62 }));
    if (!top.length) {
      fb.T("ALL MUSCLE GROUPS FRESH", 240, L.listY + ROW_H + 8, C.or, { font: "hd", size: 22, align: "c", maxW: 440 });
    }
    top.forEach((m, i) => {
      const y = L.listY + i * ROW_H + 20;
      const f = p.muscles[m];
      fb.T(String(i + 1).padStart(2, "0"), 10, y, C.or, { font: "lab" });
      fb.T(MUSCLE_LABEL[m], 38, y + 1, C.am, { font: "val", size: 18, maxW: 124 });
      const b = bands[m];
      if (b < 4 || fr.b2) fb.T(BAND_WORD[b], 276, y, b === 4 ? C.red : C.or, { font: "lab", maxW: 44 });
      const ready = fmtReady(f.readyInH);
      fb.T(ready, 472, y + 1, f.readyInH === 0 ? C.grn : C.wht, { font: "val", size: 17, align: "r", maxW: 146 });
    });
    if (p.rev) fb.T(p.rev, 472, L.dh - 8, C.or, { font: "lab", align: "r", maxW: 220 });
  };

  const vitalsText = v
    ? ` VITALS: resting heart rate ${v.hr ?? "unknown"} bpm, HRV ${v.hrv ?? "unknown"} ms, breathing ${v.resp ?? "unknown"} per minute, stress ${v.stress ?? "unknown"}, body battery ${v.bb ?? "unknown"}.`
    : "";
  const srText =
    p.srText ??
    (ranked.length
      ? `MUSCLE FATIGUE. ${ranked.map((m) => `${MUSCLE_LABEL[m]} ${BAND_WORD[bands[m]]}, ${fmtReady(p.muscles[m].readyInH)}`).join(". ")}. OTHER GROUPS FRESH.${vitalsText}`
      : `MUSCLE FATIGUE. ALL MUSCLE GROUPS FRESH.${vitalsText}`);
  const post = p.post === false ? undefined : p.post ?? [p.rev || "MYOMAP R01", "REGION TEST ... OK", "FRAMEBUFFER {FB} OK", v ? "VITALS LINK ... OK" : "MAP LIVE", "MAP LIVE"].filter((l, i, a) => a.indexOf(l) === i);
  return (
    <Raster
      id={p.id}
      label={p.label ?? (v ? "BODY MAP: MUSCLE FATIGUE AND VITALS" : "MUSCLE FATIGUE MAP")}
      srText={srText}
      dw={DW}
      dh={L.dh}
      rows={Math.max(24, Math.round(L.dh * R_BODY))}
      draw={draw}
      deps={[sig, p.rev]}
      animate={live ? true : anyMax ? "blink" : false}
      post={post}
    />
  );
}
