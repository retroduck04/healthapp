// Shared UI building blocks.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fmt } from "../engine/units";
import type { Settings } from "../db/types";

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

// ---- layout -----------------------------------------------------------------

export function Sheet(props: { title: string; onClose: () => void; right?: ReactNode; footer?: ReactNode; children?: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <>
      <div className="sheet-backdrop" onClick={props.onClose} />
      <div className="sheet" role="dialog" aria-label={props.title}>
        <div className="sheet-head">
          <div>
            <button className="link" onClick={props.onClose}>
              Close
            </button>
          </div>
          <div className="title">{props.title}</div>
          <div className="right">{props.right}</div>
        </div>
        <div className="sheet-body">{props.children}</div>
        {props.footer ? <div className="sheet-foot">{props.footer}</div> : null}
      </div>
    </>
  );
}

export function Card(props: { title?: ReactNode; aside?: ReactNode; children?: ReactNode; tight?: boolean; onClick?: () => void }) {
  return (
    <div className={props.tight ? "card tight" : "card"} onClick={props.onClick} style={props.onClick ? { cursor: "pointer" } : undefined}>
      {props.title || props.aside ? (
        <div className="card-head">
          <div className="title">{props.title}</div>
          <div className="muted small">{props.aside}</div>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{props.label}</div>
      <div className="value">{props.value}</div>
      {props.sub ? <div className="muted small">{props.sub}</div> : null}
    </div>
  );
}

export function Field(props: { label: string; children?: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
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
      <button aria-label={`decrease ${props.label ?? ""}`} onClick={() => move(-1)}>
        −
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
      <button aria-label={`increase ${props.label ?? ""}`} onClick={() => move(1)}>
        +
      </button>
    </div>
  );
}

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
          key={String(o.value)}
          className={o.value === props.value ? "chip on" : "chip"}
          onClick={() => props.onChange(o.value === props.value && props.allowNone ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>(props: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? "on" : ""} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar(props: { value: number; max: number }) {
  const pct = props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0;
  return (
    <div className={props.max > 0 && props.value > props.max * 1.03 ? "bar over" : "bar"}>
      <div style={{ width: `${pct}%` }} />
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

// ---- icons ------------------------------------------------------------------

const icon = (d: string) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const Icons = {
  today: icon("M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"),
  food: icon("M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 7h4M17 3c-1.7 0-3 2-3 5s1 4 3 4v9"),
  train: icon("M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12"),
  sleep: icon("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"),
  progress: icon("M4 19h16M6 16l4-5 3 3 5-7"),
  gear: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3.5h-4l-.3 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4z"),
  chevron: icon("M9 6l6 6-6 6"),
  back: icon("M15 6l-6 6 6 6"),
};

export const fmtKcal = (v: number) => Math.round(v).toLocaleString("en-CA");
export const fmtG = (v: number) => `${Math.round(v)} g`;
