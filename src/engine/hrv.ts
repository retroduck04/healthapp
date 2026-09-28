// Overnight HRV status from nightly rMSSD, in the style of Plews et al. / HRV4Training.
//
// Refinements to the brief (documented deviations):
// - The baseline window is the 60 days BEFORE the 7-day window (endDay−66 … endDay−7), so this week is not
//   compared with itself. `n7` (nights in the 7-day window) is returned too.
// - Non-positive or non-finite rMSSD values are ignored; with two values for a day the later one wins.

import { dayNumber, type ISODate } from "./dates";
import { mean, sampleSD } from "./stats";

export interface HrvNight {
  day: ISODate; // wake date
  rmssd: number; // ms
}

export type HrvStatusLabel = "low" | "normal" | "high" | "insufficient";

export interface HrvStatus {
  avg7: number | null; // geometric mean of the last 7 days' rMSSD (≥ 3 nights)
  baseline: number | null; // geometric mean of the 60-day baseline (≥ 14 nights)
  low: number | null; // normal band = exp(mean ln ± 0.5·SD ln)
  high: number | null;
  status: HrvStatusLabel;
  cv7: number | null; // SD / mean of the last 7 raw values, %
  n7: number;
  n60: number;
}

/**
 * 7-day ln(rMSSD) average against a 60-day baseline band of mean ± 0.5 SD (smallest worthwhile change,
 * Plews 2012 / HRV4Training). Works in ln space because rMSSD is right-skewed.
 */
export function hrvStatus(nights: readonly HrvNight[], endDay: ISODate): HrvStatus {
  const end = dayNumber(endDay);
  const byDay = new Map<number, number>();
  for (const n of nights) if (Number.isFinite(n.rmssd) && n.rmssd > 0) byDay.set(dayNumber(n.day), n.rmssd);
  const range = (from: number, to: number) => {
    const v: number[] = [];
    for (let d = from; d <= to; d++) {
      const x = byDay.get(d);
      if (x !== undefined) v.push(x);
    }
    return v;
  };
  const week = range(end - 6, end);
  const base = range(end - 66, end - 7);

  const avg7 = week.length >= 3 ? Math.exp(mean(week.map(Math.log))!) : null;
  const m = mean(week);
  const sd = sampleSD(week);
  const cv7 = week.length >= 3 && m && sd !== null ? (100 * sd) / m : null;

  let baseline: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  if (base.length >= 14) {
    const lns = base.map(Math.log);
    const mu = mean(lns)!;
    const s = sampleSD(lns)!;
    baseline = Math.exp(mu);
    low = Math.exp(mu - 0.5 * s);
    high = Math.exp(mu + 0.5 * s);
  }

  let status: HrvStatusLabel = "insufficient";
  if (avg7 !== null && low !== null && high !== null) status = avg7 < low ? "low" : avg7 > high ? "high" : "normal";
  return { avg7, baseline, low, high, status, cv7, n7: week.length, n60: base.length };
}
