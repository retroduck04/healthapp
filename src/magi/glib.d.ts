// Loose typings for the GLIB raster library (glib.js, an ES module). Import with:
//   import { GLIB } from "../magi/glib";
// Everything is intentionally permissive; see glib.js for behaviour.

export type PaletteName =
  | "k" | "ink" | "or" | "orb" | "am" | "yel" | "grn" | "red" | "wht" | "gry" | "dgy" | "dim" | "dim2"
  | "blu" | "cya" | "dbl" | "tea" | "dred" | "dgrn" | "dcya" | "dblu" | "bdim"
  /** severity ramp (hard bands r1 < r2 < r3 < red) */
  | "r1" | "r2" | "r3";

/** Text options for FB.T / fitT / TD. y is the baseline. Sizes are design units. */
export interface TextOpts {
  font?: "rom" | "big" | "data" | "micro" | "lab" | "val" | "hd" | string;
  big?: boolean;
  align?: "l" | "c" | "r";
  maxW?: number;
  size?: number;
  bg?: number;
  [k: string]: any;
}

/** Display type options for FB.J (squeezed display serif by default, fam:"gro" for squeezed grotesque). */
export interface DisplayOpts {
  fam?: "jp" | "gro" | "nar" | "mono" | string;
  size?: number;
  sq?: number;
  weight?: number;
  align?: "l" | "c" | "r";
  maxW?: number;
  [k: string]: any;
}

export interface FB {
  host: HTMLElement;
  o: any;
  lo: HTMLCanvasElement;
  hi: HTMLCanvasElement;
  hits: HTMLDivElement;
  W: number;
  H: number;
  k: number;
  kh: number;
  ox: number;
  oy: number;
  devPx: number;
  dpr: number;
  buf: Uint8Array | null;
  focus: string | null;
  onFocus: (() => void) | null;
  destroyed?: boolean;
  [k: string]: any;
  layout(): boolean;
  destroy(): void;
  X(x: number): number;
  Y(y: number): number;
  L(v: number): number;
  hx(x: number): number;
  hy(y: number): number;
  noClip(): void;
  clip(x0: number, y0: number, x1: number, y1: number): void;
  cls(c?: number): void;
  saveBg(): void;
  restore(): void;
  p(x: number, y: number, c: number): void;
  fill(x: number, y: number, w: number, h: number, c: number): void;
  frame(x: number, y: number, w: number, h: number, c: number, t?: number): void;
  line(x0: number, y0: number, x1: number, y1: number, c: number, t?: number, pat?: number, plen?: number): void;
  poly(pts: number[][], c: number | ((x: number, y: number) => number)): void;
  dither(x: number, y: number, w: number, h: number, c: number, level: number): void;
  R(x: number, y: number, w: number, h: number, c: number): void;
  F(x: number, y: number, w: number, h: number, c: number, t?: number): void;
  P(pts: number[][], c: number | ((x: number, y: number) => number)): void;
  Ln(x0: number, y0: number, x1: number, y1: number, c: number, t?: number, pat?: number, plen?: number): void;
  s(n: number): number;
  present(): void;
  hclear(): void;
  tw(str: string, font?: string, size?: number): number;
  TD(str: string, hxD: number, hyD: number, c: number, o?: any): number;
  T(str: string, x: number, y: number, c: number, o?: TextOpts): number;
  fitT(str: string, x: number, y: number, c: number, maxW: number, o?: TextOpts): number;
  J(str: string, x: number, y: number, c: number, o?: DisplayOpts): number;
  hit(id: string, x: number, y: number, w: number, h: number, label: string, fn: (e: Event) => void, o?: { pressed?: boolean }): HTMLButtonElement;
  toDesign(cx: number, cy: number): number[];
}

export interface GlibApi {
  PAL: [string, string][];
  C: Record<PaletteName, number> & Record<string, number>;
  HEX: string[];
  paletteToCSS(): void;
  bay(x: number, y: number): number;
  FAM: Record<string, string>;
  ROLE: Record<string, { fam: string; w: number; size: number; min: number; sq: number }>;
  romSafe(s: unknown): string;
  measureTxt(str: string, fam: string, weight: number, px: number): number;
  clearTextCache(): void;
  GL: { fbs: FB[]; dens: number };
  DENSITY: Record<"coarse" | "medium" | "fine", number>;
  setDensity(name: string): void;
  FB: new (host: HTMLElement, o?: { rows?: number; dw?: number; dh?: number; native?: boolean; solo?: boolean; devPx?: number; dx?: number; dy?: number }) => FB;
  drawDigit(fb: FB, ch: string, x: number, y: number, w: number, h: number, t: number, on: number, off: number): void;
  readout7(fb: FB, str: string, x: number, y: number, dw: number, dh: number, gap: number, on?: number, off?: number): number;
  bandFn(fb: FB, x0: number, y0: number, w: number, h: number, cols?: number[], stops?: number[], skew?: number): (x: number, y: number) => number;
  segMeter(fb: FB, x: number, y: number, w: number, h: number, n: number, lit: number, o?: { band?: (i: number) => number; color?: number; peak?: number }): void;
  insetPoly(pts: number[][], d: number): number[][];
  plate(fb: FB, pts: number[][], face?: number, border?: number): void;
  chamfer(x: number, y: number, w: number, h: number, c: number, where?: "bottom" | "top"): number[][];
  stamp(fb: FB, x: number, y: number, w: number, h: number, c: number): void;
  led(fb: FB, x: number, y: number, on: boolean, col: number, frameCol?: number): void;
  hexField(fb: FB): void;
  arrow(fb: FB, x: number, y: number, s: number, dir: "l" | "r" | "u" | "d", c: number): void;
  gauge(fb: FB, x: number, y: number, w: number, h: number, n: number, lit: number, on: number, base?: number): number;
  FRAME: { f: number; fps: number; ms: number; subs: Set<(f: number, t: number) => void>; timer: any };
  startFrameClock(): void;
  onFrame(fn: (f: number, t: number) => void): () => void;
  blinkState(f?: number): { b2: boolean; b4: boolean };
  autoLayout(fb: FB, redraw: () => void): ResizeObserver;
  REDUCED: boolean;
  clamp(v: number, a: number, b: number): number;
}

export const GLIB: GlibApi;
export default GLIB;
