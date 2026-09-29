// JANOS raster instruments (MAGI visual protocol §7–§8), built on the GLIB two-plane framebuffer.
//
// Every instrument renders ONLY the raster host `div.mg-fbhost` (full width, aspect-ratio = its design space);
// the panel frame (bar, S# tag, title, status, corner brackets) is the caller's HTML.
// Text is always drawn on the hi plane in real fonts; graphics on the low-resolution lo plane.
// Design spaces are phone-sized (480 wide) so type stays legible at 393 CSS px; each instrument uses a
// different pixel size (rows) so they read as different hardware.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { GLIB } from "../magi/glib";
import type { FB, GlibApi } from "../magi/glib";

const { C } = GLIB;

// ---- frame clock + settings -------------------------------------------------------------------

/** Start the global 12 fps frame clock (idempotent). It also drives the html.b2off / html.b4off blink classes. */
export function startClock(): void {
  GLIB.startFrameClock();
}

/** Subscribe `fn` to the 12 fps frame clock while `active` (default true). Latest `fn` is always used. */
export function useFrame(fn: (f: number) => void, active: boolean = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    startClock();
    return GLIB.onFrame((f: number) => ref.current(f));
  }, [active]);
}

export type Density = "coarse" | "medium" | "fine";
const LS_FLICK = "janos.flicker";
const LS_DENS = "janos.density";

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the setting lasts for this page session */
  }
}

let FLICK = lsGet(LS_FLICK) !== "0";
let DENS: Density = ((): Density => {
  const v = lsGet(LS_DENS);
  return v === "coarse" || v === "fine" || v === "medium" ? v : "medium";
})();
GLIB.setDensity(DENS);

const SETTINGS_SUBS = new Set<() => void>();
let SETTINGS_SNAP = { flicker: FLICK, density: DENS };
function emitSettings(): void {
  SETTINGS_SNAP = { flicker: FLICK, density: DENS };
  for (const fn of [...SETTINGS_SUBS]) fn();
}

/** Mounted panels: relayout-and-repaint callbacks. */
const LIVE = new Set<(force: boolean) => void>();
function repaintAll(): void {
  for (const fn of [...LIVE]) fn(true);
}

/** Rapid "working" flicker (flashing). Off also keeps the alert band steady. prefers-reduced-motion always wins. */
export function getFlicker(): boolean {
  return FLICK;
}
export function setFlicker(on: boolean): void {
  FLICK = !!on;
  lsSet(LS_FLICK, FLICK ? "1" : "0");
  emitSettings();
  repaintAll();
}

/** Raster density: multiplies every panel's row count (coarse 1, medium 1.25, fine 1.8). */
export function getDensity(): Density {
  return DENS;
}
export function setDensity(d: Density): void {
  DENS = d === "coarse" || d === "fine" ? d : "medium";
  lsSet(LS_DENS, DENS);
  GLIB.setDensity(DENS); // marks every framebuffer dirty (W = 0) …
  emitSettings();
  for (const fn of [...LIVE]) fn(false); // … so each live panel's layout() returns true and it redraws
}

/** React view of the two raster settings (for a settings screen). */
export function useRasterSettings(): { flicker: boolean; density: Density } {
  return useSyncExternalStore(
    (cb) => {
      SETTINGS_SUBS.add(cb);
      return () => {
        SETTINGS_SUBS.delete(cb);
      };
    },
    () => SETTINGS_SNAP,
  );
}

// Web fonts arrive after the first paint: drop cached text runs and redraw with the real faces.
try {
  const fonts = (document as any).fonts;
  if (fonts && fonts.addEventListener) {
    fonts.addEventListener("loadingdone", () => {
      GLIB.clearTextCache();
      repaintAll();
    });
  }
} catch {
  /* no FontFaceSet */
}

// ---- Raster: the low-level host ---------------------------------------------------------------

export interface FrameInfo {
  /** frame number of the 12 fps clock */
  f: number;
  /** 2 Hz warning blink is in its visible phase (always true under reduced motion) */
  b2: boolean;
  /** 4 Hz alarm blink is in its visible phase (always true under reduced motion) */
  b4: boolean;
  /** working flicker allowed (setting on and no reduced motion) */
  flicker: boolean;
  reduced: boolean;
}

export interface RasterProps {
  id: string;
  /** accessible name of the instrument (role="img") */
  label: string;
  /** visually hidden live mirror of the values */
  srText?: string;
  /** design space (default 480 × 270) */
  dw?: number;
  dh?: number;
  /** framebuffer rows at COARSE density (sets the pixel size) */
  rows: number;
  /** draw the whole panel. Return true to be called again on the next frame (stepped meters). */
  draw: (fb: FB, G: GlibApi, frame: FrameInfo) => boolean | void;
  /** redraw when any of these change (fixed length) */
  deps: unknown[];
  /** true: redraw every frame; "blink": redraw only on 2 Hz / 4 Hz blink edges */
  animate?: boolean | "blink";
  /** POST boot lines, shown once per id per page session; "{FB}" becomes the framebuffer size */
  post?: string[];
  className?: string;
}

const BOOTED = new Set<string>();

interface RasterState {
  fb: FB | null;
  post: { lines: string[]; n: number; last: number; hold: number } | null;
  pending: boolean;
  blinkKey: number;
  unsub: (() => void) | null;
  first: boolean;
}

function drawPost(fb: FB, post: { lines: string[]; n: number }, b2: boolean): void {
  fb.noClip();
  fb.cls(C.k);
  fb.present();
  fb.hclear();
  const size = fb.o.dh < 200 ? 13 : 14;
  const lh = size + 6;
  const n = Math.min(post.n, post.lines.length);
  const maxLines = Math.max(1, Math.floor((fb.o.dh - 20) / lh) - 1);
  const start = Math.max(0, n - maxLines);
  let y = 24;
  for (let i = start; i < n; i++) {
    const s = post.lines[i].replace("{FB}", `${fb.W}X${fb.H}`);
    fb.T(s, 16, y, i === post.lines.length - 1 ? C.am : C.or, { font: "lab", size, maxW: fb.o.dw - 32 });
    y += lh;
  }
  if (b2) fb.T("_", 16, y, C.am, { font: "lab", size });
}

/** Low-level raster panel. Mounts a GLIB framebuffer in `div.mg-fbhost`, tears it down on unmount. */
export function Raster(p: RasterProps) {
  const dw = p.dw ?? 480;
  const dh = p.dh ?? 270;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const st = useRef<RasterState>({ fb: null, post: null, pending: false, blinkKey: -1, unsub: null, first: true });
  const drawRef = useRef(p.draw);
  drawRef.current = p.draw;
  const animRef = useRef(p.animate);
  animRef.current = p.animate;
  const fns = useRef<{ paint: () => void; sync: () => void } | null>(null);

  if (!fns.current) {
    const s = st.current;
    const tick = (f: number) => {
      const fb = s.fb;
      if (!fb) return;
      if (s.post) {
        const post = s.post;
        if (f - post.last >= 2 && post.n < post.lines.length) {
          post.n++;
          post.last = f;
        } else if (post.n >= post.lines.length && ++post.hold > 6) {
          s.post = null;
        }
        fns.current!.paint();
        return;
      }
      const a = animRef.current;
      if (a === true || s.pending) {
        fns.current!.paint();
        return;
      }
      if (a === "blink") {
        const b = GLIB.blinkState(f);
        const key = (b.b2 ? 1 : 0) + (b.b4 ? 2 : 0);
        if (key !== s.blinkKey) fns.current!.paint();
      }
    };
    const sync = () => {
      const an = animRef.current;
      // blink-mode panels never change phase under reduced motion, so they need no frame subscription
      const need = !!(s.fb && (s.post || an === true || (an === "blink" && !GLIB.REDUCED) || s.pending));
      if (need && !s.unsub) {
        startClock();
        s.unsub = GLIB.onFrame(tick);
      } else if (!need && s.unsub) {
        s.unsub();
        s.unsub = null;
      }
    };
    const paint = () => {
      const fb = s.fb;
      if (!fb || !fb.W) return;
      const f = GLIB.FRAME.f;
      const b = GLIB.blinkState(f);
      s.blinkKey = (b.b2 ? 1 : 0) + (b.b4 ? 2 : 0);
      if (s.post) {
        drawPost(fb, s.post, b.b2);
      } else {
        let more: boolean | void = false;
        try {
          more = drawRef.current(fb, GLIB, { f, b2: b.b2, b4: b.b4, flicker: FLICK && !GLIB.REDUCED, reduced: GLIB.REDUCED });
        } catch (e) {
          console.error(e);
        }
        s.pending = !!more;
      }
      sync();
    };
    fns.current = { paint, sync };
  }

  // mount / unmount: one framebuffer per mounted host
  useLayoutEffect(() => {
    const s = st.current;
    const host = hostRef.current!;
    const fb = new GLIB.FB(host, { rows: p.rows, dw, dh });
    s.fb = fb;
    if (p.post && p.post.length && !GLIB.REDUCED && !BOOTED.has(p.id)) {
      BOOTED.add(p.id);
      s.post = { lines: p.post.map((l) => GLIB.romSafe(l)), n: 1, last: GLIB.FRAME.f, hold: 0 };
    }
    const relayout = (force: boolean) => {
      if (fb.layout() || force) fns.current!.paint();
    };
    const ro = new ResizeObserver(() => relayout(false));
    ro.observe(host);
    fb._ro = ro; // fb.destroy() disconnects it
    LIVE.add(relayout);
    relayout(false);
    return () => {
      LIVE.delete(relayout);
      s.fb = null;
      s.post = null;
      s.pending = false;
      fns.current!.sync(); // drops the frame subscription
      fb.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // geometry props changed: relayout in place (no canvas churn)
  useLayoutEffect(() => {
    const fb = st.current.fb;
    if (!fb) return;
    if (fb.o.rows === p.rows && fb.o.dw === dw && fb.o.dh === dh) return;
    Object.assign(fb.o, { rows: p.rows, dw, dh });
    fb.W = 0;
    if (fb.layout()) fns.current!.paint();
  }, [p.rows, dw, dh]);

  // data changed: redraw (skip the mount pass, the layout effect already painted)
  useEffect(() => {
    const s = st.current;
    if (s.first) {
      s.first = false;
      return;
    }
    fns.current!.paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, p.deps);

  // animation mode changed
  useEffect(() => {
    fns.current!.sync();
    if (!p.animate) fns.current!.paint();
  }, [p.animate]);

  const srId = `${p.id}-sr`;
  return (
    <>
      <div
        ref={hostRef}
        id={p.id}
        className={p.className ? `mg-fbhost ${p.className}` : "mg-fbhost"}
        role="img"
        aria-label={GLIB.romSafe(p.label)}
        aria-describedby={p.srText ? srId : undefined}
        style={{ position: "relative", overflow: "hidden", width: "100%", aspectRatio: `${dw} / ${dh}`, background: "var(--k, #000000)" }}
      />
      {p.srText ? (
        <div id={srId} className="mg-sr" aria-live="polite" style={SR_STYLE}>
          {p.srText}
        </div>
      ) : null}
    </>
  );
}

const SR_STYLE = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" };

// ---- shared helpers ---------------------------------------------------------------------------

export type Tone = "am" | "red" | "grn" | "or" | "wht" | "blu" | "cya" | "dbl" | "tea" | "gry" | "dim" | "yel" | "orb";
export interface StampSpec {
  text: string;
  tone: "red" | "grn" | "am";
  blink?: boolean;
}
export interface InstrumentBase {
  id: string;
  /** accessible name; defaults from the caption/title */
  label?: string;
  /** revision micro label, e.g. "BODYMASS MOD 1.04" */
  rev?: string;
  stamp?: StampSpec;
  srText?: string;
  /** POST lines override; false disables POST for this instrument */
  post?: string[] | false;
}

const up = (s: unknown): string => GLIB.romSafe(s);
const colOf = (t: string | undefined, d: number): number => (t && (C as any)[t] != null ? (C as any)[t] : d);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** width of display type in design units (J with fam/size/sq) */
function jw(fb: FB, str: string, size: number, fam = "gro", sq = 0.8, weight = 700): number {
  const px = Math.max(8, Math.round(size * fb.kh));
  return (GLIB.measureTxt(str, fam, weight, px) * sq) / fb.kh;
}

function fmtNum(v: number, decimals = 1): string {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Number.isInteger(r) ? String(r) : r.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

const STAMP_H = 38;
const STAMP_SIZE = 26;
interface StampBox {
  x: number;
  y: number;
  w: number;
  c: number;
  text: string;
}
/** stamp box width in design units */
function stampWidth(fb: FB, st: StampSpec, maxW: number): number {
  return Math.min(maxW, Math.ceil(jw(fb, up(st.text), STAMP_SIZE)) + 30);
}
/** lo-plane part of a stamp (call before present). align "l": x is the left edge, "r": x is the right edge. */
function stampLo(fb: FB, st: StampSpec | undefined, x: number, y: number, maxW: number, fr: FrameInfo, align: "l" | "r" = "l"): StampBox | null {
  if (!st || !st.text) return null;
  if (st.blink && !fr.b2) return null;
  const text = up(st.text);
  const w = stampWidth(fb, st, maxW);
  const c = st.tone === "grn" ? C.grn : st.tone === "am" ? C.am : C.red;
  const bx = align === "r" ? x - w : x;
  GLIB.stamp(fb, bx, y, w, STAMP_H, c);
  return { x: bx, y, w, c, text };
}
/** hi-plane part of a stamp (call after hclear) */
function stampHi(fb: FB, b: StampBox | null): void {
  if (!b) return;
  fb.J(b.text, b.x + b.w / 2, b.y + STAMP_H / 2 + 9.5, b.c, { fam: "gro", size: STAMP_SIZE, align: "c", maxW: b.w - 18 });
}

function revText(fb: FB, rev: string | undefined, x: number, y: number, c: number, maxW = 220): number {
  if (!rev) return 0;
  const w = Math.min(maxW, fb.tw(rev, "lab"));
  fb.T(rev, x, y, c, { font: "lab", align: "r", maxW });
  return w;
}

function postLines(p: InstrumentBase, first: string, mid: string, last: string): string[] | undefined {
  if (p.post === false) return undefined;
  if (p.post) return p.post;
  return [p.rev || first, mid, "FRAMEBUFFER {FB} OK", last];
}

/** blink visibility for a 0 | 2 | 4 Hz request */
const blinkVis = (hz: number | undefined, fr: FrameInfo) => (hz === 2 ? fr.b2 : hz === 4 ? fr.b4 : true);

/** rows (at coarse density) for a design height and a target pixel size at 393 px (medium density, DPR 3) */
const rowsFor = (dh: number, perUnit: number) => Math.max(24, Math.round(dh * perUnit));
// pixel size ≈ 2.33 / 2 / 1.67 / 1.33 CSS px at 393 px wide
const R_SEG = 0.267;
const R_METER = 0.311;
const R_PLATE = 0.373;
const R_BARS = 0.3;
const R_PLOT = 0.467;

// ---- a. Seg7Panel -----------------------------------------------------------------------------

export interface Seg7Props extends InstrumentBase {
  /** digits, "-", " ", ":", "." e.g. "2140", "07:32", "182.4", "-0.6" */
  value: string;
  /** e.g. "KCAL REMAINING:" */
  caption: string;
  /** one mono line under the digits */
  sub?: string;
  unit?: string;
  state?: { text: string; tone: "red" | "am" | "grn" | "or"; blink?: 0 | 2 | 4 };
  tone?: "am" | "red" | "grn";
  /** hard-banded heat field behind the readout (one hero instrument per screen) */
  heat?: boolean;
  side?: { big: string; small: string };
}

const SEG_DH = 276;

export function Seg7Panel(p: Seg7Props) {
  const tone = p.tone ?? "am";
  const on = tone === "red" ? C.red : tone === "grn" ? C.grn : C.am;
  const off = tone === "red" ? C.dred : tone === "grn" ? C.dgrn : C.dim;
  const value = String(p.value ?? "").replace(/[^0-9\-:. ]/g, " ");
  const st = p.state;
  const animate = (st && st.blink) || (p.stamp && p.stamp.blink) ? "blink" : false;

  const draw = (fb: FB, G: GlibApi, fr: FrameInfo) => {
    const heat = !!p.heat;
    const side = p.side;
    const mainL = 22;
    const mainR = side ? 364 : 458;
    const top = 42;
    const bot = 214;
    const cap = up(p.caption);
    const capW = Math.min(fb.tw(cap, "hd"), mainR - mainL - 70);
    const tabR = mainL + 12 + capW + 12;
    fb.noClip();
    fb.cls(C.k);
    if (heat) {
      const band = G.bandFn(fb, 8, 6, 464, 268);
      fb.P([[8, 6], [472, 6], [472, 222], [396, 222], [396, 244], [100, 244], [72, 274], [8, 274]], band);
      fb.P([[112, 250], [472, 250], [472, 256], [106, 256]], band);
      for (let x = 41; x < 470; x += 33) fb.fill(fb.X(x), fb.Y(6), fb.s(1), Math.max(2, fb.L(7)), C.k);
      fb.P([[mainL, 16], [tabR, 16], [tabR + 14, 30], [tabR + 14, top], [mainR, top], [mainR, bot], [mainL, bot]], C.k);
      if (side) fb.R(374, top, 86, bot - top, C.k);
    } else {
      fb.F(mainL, top, mainR - mainL, bot - top, C.dim);
    }
    if (side) fb.F(374, top, 86, bot - top, C.blu);
    // blue ticks on the left margin
    for (let y = 30; y < 262; y += 44) fb.fill(fb.X(0), fb.Y(y), Math.max(2, fb.L(5)), fb.s(1), C.blu);
    // corner pips of the readout cut-out
    const pip = fb.s(1);
    for (const [x, y] of [[fb.X(mainL) + 1, fb.Y(top) + 1], [fb.X(mainR) - 1 - pip, fb.Y(top) + 1], [fb.X(mainL) + 1, fb.Y(bot) - 1 - pip], [fb.X(mainR) - 1 - pip, fb.Y(bot) - 1 - pip]])
      fb.fill(x, y, pip, pip, C.blu);

    // digits: as big as the cut-out allows (≤ 100 design units tall)
    const unit = p.unit ? up(p.unit) : "";
    const unitW = unit ? fb.tw(unit, "hd") + 10 : 0;
    const availW = mainR - 12 - (mainL + 12) - unitW;
    let nD = 0;
    let nC = 0;
    let nP = 0;
    for (const ch of value) {
      if (ch === ":") nC++;
      else if (ch === ".") nP++;
      else nD++;
    }
    const units = Math.max(1, 1.22 * nD + 0.332 * nC + 0.27 * nP - 0.22);
    const digH = Math.max(40, Math.min(100, (availW / units) / 0.46));
    const digW = digH * 0.46;
    const gap = digW * 0.22;
    const digBot = 178;
    const digX = mainL + 12;
    const end = value ? G.readout7(fb, value, digX, digBot - digH, digW, digH, gap, on, off) - gap : digX;

    const sb = stampLo(fb, p.stamp, mainL, 226, 250, fr);
    fb.present();
    fb.hclear();

    fb.T(cap, mainL + 12, 35, C.wht, { font: "hd", maxW: capW });
    if (st && st.text && blinkVis(st.blink, fr)) {
      const stC = st.tone === "red" ? C.red : st.tone === "grn" ? C.grn : st.tone === "or" ? C.or : C.am;
      fb.T(st.text, mainR - 12, 64, stC, { font: "rom", align: "r", maxW: mainR - mainL - 24 });
    }
    if (unit) fb.T(unit, end + 10, digBot, C.or, { font: "hd", maxW: unitW });
    if (p.sub) fb.T(p.sub, mainL + 12, 204, C.am, { font: "val", maxW: mainR - mainL - 24 });
    if (side) {
      fb.T(side.small, 417, 66, C.am, { font: "lab", align: "c", maxW: 78 });
      fb.fill(fb.X(380), fb.Y(76), fb.X(454) - fb.X(380), 1, C.blu);
      fb.J(up(side.big), 417, 146, C.wht, { fam: "gro", size: 34, align: "c", maxW: 74 });
    }
    revText(fb, p.rev, 472, 271, C.or, sb ? 472 - (sb.x + sb.w) - 16 : 220);
    stampHi(fb, sb);
  };

  const srText =
    p.srText ?? [p.caption, `${p.value}${p.unit ? " " + p.unit : ""}`, p.sub, p.state?.text?.replace(/[●○■□]/g, "").trim(), p.side ? `${p.side.small} ${p.side.big}` : "", p.stamp?.text].filter(Boolean).join(". ");
  return (
    <Raster
      id={p.id}
      label={p.label ?? p.caption.replace(/:$/, "")}
      srText={srText}
      dw={480}
      dh={SEG_DH}
      rows={rowsFor(SEG_DH, R_SEG)}
      draw={draw}
      deps={[value, p.caption, p.sub, p.unit, st?.text, st?.tone, st?.blink, tone, !!p.heat, p.side?.big, p.side?.small, p.rev, p.stamp?.text, p.stamp?.tone, p.stamp?.blink]}
      animate={animate}
      post={postLines(p, "SEG7 MOD 1.00", "SEGMENT TEST ... OK", "READOUT LIVE")}
    />
  );
}

// ---- b. MeterPanel ----------------------------------------------------------------------------

export interface MeterRow {
  /** row id shown as red 7-seg digits, e.g. "01" */
  id2: string;
  name: string;
  value: number;
  max: number;
  /** peak-hold value (white frame) */
  peak?: number;
  /** amber status line under the meter, e.g. "PROTEIN 112/150 G" */
  line: string;
  /** right-aligned value, e.g. "075%" */
  right: string;
  /** default "bands"; over max (value > max) defaults to "red" */
  tone?: "bands" | "red" | "grn" | "am" | "dim";
}
export interface MeterProps extends InstrumentBase {
  title?: string;
  right?: string;
  rows: MeterRow[];
  /** cells per meter; default fits ≈40 cells to whole framebuffer pixels (≥ 3 px lit + 1 px gap) */
  cells?: number;
  /** scale ticks as fractions of max; default 0 / 50 / 100% */
  scale?: { f: number; label: string }[];
  /** red identity "diagnostic" panel */
  red?: boolean;
}

const M_HEAD = 80;
const M_ROW = 92;
const M_FOOT = 44;
const M_X0 = 84;
const M_X1 = 470;
/** last shown fraction per meter (stepped rise survives tab switches) */
const METER_MEM = new Map<string, { shown: number[]; last: number }>();

export function MeterPanel(p: MeterProps) {
  const rows = p.rows.slice(0, 5);
  const n = Math.max(1, rows.length);
  const dh = M_HEAD + n * M_ROW + M_FOOT;
  const scale = p.scale ?? [
    { f: 0, label: "0" },
    { f: 0.5, label: "50" },
    { f: 1, label: "100%" },
  ];
  const animate = p.stamp && p.stamp.blink ? "blink" : false;

  const draw = (fb: FB, G: GlibApi, fr: FrameInfo) => {
    const red = !!p.red;
    const sc = red ? C.red : C.or;
    fb.noClip();
    fb.cls(C.k);
    // header rule
    fb.fill(fb.X(10), fb.Y(48), fb.X(470) - fb.X(10), Math.max(1, fb.s(1)), sc);
    // geometry of the cells on whole pixels
    const x0 = fb.X(M_X0);
    const wpx = fb.X(M_X1) - x0;
    const cells = p.cells ? Math.max(1, Math.round(p.cells)) : Math.min(40, Math.floor(wpx / Math.max(4, Math.ceil(wpx / 40))));
    const pitch = Math.max(3, Math.floor(wpx / cells));
    const endPx = x0 + pitch * cells - 1;
    const endD = (endPx + 1 - fb.ox) / fb.k + (fb.dx || 0);
    const meterW = endD - M_X0;
    // stepped rise: ≤ 4 cells per 2 frames, instant fall
    let mem = METER_MEM.get(p.id);
    if (!mem) {
      mem = { shown: [], last: fr.f };
      METER_MEM.set(p.id, mem);
    }
    const step = fr.f - mem.last >= 2;
    if (step) mem.last = fr.f;
    let more = false;
    rows.forEach((r, i) => {
      const y0 = M_HEAD + i * M_ROW;
      const frac = r.max > 0 ? clamp(r.value / r.max, 0, 1) : 0;
      let target = Math.round(frac * cells);
      if (r.value > 0 && target === 0) target = 1;
      const tf = target / cells;
      let shown = mem!.shown[i] ?? (fr.reduced ? tf : 0);
      if (tf <= shown || fr.reduced) shown = tf;
      else if (step) shown = Math.min(tf, shown + 4 / cells);
      if (shown < tf) more = true;
      mem!.shown[i] = shown;
      const lit = Math.round(shown * cells);
      const over = r.max > 0 && r.value > r.max;
      const tone = r.tone ?? (over ? "red" : "bands");
      const color = tone === "red" ? C.red : tone === "grn" ? C.grn : tone === "am" ? C.am : tone === "dim" ? C.dim : undefined;
      const peak = r.peak != null && r.max > 0 ? Math.min(cells, Math.ceil(clamp(r.peak / r.max, 0, 1) * cells)) : 0;
      G.segMeter(fb, M_X0, y0 + 8, meterW, 32, cells, lit, { color, peak });
      // scale ticks above each meter
      for (const s of scale) {
        const tx = Math.min(endPx, x0 + Math.round(s.f * (endPx + 1 - x0)));
        fb.fill(tx - (s.f >= 1 ? 1 : 0), fb.Y(y0 + 2), 1, Math.max(2, fb.Y(y0 + 7) - fb.Y(y0 + 2)), red ? C.red : C.dim);
      }
      // row id: red 7-seg with unlit segments
      const id2 = String(r.id2 ?? "").slice(0, 2).padStart(2, "0");
      for (let d = 0; d < 2; d++) G.drawDigit(fb, id2[d], fb.X(14 + d * 28), fb.Y(y0 + 4), fb.L(22), fb.L(38), Math.max(2, fb.L(4.6)), C.red, C.dred);
    });
    const sb = stampLo(fb, p.stamp, 10, M_HEAD + n * M_ROW + 2, 260, fr);
    fb.present();
    fb.hclear();

    let titleW = 0;
    if (p.title) titleW = fb.J(up(p.title), 10, 38, sc, { fam: "gro", size: 34, maxW: 280 });
    if (p.right) fb.T(p.right, 470, 37, red ? C.red : C.am, { font: "hd", size: 20, align: "r", maxW: Math.max(40, 470 - 10 - titleW - 14) });
    // scale labels over the first meter
    for (const s of scale) {
      const x = M_X0 + s.f * meterW;
      fb.T(s.label, x, M_HEAD - 4, sc, { font: "lab", align: s.f <= 0 ? "l" : s.f >= 1 ? "r" : "c", maxW: 80 });
    }
    rows.forEach((r, i) => {
      const y0 = M_HEAD + i * M_ROW;
      const over = r.max > 0 && r.value > r.max;
      fb.T(r.name, 41, y0 + 62, red ? C.red : C.or, { font: "lab", align: "c", maxW: 76 });
      const rw = Math.min(110, fb.tw(r.right, "hd", 20));
      fb.T(r.right, endD, y0 + 64, over || r.tone === "red" ? C.red : C.wht, { font: "hd", size: 20, align: "r", maxW: 110 });
      fb.T(r.line, M_X0, y0 + 64, C.am, { font: "hd", size: 19, maxW: Math.max(40, meterW - rw - 12) });
    });
    revText(fb, p.rev, 470, dh - 10, sc, sb ? 470 - (sb.x + sb.w) - 16 : 240);
    stampHi(fb, sb);
    return more;
  };

  const sig = rows.map((r) => [r.id2, r.name, r.value, r.max, r.peak, r.line, r.right, r.tone].join("|")).join("~");
  const srText = p.srText ?? [p.title, p.right, ...rows.map((r) => `${r.name}: ${r.line}, ${r.right}`), p.stamp?.text].filter(Boolean).join(". ");
  return (
    <Raster
      id={p.id}
      label={p.label ?? p.title ?? "LEVEL METERS"}
      srText={srText}
      dw={480}
      dh={dh}
      rows={rowsFor(dh, R_METER)}
      draw={draw}
      deps={[sig, p.title, p.right, p.cells, JSON.stringify(scale), !!p.red, p.rev, p.stamp?.text, p.stamp?.tone, p.stamp?.blink]}
      animate={animate}
      post={postLines(p, "LEVEL MON 1.00", "CELL TEST ... OK", "METERS ARMED")}
    />
  );
}

// ---- c. PlotPanel -----------------------------------------------------------------------------

export interface XY {
  x: number;
  y: number;
}
export type PlotTone = "am" | "wht" | "or" | "blu" | "grn" | "red";
export interface PlotProps extends Omit<InstrumentBase, "id"> {
  id?: string;
  dots?: (XY & { flag?: boolean })[];
  lines?: (XY[] | { pts: XY[]; tone?: PlotTone; width?: 1 | 2 })[];
  band?: { x: number; lo: number; hi: number }[];
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  yPad?: number;
  /** LineChart compatibility: SVG height at 340 wide; mapped to the design height */
  height?: number;
  hlines?: { y: number; label: string; tone: PlotTone; dashed?: boolean }[];
  vlines?: { x: number; label: string; tone: PlotTone }[];
  marker?: { x: number; y: number; label: string };
  legend?: string;
  empty?: string;
}

let AUTO_ID = 0;
function useAutoId(prefix: string, id?: string): string {
  const [auto] = useState(() => `${prefix}-${++AUTO_ID}`);
  return id ?? auto;
}

const defaultXFormat = (v: number) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function PlotPanel(p: PlotProps) {
  const id = useAutoId("mg-plot", p.id);
  const dh = clamp(Math.round((480 * (p.height ?? 180)) / 340) + 30, 240, 420);
  const series = (p.lines ?? []).map((l) => (Array.isArray(l) ? { pts: l, tone: "wht" as PlotTone, width: 1 } : { pts: l.pts, tone: l.tone ?? "wht", width: l.width ?? 1 }));
  const animate = p.stamp && p.stamp.blink ? "blink" : false;
  const propsRef = useRef(p);
  propsRef.current = p;

  const draw = (fb: FB, G: GlibApi, fr: FrameInfo) => {
    const q = propsRef.current;
    const dots = q.dots ?? [];
    const band = q.band ?? [];
    const hl = q.hlines ?? [];
    const vl = q.vlines ?? [];
    const yf = q.yFormat ?? ((v: number) => fmtNum(v, 1));
    const xf = q.xFormat ?? defaultXFormat;
    const pts: XY[] = [...dots];
    for (const s of series) pts.push(...s.pts);
    for (const b of band) pts.push({ x: b.x, y: b.lo }, { x: b.x, y: b.hi });
    const empty = pts.length === 0;
    const ys = pts.map((a) => a.y).concat(hl.map((h) => h.y));
    if (q.marker) ys.push(q.marker.y);
    const xs = pts.map((a) => a.x).concat(vl.map((v) => v.x));
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (!(x1 > x0)) {
      x0 = (isFinite(x0) ? x0 : 0) - 1;
      x1 = x0 + 2;
    }
    const pad = q.yPad ?? 0.5;
    let y0 = Math.min(...ys) - pad;
    let y1 = Math.max(...ys) + pad;
    if (!isFinite(y0) || !isFinite(y1)) {
      y0 = 0;
      y1 = 1;
    }
    if (!(y1 > y0)) y1 = y0 + 1;
    const step = niceStep((y1 - y0) / 4);
    y0 = Math.floor(y0 / step + 1e-9) * step;
    y1 = Math.ceil(y1 / step - 1e-9) * step;
    const ticks: number[] = [];
    for (let v = y0; v <= y1 + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    const labels = ticks.map((t) => yf(t));
    const scaleW = empty ? 16 : clamp(Math.max(...labels.map((l) => fb.tw(l, "lab", 15))) + 14, 30, 110);
    const L = 8;
    const R = 480 - 8 - scaleW;
    const T = 32;
    const B = dh - 30;
    const X = (x: number) => L + ((x - x0) / (x1 - x0)) * (R - L);
    const Y = (y: number) => B - ((y - y0) / (y1 - y0)) * (B - T);
    const px = (x: number) => fb.X(X(x));
    const py = (y: number) => fb.Y(Y(y));

    fb.noClip();
    fb.cls(C.k);
    const fl = fb.X(L);
    const fr0 = fb.X(R);
    const ft = fb.Y(T);
    const fbt = fb.Y(B);
    // band: flat dim2, no alpha
    if (!empty && band.length > 1) {
      const poly = band.map((b) => [X(b.x), Y(b.hi)]).concat([...band].reverse().map((b) => [X(b.x), Y(b.lo)]));
      fb.P(poly, C.dim2);
    }
    // dotted graticule + right-hand scale ticks
    const lblEvery = (B - T) / Math.max(1, ticks.length - 1) < 17 ? 2 : 1;
    if (!empty) {
      ticks.forEach((t, i) => {
        const yy = py(t);
        if (yy > ft && yy < fbt) fb.line(fl + 1, yy, fr0 - 1, yy, C.dim, 1, 0b001, 3);
        fb.fill(fr0 + 1, yy, Math.max(2, fb.s(2)), 1, i % lblEvery ? C.dim : C.or);
      });
      for (const f of [0.25, 0.5, 0.75]) {
        const xx = fb.X(L + f * (R - L));
        fb.line(xx, ft + 1, xx, fbt - 1, C.dim, 1, 0b001, 3);
      }
    }
    fb.frame(fl, ft, fr0 - fl + 1, fbt - ft + 1, C.dim, 1);
    // data layer, clipped to the frame
    fb.clip(fl + 1, ft + 1, fr0, fbt);
    for (const h of hl) {
      const yy = py(h.y);
      if (h.dashed ?? true) fb.line(fl + 1, yy, fr0 - 1, yy, colOf(h.tone, C.or), 1, 0b0011, 6);
      else fb.line(fl + 1, yy, fr0 - 1, yy, colOf(h.tone, C.or));
    }
    for (const v of vl) {
      const xx = px(v.x);
      fb.line(xx, ft + 1, xx, fbt - 1, colOf(v.tone, C.or));
    }
    for (const s of series) {
      const c = colOf(s.tone, C.wht);
      for (let i = 1; i < s.pts.length; i++) fb.line(px(s.pts[i - 1].x), py(s.pts[i - 1].y), px(s.pts[i].x), py(s.pts[i].y), c, s.width === 2 ? 2 : 1);
    }
    const ds = fb.s(2);
    const dsF = fb.s(3);
    for (const d of dots) {
      if (d.flag) continue;
      fb.fill(px(d.x) - (ds >> 1), py(d.y) - (ds >> 1), ds, ds, C.am);
    }
    for (const d of dots) {
      if (!d.flag) continue;
      fb.fill(px(d.x) - (dsF >> 1) - 1, py(d.y) - (dsF >> 1) - 1, dsF + 2, dsF + 2, C.k);
      fb.fill(px(d.x) - (dsF >> 1), py(d.y) - (dsF >> 1), dsF, dsF, C.red);
    }
    fb.noClip();
    // marker ◄ pointing at a value
    let mk: { tx: number; ty: number; right: boolean } | null = null;
    if (q.marker && !empty) {
      const mx = px(q.marker.x);
      const my = py(q.marker.y);
      const a = Math.max(3, fb.s(4));
      const lw = fb.tw(q.marker.label, "val", 17) + 10;
      const room = R - (X(q.marker.x) + (a * 2 + 4) / fb.k);
      const right = room > lw;
      fb.fill(mx - 1, my - 1, 3, 3, C.wht);
      if (right) G.arrow(fb, mx + 3, my, a, "l", C.wht);
      else G.arrow(fb, mx - 3, my, a, "r", C.wht);
      const edge = right ? (mx + 3 + a + 2 - fb.ox) / fb.k : (mx - 3 - a - 2 - fb.ox) / fb.k;
      mk = { tx: edge + (right ? 4 : -4), ty: Math.min(B - 6, Math.max(T + 18, Y(q.marker.y) + 6)), right };
    }
    // stamp: the inside corner that covers the fewest data points
    let sb: StampBox | null = null;
    if (q.stamp && q.stamp.text) {
      const w = stampWidth(fb, q.stamp, R - L - 12);
      const cands = [
        [R - 6 - w, T + 6],
        [L + 6, T + 6],
        [R - 6 - w, B - 6 - STAMP_H],
        [L + 6, B - 6 - STAMP_H],
      ];
      const all: XY[] = [...dots];
      for (const s of series) all.push(...s.pts);
      let best = cands[0];
      let bestN = Infinity;
      for (const c of cands) {
        let k = 0;
        for (const a of all) {
          const ax = X(a.x);
          const ay = Y(a.y);
          if (ax >= c[0] - 4 && ax <= c[0] + w + 4 && ay >= c[1] - 4 && ay <= c[1] + STAMP_H + 4) k++;
        }
        if (k < bestN) {
          bestN = k;
          best = c;
        }
      }
      sb = stampLo(fb, q.stamp, best[0], best[1], R - L - 12, fr);
    }
    fb.present();
    fb.hclear();

    // header: legend left, revision right
    const rw = q.rev ? Math.min(200, fb.tw(q.rev, "lab")) : 0;
    if (q.legend) fb.T(q.legend, L, 21, C.or, { font: "lab", maxW: 480 - 16 - rw - (rw ? 14 : 0) });
    revText(fb, q.rev, 472, 21, C.or, 200);
    if (empty) {
      fb.T(q.empty ?? "NO DATA", (L + R) / 2, (T + B) / 2 + 8, C.or, { font: "hd", size: 24, align: "c", maxW: R - L - 20 });
      stampHi(fb, sb);
      return;
    }
    // right-hand scale
    ticks.forEach((t, i) => {
      if (i % lblEvery) return;
      const yy = Y(t);
      fb.T(labels[i], R + 7, clamp(yy + 5, T + 10, B + 6), C.or, { font: "lab", size: 15, maxW: scaleW - 8 });
    });
    // x labels: first / last (middle when it fits)
    const xl = xf(x0);
    const xr = xf(x1);
    const xm = xf((x0 + x1) / 2);
    const wl = fb.tw(xl, "lab", 15);
    const wr = fb.tw(xr, "lab", 15);
    const wm = fb.tw(xm, "lab", 15);
    const half = (R - L) / 2;
    fb.T(xl, L, B + 19, C.or, { font: "lab", size: 15, maxW: half - 6 });
    fb.T(xr, R, B + 19, C.or, { font: "lab", size: 15, align: "r", maxW: half - 6 });
    if (wl + wm / 2 + 16 < half && wr + wm / 2 + 16 < half) fb.T(xm, L + half, B + 19, C.or, { font: "lab", size: 15, align: "c" });
    // line labels
    for (const h of hl) {
      const yy = Y(h.y);
      const by = yy - 16 < T ? yy + 16 : yy - 5;
      fb.T(h.label, L + 6, by, colOf(h.tone, C.or), { font: "lab", maxW: (R - L) / 2, bg: C.k });
    }
    for (const v of vl) {
      const xx = X(v.x);
      const leftSide = xx > (L + R) / 2;
      fb.T(v.label, xx + (leftSide ? -5 : 5), T + 17, colOf(v.tone, C.or), { font: "lab", align: leftSide ? "r" : "l", maxW: leftSide ? xx - L - 8 : R - xx - 8, bg: C.k });
    }
    if (mk && q.marker) fb.T(q.marker.label, mk.tx, mk.ty, C.wht, { font: "val", size: 17, align: mk.right ? "l" : "r", maxW: mk.right ? R - mk.tx - 4 : mk.tx - L - 4, bg: C.k });
    stampHi(fb, sb);
  };

  const sig = JSON.stringify([p.dots, series, p.band, p.hlines, p.vlines, p.marker, p.legend, p.empty, p.yPad, p.rev, p.stamp]);
  const n = (p.dots?.length ?? 0) + series.reduce((a, s) => a + s.pts.length, 0);
  const srText = p.srText ?? (n ? [p.legend, p.marker?.label, ...(p.hlines ?? []).map((h) => h.label), ...(p.vlines ?? []).map((v) => v.label), `${n} POINTS`, p.stamp?.text].filter(Boolean).join(". ") : p.empty ?? "NO DATA");
  return (
    <Raster
      id={id}
      label={p.label ?? p.legend ?? "PLOT"}
      srText={srText}
      dw={480}
      dh={dh}
      rows={rowsFor(dh, R_PLOT)}
      draw={draw}
      deps={[sig]}
      animate={animate}
      post={p.id ? postLines({ ...p, id }, "PLOTTER R01", "GRATICULE ... OK", "TRACE READY") : undefined}
    />
  );
}

// ---- d. BarsPanel -----------------------------------------------------------------------------

export interface BarSpec {
  label: string;
  value: number;
  tone?: Tone;
  /** stacked bottom → top; the value label shows `value` */
  segments?: { value: number; tone: Tone }[];
}
export interface BarsProps extends Omit<InstrumentBase, "id"> {
  id?: string;
  bars: BarSpec[];
  /** BarChart compatibility: SVG height at 340 wide; mapped to the design height */
  height?: number;
  format?: (v: number) => string;
  target?: { value: number; label: string };
  legend?: string;
  empty?: string;
}

export function BarsPanel(p: BarsProps) {
  const id = useAutoId("mg-bars", p.id);
  const dh = clamp(Math.round((480 * (p.height ?? 140)) / 340) + 40, 220, 400);
  const animate = p.stamp && p.stamp.blink ? "blink" : false;
  const propsRef = useRef(p);
  propsRef.current = p;

  const draw = (fb: FB, _G: GlibApi, fr: FrameInfo) => {
    const q = propsRef.current;
    const bars = q.bars ?? [];
    const fmtv = q.format ?? ((v: number) => String(Math.round(v)));
    const total = (b: BarSpec) => (b.segments && b.segments.length ? b.segments.reduce((a, s) => a + Math.max(0, s.value), 0) : Math.max(0, b.value));
    const maxV = Math.max(1e-9, ...bars.map(total), q.target ? q.target.value : 0);
    const empty = bars.length === 0 || bars.every((b) => total(b) <= 0 && !(b.value > 0));
    const L = 8;
    const R = 472;
    const top = 58;
    const base = dh - 32;
    const n = Math.max(1, bars.length);
    const slot = (R - L) / n;
    const bw = Math.max(slot * 0.64, 2 / fb.k);
    fb.noClip();
    fb.cls(C.k);
    const yb = fb.Y(base);
    const H = (v: number) => ((base - top) * v) / maxV;
    if (!empty) {
      bars.forEach((b, i) => {
        const xa = fb.X(L + i * slot + (slot - bw) / 2);
        const xb = Math.max(xa + 1, fb.X(L + i * slot + (slot + bw) / 2));
        const segs = b.segments && b.segments.length ? b.segments : [{ value: b.value, tone: b.tone ?? "am" }];
        let acc = 0;
        for (const s of segs) {
          if (!(s.value > 0)) continue;
          const ya = fb.Y(base - H(acc + s.value));
          const yc = fb.Y(base - H(acc));
          fb.fill(xa, Math.min(ya, yc - 1), xb - xa, Math.max(1, yc - ya), colOf(s.tone ?? b.tone, C.am));
          acc += s.value;
        }
      });
      // target: dashed orange, drawn in black where it crosses a lit bar so it stays readable
      if (q.target) {
        const ty = fb.Y(base - H(q.target.value));
        const xa = fb.X(L);
        const xb = fb.X(R);
        for (let x = xa; x < xb; x++) {
          if (((x - xa) % 6) >= 3) continue;
          const i = ty * fb.W + x;
          fb.buf![i] = fb.buf![i] === C.k ? C.or : C.k;
        }
      }
    }
    fb.fill(fb.X(L), yb, fb.X(R) - fb.X(L), 1, empty ? C.dim : C.or);
    if (q.target && !empty) {
      const sy = fb.Y(15);
      for (let x = fb.X(L); x < fb.X(L + 24); x++) if ((x - fb.X(L)) % 6 < 3) fb.p(x, sy, C.or);
    }
    // stamp: the top corner over the lower bars
    let sb: StampBox | null = null;
    if (q.stamp && q.stamp.text) {
      const w = stampWidth(fb, q.stamp, R - L);
      const hiIn = (x0: number, x1: number) => Math.max(0, ...bars.map((b, i) => (L + (i + 1) * slot > x0 && L + i * slot < x1 ? total(b) : 0)));
      const right = hiIn(R - w, R) <= hiIn(L, L + w);
      sb = stampLo(fb, q.stamp, right ? R - w : L, 28, R - L, fr);
    }
    fb.present();
    fb.hclear();

    // header: target legend / legend left, revision right
    const rw = q.rev ? Math.min(200, fb.tw(q.rev, "lab")) : 0;
    let lx = L;
    if (q.target && !empty) {
      lx += 30;
      lx += fb.T(q.target.label, lx, 21, C.or, { font: "lab", maxW: 480 - 16 - rw - (lx - L) - 14 }) + 14;
    }
    if (q.legend) fb.T(q.legend, lx, 21, C.or, { font: "lab", maxW: Math.max(20, 480 - 8 - rw - 14 - lx) });
    revText(fb, q.rev, 472, 21, C.or, 200);
    if (empty) {
      fb.T(q.empty ?? "NO DATA", (L + R) / 2, (top + base) / 2 + 8, C.or, { font: "hd", size: 24, align: "c", maxW: R - L - 20 });
      stampHi(fb, sb);
      return;
    }
    const lblW = Math.max(...bars.map((b) => fb.tw(b.label, "lab", 15)));
    const every = Math.max(1, Math.ceil((lblW + 4) / slot));
    bars.forEach((b, i) => {
      const cx = L + i * slot + slot / 2;
      const t = total(b);
      if (t > 0) fb.T(fmtv(b.value > 0 ? b.value : t), cx, base - H(t) - 5, colOf(b.tone === "red" ? "red" : undefined, C.am), { font: "val", size: 17, align: "c", maxW: Math.max(8, slot * 0.8), bg: C.k });
      if ((n - 1 - i) % every === 0) fb.T(b.label, cx, dh - 11, C.or, { font: "lab", size: 15, align: "c", maxW: slot * every - 2 });
    });
    stampHi(fb, sb);
  };

  const sig = JSON.stringify([p.bars, p.target, p.legend, p.empty, p.rev, p.stamp, (p.bars ?? []).map((b) => (p.format ? p.format(b.value) : ""))]);
  const srText =
    p.srText ?? ((p.bars ?? []).length ? [p.legend, p.target?.label, (p.bars ?? []).map((b) => `${b.label} ${p.format ? p.format(b.value) : Math.round(b.value)}`).join(", "), p.stamp?.text].filter(Boolean).join(". ") : p.empty ?? "NO DATA");
  return (
    <Raster
      id={id}
      label={p.label ?? p.legend ?? "BAR CHART"}
      srText={srText}
      dw={480}
      dh={dh}
      rows={rowsFor(dh, R_BARS)}
      draw={draw}
      deps={[sig]}
      animate={animate}
      post={p.id ? postLines({ ...p, id }, "HISTOGRAM R01", "COLUMN TEST ... OK", "HISTORY LOADED") : undefined}
    />
  );
}

// ---- e. PlatesPanel ---------------------------------------------------------------------------

export type PlateFace = "ok" | "warn" | "fault" | "work" | "dim" | "off";
export interface PlateSpec {
  tag: string;
  name: string;
  state: string;
  detail?: string;
  face: PlateFace;
  leds?: [boolean, boolean, boolean];
  gauge?: { lit: number; text: string };
}
export interface PlatesProps extends InstrumentBase {
  plates: PlateSpec[];
  verdict?: { word: string; tone: "grn" | "red" | "or" | "am"; line?: string };
  /** allow the working flicker on "work" plates (also needs the global flicker setting) */
  flicker?: boolean;
}

const PL_W = 224;
const PL_H = 172;
const PL_C = 20;
const PL_GAP = 12;
const PL_VH = 96;
const PL_FOOT = 42;

function platesGeometry(n: number, hasVerdict: boolean) {
  const rows = n > 2 ? 2 : 1;
  const out: { x: number; y: number; chamfer: "bottom" | "top" }[] = [];
  let y = 8;
  const row = (count: number, chamfer: "bottom" | "top") => {
    if (count === 1) out.push({ x: 128, y, chamfer });
    else {
      out.push({ x: 8, y, chamfer });
      out.push({ x: 248, y, chamfer });
    }
    y += PL_H;
  };
  row(Math.min(2, n), "bottom");
  let vy = -1;
  if (hasVerdict) {
    y += PL_GAP;
    vy = y;
    y += PL_VH + (rows === 2 ? PL_GAP : 0);
  } else if (rows === 2) y += PL_GAP * 2;
  if (rows === 2) row(n - 2, "top");
  return { plates: out, vy, bodyH: y + 8 };
}

export function PlatesPanel(p: PlatesProps) {
  const plates = p.plates.slice(0, 4);
  const geo = platesGeometry(plates.length, !!p.verdict);
  const dh = geo.bodyH + PL_FOOT;
  const working = plates.some((pl) => pl.face === "work") && (p.flicker ?? true) && FLICK && !GLIB.REDUCED;
  const animate = working ? true : p.stamp && p.stamp.blink ? "blink" : false;
  useRasterSettings(); // re-render when the flicker setting changes

  const draw = (fb: FB, G: GlibApi, fr: FrameInfo) => {
    fb.noClip();
    fb.cls(C.k);
    const bus = C.or;
    const busW = 12;
    const faces: { face: number; ink: number; tab: number; border: number }[] = [];
    // bus bars (drawn first; plates and the verdict box sit on top)
    const cxs = geo.plates.map((g) => g.x + PL_W / 2);
    if (geo.vy >= 0) {
      const midY = geo.vy + PL_VH / 2;
      geo.plates.forEach((g, i) => {
        const cx = cxs[i];
        if (g.chamfer === "bottom") fb.R(cx - busW / 2, g.y + PL_H - 4, busW, midY - (g.y + PL_H - 4), bus);
        else fb.R(cx - busW / 2, midY, busW, g.y + 4 - midY, bus);
      });
      fb.R(Math.min(...cxs), midY - busW / 2, Math.max(...cxs) - Math.min(...cxs), busW, bus);
    } else {
      // plates only: stubs between neighbours in a row, and between rows
      for (let i = 0; i + 1 < geo.plates.length; i++) {
        const a = geo.plates[i];
        const b = geo.plates[i + 1];
        if (a.y === b.y) fb.R(a.x + PL_W - 4, a.y + PL_H / 2 - busW / 2, b.x - (a.x + PL_W) + 8, busW, bus);
      }
      if (geo.plates.length > 2) {
        const y0 = geo.plates[0].y + PL_H - 4;
        const y1 = geo.plates[2].y + 4;
        for (const cx of new Set([cxs[0], cxs[1], ...cxs.slice(2)])) if (cx != null) fb.R(cx - busW / 2, y0, busW, y1 - y0, bus);
      }
    }
    plates.forEach((pl, i) => {
      const g = geo.plates[i];
      let face = C.blu;
      let ink = C.k;
      let border = C.or;
      let tab = C.blu;
      switch (pl.face) {
        case "ok":
          face = tab = C.grn;
          break;
        case "warn":
          face = tab = C.am;
          break;
        case "fault":
          face = tab = C.red;
          break;
        case "dim":
          face = C.dim;
          ink = C.am;
          tab = C.am;
          break;
        case "off":
          face = C.k;
          ink = C.gry;
          tab = C.gry;
          border = C.dim;
          break;
        default:
          face = tab = C.blu;
          if (pl.face === "work" && (p.flicker ?? true) && fr.flicker) {
            const r = Math.random();
            if (r < 0.4) {
              face = C.k;
              ink = C.blu;
            } else if (r < 0.55) face = C.wht;
          }
      }
      faces.push({ face, ink, tab, border });
      const pts = G.chamfer(g.x, g.y, PL_W, PL_H, PL_C, g.chamfer);
      G.plate(fb, pts, face, border);
      if (pl.face === "off") {
        const inner = pts.map(([x, y]) => [fb.ox + (x - (fb.dx || 0)) * fb.k, fb.oy + (y - (fb.dy || 0)) * fb.k]);
        fb.clip(fb.X(g.x) + 3, fb.Y(g.y) + 3, fb.X(g.x + PL_W) - 3, fb.Y(g.y + PL_H) - 3);
        const ins = G.insetPoly(inner, Math.max(2, fb.L(3)) + 2);
        fb.poly(ins, (x: number, y: number) => (G.bay(x, y) < 0.12 ? C.dim : C.k));
        fb.noClip();
      }
      const ty = g.y;
      const tx = g.x + (g.chamfer === "top" ? PL_C + 2 : 10);
      // id tab: black box
      const tw = Math.min(PL_W - 90, fb.tw(pl.tag, "hd", 18) + 14);
      fb.R(tx, ty + 9, tw, 24, C.k);
      // LEDs: PWR / LNK / CPU (green / amber / red when lit)
      const leds = pl.leds ?? [pl.face !== "off", pl.face === "work", pl.face === "fault"];
      const lc = [C.grn, C.am, C.red];
      const lx = g.x + PL_W - (g.chamfer === "top" ? PL_C + 2 : 10) - 14;
      for (let k = 0; k < 3; k++) G.led(fb, lx - (2 - k) * 16, ty + 16, leds[k], lc[k], C.k);
      // rules + gauge
      const base = g.y;
      fb.fill(fb.X(g.x + 14), fb.Y(base + 88), fb.X(g.x + PL_W - 14) - fb.X(g.x + 14), 1, ink);
      if (pl.gauge) {
        fb.fill(fb.X(g.x + 14), fb.Y(base + 132), fb.X(g.x + PL_W - 14) - fb.X(g.x + 14), 1, ink);
        G.gauge(fb, g.x + 18, base + 138, PL_W - 104, 14, 10, clamp(Math.round(pl.gauge.lit), 0, 10), ink, ink);
      }
    });
    // verdict box
    let vb: { x: number; y: number; w: number; c: number } | null = null;
    if (p.verdict && geo.vy >= 0) {
      const c = p.verdict.tone === "grn" ? C.grn : p.verdict.tone === "red" ? C.red : p.verdict.tone === "am" ? C.am : C.or;
      const w = 250;
      const x = 240 - w / 2;
      fb.R(x, geo.vy, w, PL_VH, C.k);
      fb.F(x, geo.vy, w, PL_VH, c, Math.max(2, fb.L(3)));
      vb = { x, y: geo.vy, w, c };
    }
    const sb = stampLo(fb, p.stamp, 10, geo.bodyH + 2, 260, fr);
    fb.present();
    fb.hclear();

    plates.forEach((pl, i) => {
      const g = geo.plates[i];
      const { ink, tab } = faces[i];
      const base = g.y;
      const ty = g.y;
      const tx = g.x + (g.chamfer === "top" ? PL_C + 2 : 10);
      const cx = g.x + PL_W / 2;
      fb.T(pl.tag, tx + 7, ty + 28, tab, { font: "hd", size: 18, maxW: PL_W - 104 });
      fb.J(up(pl.name), cx, base + 76, ink, { fam: "gro", size: 36, align: "c", maxW: PL_W - 24 });
      fb.T(pl.state, cx, base + 109, ink, { font: "hd", size: 20, align: "c", maxW: PL_W - 24 });
      if (pl.detail) fb.T(pl.detail, cx, base + 126, ink, { font: "lab", size: 15, align: "c", maxW: PL_W - 24 });
      if (pl.gauge) fb.T(pl.gauge.text, g.x + PL_W - 18, base + 153, ink, { font: "val", size: 18, align: "r", maxW: 72 });
    });
    if (vb && p.verdict) {
      const hasLine = !!p.verdict.line;
      fb.J(up(p.verdict.word), 240, vb.y + (hasLine ? 56 : 66), vb.c, { fam: "jp", size: 50, sq: 0.8, weight: 900, align: "c", maxW: vb.w - 24 });
      if (hasLine) fb.T(p.verdict.line!, 240, vb.y + 83, C.am, { font: "lab", size: 15, align: "c", maxW: vb.w - 20 });
    }
    revText(fb, p.rev, 472, dh - 10, C.or, sb ? 472 - (sb.x + sb.w) - 16 : 240);
    stampHi(fb, sb);
  };

  const sig = plates.map((pl) => [pl.tag, pl.name, pl.state, pl.detail, pl.face, (pl.leds ?? []).join(","), pl.gauge?.lit, pl.gauge?.text].join("|")).join("~");
  const srText =
    p.srText ?? [...plates.map((pl) => `${pl.tag} ${pl.name}: ${pl.state}${pl.detail ? ", " + pl.detail : ""}${pl.gauge ? ", " + pl.gauge.text : ""}`), p.verdict ? `VERDICT ${p.verdict.word}${p.verdict.line ? ", " + p.verdict.line : ""}` : "", p.stamp?.text].filter(Boolean).join(". ");
  return (
    <Raster
      id={p.id}
      label={p.label ?? "STATUS NODES"}
      srText={srText}
      dw={480}
      dh={dh}
      rows={rowsFor(dh, R_PLATE)}
      draw={draw}
      deps={[sig, p.verdict?.word, p.verdict?.tone, p.verdict?.line, p.flicker, p.rev, p.stamp?.text, p.stamp?.tone, p.stamp?.blink]}
      animate={animate}
      post={postLines(p, "NODE BUS 1.00", `NODE 01-${String(plates.length).padStart(2, "0")} ONLINE`, "BUS READY")}
    />
  );
}

// ---- AlertBand (§8.11) ------------------------------------------------------------------------

const AL = {
  cur: null as string | null,
  q: null as string | null,
  timer: 0 as any,
  mounted: 0,
  subs: new Set<() => void>(),
};
function alEmit(): void {
  for (const fn of [...AL.subs]) fn();
}
function alShow(m: string): void {
  AL.cur = m;
  alEmit();
  AL.timer = setTimeout(() => {
    AL.cur = null;
    alEmit();
    if (AL.q) {
      const next = AL.q;
      AL.q = null;
      // a short hard gap so a queued alert reads as a new event
      AL.timer = setTimeout(() => alShow(next), 250);
    }
  }, 1600);
}

/** Raise the alert band (critical moments only). Visible 1.6 s; at most one queued; duplicates ignored. */
export function alertBand(message: string): void {
  const m = up(message).trim();
  if (!m || !AL.mounted) return;
  if (AL.cur === m || AL.q === m) return;
  if (AL.cur) {
    if (!AL.q) AL.q = m;
    return;
  }
  alShow(m);
}

/** Mount once at the app root. */
export function AlertBand() {
  const msg = useSyncExternalStore(
    (cb) => {
      AL.subs.add(cb);
      return () => {
        AL.subs.delete(cb);
      };
    },
    () => AL.cur,
  );
  const { flicker } = useRasterSettings();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fbRef = useRef<FB | null>(null);

  useEffect(() => {
    AL.mounted++;
    startClock();
    return () => {
      AL.mounted--;
      if (!AL.mounted) {
        clearTimeout(AL.timer);
        AL.cur = null;
        AL.q = null;
      }
      if (fbRef.current) {
        fbRef.current.destroy();
        fbRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!msg || !hostRef.current) return;
    if (!fbRef.current) fbRef.current = new GLIB.FB(hostRef.current, { rows: 44, solo: true, native: true });
    const fb = fbRef.current;
    fb.W = 0;
    if (fb.layout()) {
      GLIB.hexField(fb);
      fb.present();
    }
  }, [msg]);

  const steady = !flicker || GLIB.REDUCED;
  return (
    <>
      <div className={msg ? "mg-alert show" : "mg-alert"} aria-hidden="true" style={msg && steady ? { visibility: "visible" } : undefined}>
        <div className="afb" ref={hostRef} />
        <div className="plate" style={{ maxWidth: "calc(100vw - 16px)" }}>
          <span className="e" style={{ minWidth: 0 }}>
            <b>WARNING</b>
            <span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{msg ?? ""}</span>
          </span>
        </div>
      </div>
      <div className="mg-sr" role="alert" style={SR_STYLE}>
        {msg ? `WARNING: ${msg}` : ""}
      </div>
    </>
  );
}
