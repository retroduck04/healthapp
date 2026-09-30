// Shared UI building blocks, drawn in the MAGI console language (see src/magi/base.css).
//
// Conventions for screens:
//   - Card = a subsystem panel (.mg-panel.mg-brk): inverse S# tag (CSS counter per page), uppercase
//     title, amber status on the right. `tone` = "red" (one diagnostic panel) | "dbl" (decision panel).
//     `flush` removes the body padding (raster hosts, log rows).
//   - Class "uc" (user case) marks anything the user typed or owns (food, meal, exercise and template
//     names, notes): it keeps its case and is set in white. Everything else is uppercase system voice.
//   - toast(): SYS> notice under the header; a message starting with "ERR" becomes a FAULT> notice.
//   - confirmScreen()/promptScreen() replace window.confirm/alert/prompt with full-screen terminals.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GarminStatus } from "../db/garmin";
import type { Settings } from "../db/types";
import { fmt } from "../engine/units";

// ---- app context ------------------------------------------------------------

export type Tab = "today" | "food" | "train" | "sleep" | "progress";

export type SheetRequest =
  | { kind: "weight" }
  | { kind: "checkin"; day?: string }
  | { kind: "food"; day: string; meal: string }
  | { kind: "caffeine" }
  | { kind: "cardio"; id?: string }
  | { kind: "quick" }
  | { kind: "settings" };

export interface UI {
  settings: Settings;
  tab: Tab;
  goTab: (t: Tab) => void;
  open: (s: SheetRequest) => void;
  close: () => void;
  toast: (message: string, undo?: () => void) => void;
}

export const UIContext = createContext<UI | null>(null);

export function useUI(): UI {
  const ui = useContext(UIContext);
  if (!ui) throw new Error("UI context missing");
  return ui;
}

// ---- screen stack -----------------------------------------------------------
// Full-screen terminal screens can stack (a confirm over a sheet). Escape/Enter go to the topmost only.

const screenStack: object[] = [];
const isTopScreen = (tok: object) => screenStack[screenStack.length - 1] === tok;
let keyboardUser = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (keyboardUser = true), true);
  window.addEventListener("pointerdown", () => (keyboardUser = false), true);
}

/** Registers a screen: body scroll lock, focus into the screen, focus back on close (keyboard users). */
function enterScreen(el: HTMLElement | null, tok: object): () => void {
  screenStack.push(tok);
  const prevFocus = document.activeElement as HTMLElement | null;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  return () => {
    const i = screenStack.indexOf(tok);
    if (i >= 0) screenStack.splice(i, 1);
    document.body.style.overflow = prevOverflow;
    if (keyboardUser && prevFocus && prevFocus !== document.body && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  };
}

/** Enter in a field (not a textarea, button or select) presses the screen's primary key. */
function enterPressesPrimary(e: KeyboardEvent, primary: () => HTMLElement | null | undefined): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.isComposing) return false;
  const t = e.target as HTMLElement | null;
  if (t && /^(TEXTAREA|BUTTON|SELECT|A)$/.test(t.tagName)) return false;
  const p = primary();
  if (!p) return false;
  e.preventDefault();
  p.click();
  return true;
}

// ---- layout -----------------------------------------------------------------

/**
 * Full-screen terminal screen (protocol §8.16): 40 px header "► JANOS-SYS/<TITLE>" with [ESC] BACK,
 * scrolling body, optional footer (its LAST enabled button is the [ENTER] key), 24 px key-hint strip.
 */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  right?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Amber status in the header (e.g. "AUTO-SAVE"). */
  status?: ReactNode;
  /** Replaces the key-hint strip. */
  keys?: string[];
  /** Word after [ENTER] in the hint strip when there is a footer (default "SAVE"). */
  enterLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const foot = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useEffect(() => {
    const tok = {};
    const leave = enterScreen(ref.current, tok);
    const onKey = (e: KeyboardEvent) => {
      if (!isTopScreen(tok)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      enterPressesPrimary(e, () => {
        const btns = foot.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        return btns && btns.length ? btns[btns.length - 1] : null;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      leave();
    };
  }, []);
  const keys = props.keys ?? (props.footer ? ["[ESC] BACK", `[ENTER] ${props.enterLabel ?? "SAVE"}`] : ["[ESC] BACK"]);
  return (
    <div className={`mg-screen sheet${props.className ? ` ${props.className}` : ""}`} role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
      <div className="mg-scr-h sheet-head">
        <span className="ttl">► JANOS-SYS/{props.title}</span>
        {props.status ? <span className="st">{props.status}</span> : null}
        <span className="sp" />
        {props.right}
        <button type="button" className="mg-key" onClick={props.onClose}>
          [ESC] BACK
        </button>
      </div>
      <div className="mg-scr-b sheet-body">{props.children}</div>
      {props.footer ? (
        <div className="sheet-foot" ref={foot}>
          {props.footer}
        </div>
      ) : null}
      <div className="mg-keys sheet-keys" aria-hidden="true">
        {keys.map((k) => (
          <span key={k}>{k}</span>
        ))}
      </div>
    </div>
  );
}

/** Page title strip: "► JANOS-SYS/<SYS>" with an amber status on the right. */
export function PageTitle(props: { sys: string; status?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-title">
      <h1>► JANOS-SYS/{props.sys}</h1>
      {props.status != null && props.status !== false ? <span className="st">{props.status}</span> : null}
      {props.children}
    </div>
  );
}

/**
 * Subsystem panel (protocol §8.2). Backward compatible with the old card: title, aside, tight, onClick.
 * New: tone ("red" diagnostic identity, "dbl" double rule), status (alias of aside), flush (no body
 * padding; use it for raster hosts and log rows), rev (micro revision label, e.g. "BODYMASS MOD 1.04"),
 * help (explanation kept out of the way behind a [?] key in the bar; shown at the bottom when opened).
 */
export function Card(props: {
  title?: ReactNode;
  aside?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
  tight?: boolean;
  flush?: boolean;
  onClick?: () => void;
  tone?: "red" | "dbl";
  rev?: ReactNode;
  className?: string;
  id?: string;
  ariaLabel?: string;
  help?: ReactNode;
}) {
  const aside = props.status ?? props.aside;
  const [helpOpen, setHelpOpen] = useState(false);
  const cls = ["card", "mg-panel", "mg-brk", props.tone, props.tight || props.flush ? "flush" : "", props.onClick ? "click" : "", props.className]
    .filter(Boolean)
    .join(" ");
  const click = props.onClick
    ? {
        role: "button",
        tabIndex: 0,
        onClick: props.onClick,
        onKeyDown: (e: any) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            props.onClick?.();
          }
        },
      }
    : {};
  return (
    <section className={cls} id={props.id} aria-label={props.ariaLabel} {...click}>
      {props.title || aside ? (
        <div className="mg-bar">
          <b className="tag" aria-hidden="true" />
          <span className="t">{props.title}</span>
          {aside ? <span className="st">{aside}</span> : null}
          {props.help ? (
            <button
              type="button"
              className={helpOpen ? "link help-key on" : "link help-key"}
              aria-expanded={helpOpen}
              aria-label="explain this panel"
              onClick={(e: any) => {
                e.stopPropagation();
                setHelpOpen(!helpOpen);
              }}
              onKeyDown={(e: any) => e.stopPropagation()}
            >
              ?
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="card-body">
        {props.children}
        {props.help && helpOpen ? <div className={props.tight || props.flush ? "desc pad help" : "desc help"}>{props.help}</div> : null}
      </div>
      {props.rev ? <div className="rev">{props.rev}</div> : null}
    </section>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{props.label}</div>
      <div className="value">{props.value}</div>
      {props.sub ? <div className="sub">{props.sub}</div> : null}
    </div>
  );
}

export function Field(props: { label: ReactNode; children?: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <em className="hint">{props.hint}</em> : null}
    </label>
  );
}

// ---- inputs -----------------------------------------------------------------

export function parseNum(s: string): number | null {
  const n = Number(s.replace(",", ".").trim());
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
}

/** Text input bound to a number (null when empty). */
export function NumInput(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  big?: boolean;
  decimals?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(props.value === null ? "" : String(props.value));
  useEffect(() => {
    if (parseNum(text) !== props.value) setText(props.value === null ? "" : String(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <input
      className={props.big ? "input big" : "input"}
      inputMode={props.decimals === false ? "numeric" : "decimal"}
      value={text}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      onFocus={(e: any) => {
        // Typing replaces a prefilled number instead of appending to it (iOS needs the deferred select).
        const el = e.target as HTMLInputElement;
        setTimeout(() => el.select?.(), 0);
      }}
      onChange={(e: any) => {
        setText(e.target.value);
        props.onChange(parseNum(e.target.value));
      }}
    />
  );
}

export function Stepper(props: {
  value: number;
  onChange: (v: number) => void;
  values?: number[];
  step?: number;
  min?: number;
  unit?: string;
  label?: string;
}) {
  const [text, setText] = useState(fmt(props.value, 2));
  useEffect(() => setText(fmt(props.value, 2)), [props.value]);
  const move = (dir: 1 | -1) => {
    let next: number;
    if (props.values && props.values.length) {
      const vs = props.values;
      if (dir > 0) next = vs.find((v) => v > props.value + 1e-9) ?? props.value;
      else next = [...vs].reverse().find((v) => v < props.value - 1e-9) ?? props.value;
    } else {
      next = props.value + dir * (props.step ?? 1);
    }
    if (props.min !== undefined) next = Math.max(props.min, next);
    props.onChange(Math.round(next * 100) / 100);
  };
  return (
    <div className="stepper" aria-label={props.label}>
      <button type="button" aria-label={`decrease ${props.label ?? ""}`} onClick={() => move(-1)}>
        [−]
      </button>
      <div className="value">
        <input
          inputMode="decimal"
          aria-label={props.label}
          value={text}
          onChange={(e: any) => {
            setText(e.target.value);
            const n = parseNum(e.target.value);
            if (n !== null) props.onChange(n);
          }}
        />
        {props.unit ? <div className="unit">{props.unit}</div> : null}
      </div>
      <button type="button" aria-label={`increase ${props.label ?? ""}`} onClick={() => move(1)}>
        [+]
      </button>
    </div>
  );
}

/** Toggle keys; the selected key is amber (aria-pressed). */
export function Chips<T extends string | number>(props: {
  options: { value: T; label: string }[];
  value: T | null | undefined;
  onChange: (v: T | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="chips">
      {props.options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          className={o.value === props.value ? "chip on" : "chip"}
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value === props.value && props.allowNone ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Key row; the active key is inverse. */
export function Segmented<T extends string>(props: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group">
      {props.options.map((o) => (
        <button type="button" key={o.value} className={o.value === props.value ? "on" : ""} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text checkbox: [X] / [ ]. */
export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={props.checked} className="mg-cbx" onClick={() => props.onChange(!props.checked)}>
      <span className="box" aria-hidden="true">
        {props.checked ? "[X]" : "[ ]"}
      </span>
      <span className="lab">{props.label}</span>
    </button>
  );
}

/** Segmented cell meter: hollow cells, lit cells amber, all red when over (value > 103 % of max). */
export function ProgressBar(props: { value: number; max: number; cells?: number }) {
  const n = props.cells ?? 20;
  const frac = props.max > 0 ? Math.max(0, props.value / props.max) : 0;
  const over = props.max > 0 && props.value > props.max * 1.03;
  const lit = frac > 0 ? Math.max(1, Math.min(n, Math.round(Math.min(1, frac) * n))) : 0;
  return (
    <div
      className={over ? "bar over" : "bar"}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={Math.round(props.max)}
      aria-valuenow={Math.round(props.value)}
    >
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < lit ? "on" : undefined} />
      ))}
    </div>
  );
}

// ---- charts -----------------------------------------------------------------

export interface XY {
  x: number;
  y: number;
}

/** Simple responsive time-series chart: dots (observations), lines (trends) and an optional band. */
export function LineChart(props: {
  dots?: (XY & { flag?: boolean })[];
  lines?: XY[][];
  band?: { x: number; lo: number; hi: number }[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  yPad?: number;
}) {
  const W = 340;
  const H = props.height ?? 180;
  const left = 38;
  const right = 8;
  const top = 10;
  const bottom = 22;
  const all = useMemo(() => {
    const pts: XY[] = [...(props.dots ?? []), ...(props.lines ?? []).flat()];
    for (const b of props.band ?? []) pts.push({ x: b.x, y: b.lo }, { x: b.x, y: b.hi });
    return pts;
  }, [props.dots, props.lines, props.band]);
  if (all.length === 0) return <div className="empty small">No data yet.</div>;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  if (x1 === x0) {
    x0 -= 1;
    x1 += 1;
  }
  const pad = props.yPad ?? 0.5;
  let y0 = Math.min(...ys) - pad;
  let y1 = Math.max(...ys) + pad;
  const span = y1 - y0;
  const step = niceStep(span / 4);
  y0 = Math.floor(y0 / step) * step;
  y1 = Math.ceil(y1 / step) * step;
  const X = (x: number) => left + ((x - x0) / (x1 - x0)) * (W - left - right);
  const Y = (y: number) => top + (1 - (y - y0) / (y1 - y0)) * (H - top - bottom);
  const ticks: number[] = [];
  for (let v = y0; v <= y1 + 1e-9; v += step) ticks.push(v);
  const yf = props.yFormat ?? ((v: number) => fmt(v, 1));
  const xf = props.xFormat ?? ((v: number) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  const path = (pts: XY[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ");
  const band = props.band ?? [];
  const bandPath = band.length
    ? `${band.map((b, i) => `${i ? "L" : "M"}${X(b.x).toFixed(1)} ${Y(b.hi).toFixed(1)}`).join(" ")} ${[...band]
        .reverse()
        .map((b) => `L${X(b.x).toFixed(1)} ${Y(b.lo).toFixed(1)}`)
        .join(" ")} Z`
    : "";
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={left} x2={W - right} y1={Y(t)} y2={Y(t)} />
          <text x={left - 6} y={Y(t) + 4} textAnchor="end">
            {yf(t)}
          </text>
        </g>
      ))}
      <text x={left} y={H - 6}>
        {xf(x0)}
      </text>
      <text x={W - right} y={H - 6} textAnchor="end">
        {xf(x1)}
      </text>
      {bandPath ? <path className="band" d={bandPath} /> : null}
      {(props.dots ?? []).map((d, i) => (
        <circle key={i} className={d.flag ? "dot suspect" : "dot"} cx={X(d.x)} cy={Y(d.y)} r={d.flag ? 3.5 : 2.6} />
      ))}
      {(props.lines ?? []).map((l, i) => (l.length > 1 ? <path key={i} className="trend" d={path(l)} /> : null))}
    </svg>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function BarChart(props: { bars: { label: string; value: number }[]; height?: number; format?: (v: number) => string }) {
  const W = 340;
  const H = props.height ?? 140;
  const max = Math.max(1, ...props.bars.map((b) => b.value));
  const bw = (W - 10) / Math.max(props.bars.length, 1);
  const fmtv = props.format ?? ((v: number) => String(Math.round(v)));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {props.bars.map((b, i) => {
        const h = ((H - 34) * b.value) / max;
        const x = 5 + i * bw + bw * 0.18;
        return (
          <g key={i}>
            <rect className="bar-rect" x={x} y={H - 20 - h} width={bw * 0.64} height={Math.max(h, 0)} rx={3} />
            {b.value > 0 ? (
              <text x={x + bw * 0.32} y={H - 24 - h} textAnchor="middle">
                {fmtv(b.value)}
              </text>
            ) : null}
            <text x={x + bw * 0.32} y={H - 6} textAnchor="middle">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---- glyphs -----------------------------------------------------------------
// The SVG icon set is gone: the console uses text glyphs only.

export const Icons = {
  today: "01",
  food: "02",
  train: "03",
  sleep: "04",
  progress: "05",
  gear: "CONFIG",
  chevron: "►",
  back: "◄",
};

export const fmtKcal = (v: number) => Math.round(v).toLocaleString("en-CA");
export const fmtG = (v: number) => `${Math.round(v)} g`;

// ---- full-screen confirm / alert / prompt ------------------------------------

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Word on the confirm key (default "CONFIRM"). */
  confirmLabel?: string;
  /** Destructive: red WARNING plate and red confirm key; the destructive hook fires (the alert band). */
  danger?: boolean;
  /** With danger: set false to keep the red key but NOT fire the destructive hook (alert band budget). */
  alarm?: boolean;
  /** Word on the cancel key (default "CANCEL"); false = acknowledge-only screen (replaces alert()). */
  cancelLabel?: string | false;
}

let destructiveHook: ((info: ConfirmOptions) => void) | null = null;

/** Called by confirmScreen() whenever `danger` is true and `alarm` is not false (wire the alert band here). */
export function setDestructiveHook(fn: ((info: ConfirmOptions) => void) | null): void {
  destructiveHook = fn;
}

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Builds a terminal screen in plain DOM (usable from any handler, outside React). */
function domScreen(title: string, backLabel: string, strip: string[], role = "dialog") {
  const root = h("div", "mg-screen sheet top-screen");
  root.setAttribute("role", role);
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", title);
  root.tabIndex = -1;
  const head = h("div", "mg-scr-h sheet-head");
  head.append(h("span", "ttl", `► JANOS-SYS/${title}`), h("span", "sp"));
  const back = h("button", "mg-key", backLabel) as HTMLButtonElement;
  back.type = "button";
  head.append(back);
  const body = h("div", "mg-scr-b sheet-body");
  const foot = h("div", "sheet-foot");
  const keys = h("div", "mg-keys sheet-keys");
  keys.setAttribute("aria-hidden", "true");
  for (const k of strip) keys.append(h("span", undefined, k));
  root.append(head, body, foot, keys);
  return { root, back, body, foot };
}

function runScreen<T>(
  build: (done: (v: T) => void) => { root: HTMLElement; focus?: HTMLElement | null; onEnter: () => void; onEscape: () => void },
): Promise<T> {
  return new Promise<T>((resolve) => {
    const tok = {};
    let leave: () => void = () => {};
    let finished = false;
    const done = (v: T) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("keydown", onKey);
      s.root.remove();
      leave();
      resolve(v);
    };
    const s = build(done);
    const onKey = (e: KeyboardEvent) => {
      if (!isTopScreen(tok)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        s.onEscape();
      } else enterPressesPrimary(e, () => ({ click: s.onEnter }) as unknown as HTMLElement);
    };
    document.body.append(s.root);
    leave = enterScreen(s.root, tok);
    if (s.focus) s.focus.focus({ preventScroll: true });
    // Listen after the current event (the click or key that opened this screen) has finished.
    window.setTimeout(() => !finished && window.addEventListener("keydown", onKey), 0);
  });
}

/** MAGI replacement for window.confirm (and, with cancelLabel: false, window.alert). */
export function confirmScreen(opts: ConfirmOptions): Promise<boolean> {
  if (opts.danger && opts.alarm !== false) {
    try {
      destructiveHook?.(opts);
    } catch (e) {
      console.warn("destructive hook failed", e);
    }
  }
  const okWord = opts.confirmLabel ?? "CONFIRM";
  const cancelWord = opts.cancelLabel === false ? null : opts.cancelLabel ?? "CANCEL";
  const strip = cancelWord ? [`[ESC] ${cancelWord}`, `[ENTER] ${okWord}`] : [`[ENTER] ${okWord}`];
  return runScreen<boolean>((done) => {
    const s = domScreen(opts.title, cancelWord ? `[ESC] ${cancelWord}` : "[ESC] CLOSE", strip, "alertdialog");
    s.root.classList.add("confirm-screen");
    // Plate word: WARNING (destructive), FAULT (an ERR message), NOTICE (acknowledge-only), CONFIRM.
    const fault = /^ERR/.test(opts.message);
    const plate = h("div", `warn-plate${opts.danger || fault ? " danger" : ""}`);
    const word = h("b", "mg-sq", opts.danger ? "WARNING" : fault ? "FAULT" : cancelWord ? "CONFIRM" : "NOTICE");
    const msg = h("p", "msg", opts.message);
    msg.id = `cf-${Date.now()}`;
    s.root.setAttribute("aria-describedby", msg.id);
    plate.append(word, msg);
    const wait = h("p", "await", "AWAITING OPERATOR INPUT ");
    wait.append(h("span", "mg-cursor"));
    s.body.append(plate, wait);
    const grid = h("div", cancelWord ? "grid-2" : "keycol");
    const ok = h("button", `${opts.danger ? "btn danger fill" : "btn"}${cancelWord ? "" : " block"}`, `[ENTER] ${okWord}`) as HTMLButtonElement;
    ok.type = "button";
    ok.onclick = () => done(true);
    if (cancelWord) {
      const no = h("button", "btn plain", `[ESC] ${cancelWord}`) as HTMLButtonElement;
      no.type = "button";
      no.onclick = () => done(false);
      grid.append(no);
    }
    grid.append(ok);
    s.foot.append(grid);
    s.back.onclick = () => done(!cancelWord);
    return { root: s.root, onEnter: () => done(true), onEscape: () => done(!cancelWord) };
  });
}

/** MAGI replacement for window.prompt: resolves to the typed text, or null when cancelled. */
export function promptScreen(opts: { title: string; label: string; initial?: string; confirmLabel?: string }): Promise<string | null> {
  const okWord = opts.confirmLabel ?? "SAVE";
  return runScreen<string | null>((done) => {
    const s = domScreen(opts.title, "[ESC] CANCEL", ["[ESC] CANCEL", `[ENTER] ${okWord}`]);
    const label = h("label", "field");
    const input = h("input", "input") as HTMLInputElement;
    input.value = opts.initial ?? "";
    input.autocomplete = "off";
    label.append(h("span", undefined, opts.label), input);
    s.body.append(label);
    const grid = h("div", "grid-2");
    const no = h("button", "btn plain", "[ESC] CANCEL") as HTMLButtonElement;
    no.type = "button";
    no.onclick = () => done(null);
    const ok = h("button", "btn", `[ENTER] ${okWord}`) as HTMLButtonElement;
    ok.type = "button";
    ok.onclick = () => done(input.value);
    grid.append(no, ok);
    s.foot.append(grid);
    s.back.onclick = () => done(null);
    window.setTimeout(() => input.select(), 0);
    return { root: s.root, focus: input, onEnter: () => done(input.value), onEscape: () => done(null) };
  });
}

// ---- display preferences (read by the raster instruments) -------------------------

export type Density = "coarse" | "medium" | "fine";

/** localStorage janos.flicker ("1"/"0", default "1") and janos.density (default "medium"). */
export function readDisplayPrefs(): { flicker: boolean; density: Density } {
  let flicker = "1";
  let density = "medium";
  try {
    flicker = localStorage.getItem("janos.flicker") ?? "1";
    density = localStorage.getItem("janos.density") ?? "medium";
  } catch {
    /* private mode */
  }
  return { flicker: flicker !== "0", density: density === "coarse" || density === "fine" ? density : "medium" };
}

/** Stores one display preference and announces it with a "janos-display" window event. */
export function writeDisplayPref(key: "flicker" | "density", value: string): void {
  try {
    localStorage.setItem(`janos.${key}`, value);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("janos-display"));
}

// ---- Garmin link state -------------------------------------------------------------

export type LinkLamp = "on" | "warn" | "off";

/** Maps a sync status message to the code table. */
export function garminMessageCode(message: string | null | undefined): string | null {
  if (!message) return null;
  if (/match|unlock/i.test(message)) return "ERR 001 GARMIN LINK KEY MISMATCH";
  const http = /HTTP (\d+)/i.exec(message);
  if (http) return `ERR 003 GARMIN LINK UNREACHABLE · HTTP ${http[1]}`;
  if (/offline|unreachable|network|fetch/i.test(message)) return "ERR 003 GARMIN LINK UNREACHABLE";
  if (/waiting|first/i.test(message)) return "PROC 004 AWAITING FIRST GARMIN SYNC";
  return message.toUpperCase();
}

/** Header lamp: green LINK (< 12 h), amber STALE / AWAITING, red FAULT (no key or key mismatch). */
export function garminLink(key: string | null, status: GarminStatus | null, now = Date.now()): { lamp: LinkLamp; label: string; code: string | null } {
  const code = garminMessageCode(status?.message);
  if (!key) return { lamp: "off", label: "FAULT", code: "!! GARMIN LINK NOT CONFIGURED" };
  if (code?.startsWith("ERR 001")) return { lamp: "off", label: "FAULT", code };
  if (!status?.lastSuccess) return { lamp: "warn", label: "AWAITING", code: code ?? "PROC 004 AWAITING FIRST GARMIN SYNC" };
  if (now - status.lastSuccess >= 12 * 3600000) return { lamp: "warn", label: "STALE", code: code ?? "WARN 002 GARMIN DATA STALE" };
  return { lamp: "on", label: "LINK", code };
}
