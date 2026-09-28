// Sleep timing: regularity (SRI), bed/wake spread, bedtime planning, caffeine cutoff and curve, sleep-need baseline.
//
// Refinements to the brief (documented deviations):
// - sleepRegularityIndex takes an optional time zone. With it, "t + 24 h" means the same LOCAL clock time on the
//   next day (23 or 25 real hours across a DST change), so a clock-regular sleeper keeps SRI 100 through DST.
//   A 24-hour block "has a sleep record" when a sleep interval's midpoint falls in it. Align endMs to local
//   noon so each block holds one night.
// - timingSpread returns null fields when there are no intervals (SDs need ≥ 2); midpoints pivot at 18:00.
// - bedtimePlan: sleepOpportunityH = need + payback + latency (the time-in-bed window); debtHours may be null.
// - caffeineCutoff caps the cutoff at bedtime when the next dose fits even at bedtime.

import { localTime, parseISODate } from "./dates";
import { caffeineRemaining, type CaffeineDose } from "./sleep";
import { median, sampleSD } from "./stats";

export interface SleepInterval {
  start: number; // ms
  end: number; // ms
}

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const EPOCH = 5 * MIN;

/** UTC offset of a time zone at an instant (local wall clock − UTC, ms, minute precision). */
export function tzOffsetMs(t: number, timeZone: string): number {
  const lt = localTime(t, timeZone);
  const { y, m, day } = parseISODate(lt.date);
  return Date.UTC(y, m - 1, day, lt.hour, lt.minute) - Math.floor(t / MIN) * MIN;
}

/** Offsets at start + i·EPOCH for i < count, probing hourly and resolving epochs only where the offset changes. */
function epochOffsets(start: number, count: number, timeZone: string): number[] {
  const hours = Math.ceil((count * EPOCH) / HOUR) + 1;
  const probe = Array.from({ length: hours + 1 }, (_, j) => tzOffsetMs(start + j * HOUR, timeZone));
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const j = Math.floor((i * EPOCH) / HOUR);
    out[i] = probe[j] === probe[j + 1] ? probe[j] : tzOffsetMs(start + i * EPOCH, timeZone);
  }
  return out;
}

/**
 * Sleep Regularity Index (Phillips 2017): −100 + 200 × P(same sleep/wake state at t and t + 24 h), 5-minute epochs
 * over [endMs − days·24 h, endMs]; only pairs whose two 24-h blocks both hold a sleep record. Null if < 5 nights.
 */
export function sleepRegularityIndex(
  intervals: readonly SleepInterval[],
  endMs: number,
  days = 14,
  timeZone?: string,
): { sri: number | null; nights: number } {
  days = Math.max(1, Math.round(days));
  const start = endMs - days * DAY;
  const perDay = DAY / EPOCH;
  const n = days * perDay;
  const asleep = new Uint8Array(n);
  const recorded = new Uint8Array(days);
  for (const iv of intervals) {
    if (!(iv.end > iv.start)) continue;
    const mid = (iv.start + iv.end) / 2;
    if (mid >= start && mid < endMs) recorded[Math.floor((mid - start) / DAY)] = 1;
    const a = Math.max(0, Math.ceil((iv.start - start) / EPOCH - 0.5));
    const b = Math.min(n, Math.ceil((iv.end - start) / EPOCH - 0.5));
    for (let i = a; i < b; i++) asleep[i] = 1; // epoch i asleep when its midpoint lies inside the interval
  }
  const nights = recorded.reduce((s, r) => s + r, 0);
  if (nights < 5) return { sri: null, nights };

  const offsets = timeZone ? epochOffsets(start, n + perDay + 12, timeZone) : null;
  let pairs = 0;
  let same = 0;
  for (let i = 0; i < n; i++) {
    const shift = offsets ? Math.round((offsets[i] - offsets[i + perDay]) / EPOCH) : 0;
    const j = i + perDay + shift;
    if (j < 0 || j >= n) continue;
    if (!recorded[Math.floor(i / perDay)] || !recorded[Math.floor(j / perDay)]) continue;
    pairs++;
    if (asleep[i] === asleep[j]) same++;
  }
  return { sri: pairs ? -100 + (200 * same) / pairs : null, nights };
}

export interface TimingSpread {
  n: number;
  bedtimeMedianMin: number | null; // local clock minutes 0–1439
  wakeMedianMin: number | null;
  bedtimeSdMin: number | null; // sample SD, minutes
  wakeSdMin: number | null;
  midpointMin: number | null;
}

const clockMin = (t: number, timeZone: string) => {
  const lt = localTime(t, timeZone);
  return lt.hour * 60 + lt.minute;
};
const wrap = (m: number) => ((Math.round(m) % 1440) + 1440) % 1440;

/** Bed/wake/midpoint clock statistics in a time zone; bedtimes before 12:00 count as +1440 so 23:50 and 00:20 are 30 min apart. */
export function timingSpread(intervals: readonly SleepInterval[], timeZone: string): TimingSpread {
  const valid = intervals.filter((iv) => iv.end > iv.start);
  const bed = valid.map((iv) => {
    const m = clockMin(iv.start, timeZone);
    return m < 720 ? m + 1440 : m;
  });
  const wake = valid.map((iv) => clockMin(iv.end, timeZone));
  const mid = valid.map((iv) => {
    const m = clockMin((iv.start + iv.end) / 2, timeZone);
    return m < 1080 ? m + 1440 : m;
  });
  const med = (v: number[]) => {
    const x = median(v);
    return x === null ? null : wrap(x);
  };
  return {
    n: valid.length,
    bedtimeMedianMin: med(bed),
    wakeMedianMin: med(wake),
    bedtimeSdMin: sampleSD(bed),
    wakeSdMin: sampleSD(wake),
    midpointMin: med(mid),
  };
}

export interface BedtimePlanInput {
  wakeTargetMin: number; // local clock minutes
  needHours: number;
  debtHours: number | null;
  latencyMin?: number; // 15
  maxPaybackPerNightH?: number; // 1
  paybackDays?: number; // 7
}

/** Bedtime = wake − (need + payback) − latency; payback = min(max per night, debt / payback days). */
export function bedtimePlan(p: BedtimePlanInput): { bedtimeMin: number; sleepOpportunityH: number; paybackH: number } {
  const latency = p.latencyMin ?? 15;
  const maxPay = p.maxPaybackPerNightH ?? 1;
  const days = Math.max(1, p.paybackDays ?? 7);
  const debt = p.debtHours ?? 0;
  const paybackH = debt > 0 ? Math.min(maxPay, debt / days) : 0;
  const sleepOpportunityH = p.needHours + paybackH + latency / 60;
  return { bedtimeMin: wrap(p.wakeTargetMin - sleepOpportunityH * 60), sleepOpportunityH, paybackH };
}

export interface CaffeineCutoffInput {
  doses: readonly CaffeineDose[];
  bedtimeMs: number;
  halfLifeH: number;
  nextDoseMg?: number; // 95 (a coffee)
  limitMg?: number; // 25 mg allowed at bedtime
  nowMs: number;
}

export type CutoffStatus = "OPEN" | "CLOSED" | "PAST";

/**
 * Last time a `nextDoseMg` dose still decays to the bedtime limit: cutoff = bed − h·log2(dose / (limit − residual)).
 * Gardiner 2023 meta-analysis: 107 mg ≥ 8.8 h and 217 mg ≥ 13.2 h before bed both leave ≈ 25–30 mg at bedtime.
 */
export function caffeineCutoff(c: CaffeineCutoffInput): { cutoffMs: number | null; residualAtBedMg: number; status: CutoffStatus } {
  const dose = c.nextDoseMg ?? 95;
  const limit = c.limitMg ?? 25;
  const residualAtBedMg = caffeineRemaining(c.doses.filter((d) => d.t <= c.bedtimeMs), c.bedtimeMs, c.halfLifeH);
  const allowed = limit - residualAtBedMg;
  if (allowed <= 0) return { cutoffMs: null, residualAtBedMg, status: "CLOSED" };
  const cutoffMs = c.bedtimeMs - Math.max(0, c.halfLifeH * Math.log2(dose / allowed)) * HOUR;
  return { cutoffMs, residualAtBedMg, status: cutoffMs < c.nowMs ? "PAST" : "OPEN" };
}

/** Caffeine on board from fromMs to toMs every stepMin minutes; instant absorption, first-order elimination (a model). */
export function caffeineCurve(
  doses: readonly CaffeineDose[],
  fromMs: number,
  toMs: number,
  stepMin: number,
  halfLifeH: number,
): { t: number; mg: number }[] {
  const step = Math.max(1, stepMin) * MIN;
  const count = Math.min(10000, Math.floor((toMs - fromMs) / step) + 1);
  const out: { t: number; mg: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = fromMs + i * step;
    out.push({ t, mg: caffeineRemaining(doses, t, halfLifeH) });
  }
  return out;
}

/** Typical sleep: drop nights < 4 h or > 11 h, trim 10 % from each end, median; null under 14 nights. */
export function sleepNeedBaseline(hours: readonly number[]): { medianH: number | null; n: number } {
  const kept = hours.filter((h) => Number.isFinite(h) && h >= 4 && h <= 11).sort((a, b) => a - b);
  const n = kept.length;
  if (n < 14) return { medianH: null, n };
  const cut = Math.floor(n * 0.1);
  return { medianH: median(kept.slice(cut, n - cut)), n };
}
