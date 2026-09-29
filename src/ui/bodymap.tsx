// JANOS body map: per-muscle fatigue on a FRONT and a BACK anatomical schematic (MAGI raster instrument).
//
// Lo plane: each muscle region is its own scanline polygon, painted flat in a hard severity band
// (FRESH = hollow ink cell with a dark-gray outline, LOW r1, MOD r2, HIGH r3, MAX red) with a 1 px black seam
// between neighbouring regions, so the bands read as cel paint. Neutral parts (head, hands, knees, feet,
// pelvis, shins) are flat dark gray. The silhouette gets the node-plate treatment: orange contour, 1 px black gap.
// Hi plane: the FRONT / BACK labels, the legend and the three most fatigued muscles (ready time).
// Nothing animates except the "MAX" tag of the ranked list, which blinks at 2 Hz while a muscle is at MAX.

import { useRef } from "react";
import { GLIB } from "../magi/glib";
import type { FB, GlibApi } from "../magi/glib";
import { Raster, type FrameInfo } from "./raster";
import { MUSCLES, MUSCLE_LABEL, type Muscle } from "../engine/volume";
import { BAND_LABEL as BAND_WORD } from "../engine/fatigue";

const { C } = GLIB;

export interface BodyMapMuscle {
  band: 0 | 1 | 2 | 3 | 4;
  readyInH: number | null;
  level: number;
}

export interface BodyMapProps {
  id: string;
  muscles: Record<Muscle, BodyMapMuscle>;
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
const LEG_Y = FIG_TOP + FIG_H + 22; // legend swatch top
const LIST_Y = LEG_Y + 40; // first list row top
const ROW_H = 32;
const DH = LIST_Y + 3 * ROW_H + 26;
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

export function BodyMapPanel(p: BodyMapProps) {
  const bands = Object.fromEntries(MUSCLES.map((m) => [m, Math.max(0, Math.min(4, Math.round(p.muscles[m]?.band ?? 0)))])) as Record<Muscle, number>;
  const ranked = MUSCLES.filter((m) => bands[m] >= 1).sort((a, b) => (p.muscles[b]?.level ?? 0) - (p.muscles[a]?.level ?? 0));
  const top = ranked.slice(0, 3);
  const anyMax = MUSCLES.some((m) => bands[m] === 4);
  const sig = MUSCLES.map((m) => `${bands[m]}:${(p.muscles[m]?.level ?? 0).toFixed(3)}:${p.muscles[m]?.readyInH ?? "-"}`).join("|");
  const cache = useRef<{ fb: FB | null; key: string }>({ fb: null, key: "" });

  const draw = (fb: FB, _G: GlibApi, fr: FrameInfo) => {
    const key = `${fb.W}x${fb.H}x${fb.devPx}|${sig}`;
    if (cache.current.fb !== fb || cache.current.key !== key) {
      paintFigures(fb, bands);
      // legend swatches
      BAND_WORD.forEach((_, b) => swatch(fb, 12 + b * 93, LEG_Y, 22, 14, b));
      // list: rule, gauges
      fb.fill(fb.X(8), fb.Y(LIST_Y - 8), fb.X(472) - fb.X(8), 1, C.or);
      top.forEach((m, i) => sevGauge(fb, 168, LIST_Y + i * ROW_H + 6, 100, 14, p.muscles[m].level));
      fb.saveBg();
      cache.current = { fb, key };
    } else fb.restore();
    fb.present();
    fb.hclear();

    fb.J("FRONT", CX_FRONT, 28, C.or, { fam: "gro", size: 26, align: "c", maxW: 200 });
    fb.J("BACK", CX_BACK, 28, C.or, { fam: "gro", size: 26, align: "c", maxW: 200 });
    BAND_WORD.forEach((w, b) => fb.T(w, 12 + b * 93 + 28, LEG_Y + 13, C.or, { font: "lab", maxW: 62 }));
    if (!top.length) {
      fb.T("ALL MUSCLE GROUPS FRESH", 240, LIST_Y + ROW_H + 8, C.or, { font: "hd", size: 22, align: "c", maxW: 440 });
    }
    top.forEach((m, i) => {
      const y = LIST_Y + i * ROW_H + 20;
      const f = p.muscles[m];
      fb.T(String(i + 1).padStart(2, "0"), 10, y, C.or, { font: "lab" });
      fb.T(MUSCLE_LABEL[m], 38, y + 1, C.am, { font: "val", size: 18, maxW: 124 });
      const b = bands[m];
      if (b < 4 || fr.b2) fb.T(BAND_WORD[b], 276, y, b === 4 ? C.red : C.or, { font: "lab", maxW: 44 });
      const ready = fmtReady(f.readyInH);
      fb.T(ready, 472, y + 1, f.readyInH === 0 ? C.grn : C.wht, { font: "val", size: 17, align: "r", maxW: 146 });
    });
    if (p.rev) fb.T(p.rev, 472, DH - 8, C.or, { font: "lab", align: "r", maxW: 220 });
  };

  const srText =
    p.srText ??
    (ranked.length
      ? `MUSCLE FATIGUE. ${ranked.map((m) => `${MUSCLE_LABEL[m]} ${BAND_WORD[bands[m]]}, ${fmtReady(p.muscles[m].readyInH)}`).join(". ")}. OTHER GROUPS FRESH.`
      : "MUSCLE FATIGUE. ALL MUSCLE GROUPS FRESH.");
  const post = p.post === false ? undefined : p.post ?? [p.rev || "MYOMAP R01", "REGION TEST ... OK", "FRAMEBUFFER {FB} OK", "MAP LIVE"];
  return (
    <Raster
      id={p.id}
      label={p.label ?? "MUSCLE FATIGUE MAP"}
      srText={srText}
      dw={DW}
      dh={DH}
      rows={Math.max(24, Math.round(DH * R_BODY))}
      draw={draw}
      deps={[sig, p.rev]}
      animate={anyMax ? "blink" : false}
      post={post}
    />
  );
}
