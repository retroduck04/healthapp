// Training load: fitness/fatigue (CTL/ATL/TSB), acute:chronic ratio, session-load estimates and daily targets.
//
// Refinements to the brief (documented deviations):
// - acute/chronic are bias-corrected EWMAs (divided by 1 − (1 − λ)^n, n = days of history), so a new user
//   with a steady load sees a ratio ≈ 1 instead of a false spike while the 28-day average fills in.
//   CTL/ATL keep the TrainingPeaks convention of starting from 0.
// - acute/chronic are loads per DAY; multiply by 7 for Garmin-style "7-day acute load" figures.
// - The EWMAs warm up from the earlier of startDay and the first item day; output begins at startDay.
// - LoadDay gains `estimated` (any item that day was an estimate).
// - intensityFocus takes Garmin `zonesSec` arrays (seconds, index 0 = zone 1) by default; pass "min" for minutes.
// - estimatedMaxHR (Tanaka 2001) added: cardioLoadEstimate needs the user's HRmax, not a session's max HR.

import { dayNumber, fromDayNumber, type ISODate } from "./dates";

export interface LoadItem {
  day: ISODate;
  load: number;
  estimated?: boolean;
}

export interface LoadDay {
  day: ISODate;
  load: number; // summed load of the day
  atl: number; // acute training load (fatigue), τ = 7
  ctl: number; // chronic training load (fitness), τ = 42
  tsb: number; // form going into the day = CTL(yesterday) − ATL(yesterday)
  acute: number; // 7-day EWMA (per day)
  chronic: number; // 28-day EWMA (per day)
  ratio: number | null; // acute / chronic, null until 14 days of history
  historyDays: number; // days since the series origin, inclusive
  estimated: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Daily load series. CTL/ATL: x_t = x_{t−1} + (L_t − x_{t−1})/τ (TrainingPeaks PMC, τ = 42/7); TSB_t = CTL_{t−1} − ATL_{t−1}.
 * Acute/chronic: EWMA λ = 2/(N+1), N = 7/28 (Williams 2017), bias-corrected; ratio needs ≥ 14 days and chronic > 0.
 */
export function loadSeries(items: readonly LoadItem[], endDay: ISODate, startDay?: ISODate): LoadDay[] {
  const byDay = new Map<number, { load: number; estimated: boolean }>();
  for (const it of items) {
    const n = dayNumber(it.day);
    const cur = byDay.get(n) ?? { load: 0, estimated: false };
    cur.load += Math.max(0, it.load);
    cur.estimated ||= !!it.estimated;
    byDay.set(n, cur);
  }
  const last = dayNumber(endDay);
  const itemDays = [...byDay.keys()].filter((n) => n <= last);
  const outFrom = startDay !== undefined ? dayNumber(startDay) : itemDays.length ? Math.min(...itemDays) : null;
  if (outFrom === null) return [];
  const origin = Math.min(outFrom, ...itemDays);

  const la = 2 / (7 + 1);
  const lc = 2 / (28 + 1);
  let atl = 0;
  let ctl = 0;
  let ea = 0; // uncorrected EWMAs
  let ec = 0;
  const out: LoadDay[] = [];
  for (let d = origin; d <= last; d++) {
    const today = byDay.get(d) ?? { load: 0, estimated: false };
    const L = today.load;
    const tsb = ctl - atl;
    ctl += (L - ctl) / 42;
    atl += (L - atl) / 7;
    ea = la * L + (1 - la) * ea;
    ec = lc * L + (1 - lc) * ec;
    const n = d - origin + 1;
    const acute = ea / (1 - (1 - la) ** n);
    const chronic = ec / (1 - (1 - lc) ** n);
    if (d < outFrom) continue;
    out.push({
      day: fromDayNumber(d),
      load: L,
      atl,
      ctl,
      tsb,
      acute,
      chronic,
      ratio: chronic > 0 && n >= 14 ? acute / chronic : null,
      historyDays: n,
      estimated: today.estimated,
    });
  }
  return out;
}

export type RatioBand = "none" | "low" | "optimal" | "high" | "very-high";

/** Garmin load-ratio bands: < 0.8 low, < 1.5 optimal, < 2.0 high, else very high. */
export function ratioBand(r: number | null): RatioBand {
  if (r === null || !Number.isFinite(r)) return "none";
  return r < 0.8 ? "low" : r < 1.5 ? "optimal" : r < 2.0 ? "high" : "very-high";
}

/**
 * ESTIMATE. Foster session-RPE load = minutes × sRPE, × 0.24 so 60 min @ RPE 7 ≈ 100 Garmin-like units.
 * sRPE = session RPE ?? clamp(10 − average RIR, 1, 10) ?? 6.
 */
export function strengthSessionLoad(minutes: number, sessionRPE: number | null, avgRIR: number | null): number {
  const srpe = sessionRPE ?? (avgRIR !== null ? clamp(10 - avgRIR, 1, 10) : 6);
  return Math.max(0, minutes) * srpe * 0.24;
}

export interface CardioLoadInput {
  minutes: number;
  avgHR?: number | null;
  restHR?: number | null;
  maxHR?: number | null; // the user's HRmax (see estimatedMaxHR), not the session's peak
  sex: "male" | "female";
  rpe?: number | null;
}

/**
 * Banister TRIMPexp = minutes × HRr × 0.64·e^(b·HRr), b = 1.92 (male) / 1.67 (female), HRr = (avg − rest)/(max − rest).
 * Without HR data: minutes × (RPE ?? 5) × 0.24 (session-RPE estimate).
 */
export function cardioLoadEstimate(c: CardioLoadInput): number {
  const minutes = Math.max(0, c.minutes);
  const { avgHR, restHR, maxHR } = c;
  if (avgHR != null && restHR != null && maxHR != null && maxHR > restHR) {
    const hrr = clamp((avgHR - restHR) / (maxHR - restHR), 0, 1);
    const b = c.sex === "male" ? 1.92 : 1.67;
    return minutes * hrr * 0.64 * Math.exp(b * hrr);
  }
  return minutes * (c.rpe ?? 5) * 0.24;
}

/** Age-predicted maximum heart rate, 208 − 0.7 × age (Tanaka 2001). */
export function estimatedMaxHR(ageYears: number): number {
  return Math.round(208 - 0.7 * ageYears);
}

export type Recovery = "good" | "normal" | "reduced" | "unknown";
export interface LoadTarget {
  low: number;
  high: number;
  label: "EASY" | "MODERATE" | "HARD" | "BUILD";
}

/** Today's load range from fitness: CTL < 15 → BUILD 20–60; reduced 0.75–0.9×; normal 1.0–1.25×; good 1.5–2.0× CTL. */
export function dailyLoadTarget(ctl: number, recovery: Recovery): LoadTarget {
  if (ctl < 15) return { low: 20, high: 60, label: "BUILD" };
  const [lo, hi, label]: [number, number, LoadTarget["label"]] =
    recovery === "reduced" ? [0.75, 0.9, "EASY"] : recovery === "good" ? [1.5, 2.0, "HARD"] : [1.0, 1.25, "MODERATE"];
  return { low: Math.round(lo * ctl), high: Math.round(hi * ctl), label };
}

export interface IntensityFocus {
  lowMin: number; // zones 1–2
  highMin: number; // zones 3–4
  anaerobicMin: number; // zone 5
}

/** Minutes in HR zones 1–2 / 3–4 / 5 summed over sessions (arrays indexed zone 1..5; nulls count as 0). */
export function intensityFocus(
  zones: readonly (readonly (number | null)[] | null | undefined)[],
  unit: "sec" | "min" = "sec",
): IntensityFocus {
  const k = unit === "sec" ? 1 / 60 : 1;
  const acc = { lowMin: 0, highMin: 0, anaerobicMin: 0 };
  for (const z of zones) {
    if (!z) continue;
    const v = (i: number) => Math.max(0, z[i] ?? 0) * k;
    acc.lowMin += v(0) + v(1);
    acc.highMin += v(2) + v(3);
    acc.anaerobicMin += v(4);
  }
  return acc;
}
