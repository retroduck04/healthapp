// Adaptive energy expenditure (MacroFactor-style), calorie targets and the weekly check-in rule.
//
// Refinements to the brief (documented deviations):
// - The window-start weight is the latest trend sample at or before the window start; if none exists
//   (weighing began inside the window) the earliest sample inside the window is used instead.
// - When no data-driven value can be formed (raw null) or logging is paused, the previous estimate AND its
//   uncertainty are held; "prior" confidence also covers days before the first data-driven update.
// - Pause counts only days on or after the series start, so the first week is not reported as paused.
// - calorieTargets adds `floored`; when the safety floor applies, dailyDeltaKcal/weeklyChangeKg are
//   recomputed from the floored target so they stay truthful.
// - Helpers added: priorTdee (Mifflin–St Jeor × activity) and trendSamplesByDay (weightTrend → TrendSample[]).

import { addDays, dayNumber, fromDayNumber, nutritionDay, type ISODate } from "./dates";
import { mifflinStJeor } from "./sleep";
import { mean } from "./stats";

export interface DayIntake {
  day: ISODate; // nutrition day
  kcal: number;
  complete: boolean; // the user confirmed the day's log is complete
}

export interface TrendSample {
  day: ISODate;
  kg: number; // trend weight at the end of that day
  sd: number; // trend standard deviation (kg)
}

export type ExpenditureConfidence = "prior" | "low" | "medium" | "high";

export interface ExpenditureDay {
  day: ISODate;
  kcal: number; // smoothed expenditure estimate (kcal/day), unrounded
  raw: number | null; // this day's un-blended window estimate, null when not computable
  low: number; // 80 % range
  high: number;
  completeDays: number; // complete days in the window ending today
  paused: boolean; // > 3 of the last 7 days incomplete: estimate held
  confidence: ExpenditureConfidence;
}

export interface ExpenditureOptions {
  priorKcal: number; // starting guess, e.g. priorTdee(...)
  windowDays?: number; // 21
  rhoKcalPerKg?: number; // 7700 kcal per kg of tissue
  minCompleteDays?: number; // 7
  priorWeightDays?: number; // 14: complete days at which the prior's weight reaches zero
  alpha?: number; // 0.15 daily smoothing factor
}

const Z80 = 1.2816; // two-sided 80 % normal quantile

/** Latest sample at or before day number `n` (samples sorted ascending by `dn`). */
function sampleAtOrBefore<T extends { dn: number }>(sorted: readonly T[], n: number): T | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let best: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].dn <= n) {
      best = sorted[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Daily adaptive TDEE. raw = mean(complete-day kcal) − ρ·Δtrend/Δdays over a W-day window (energy balance,
 * Hall 2008 ρ ≈ 7700 kcal/kg); blended with the prior by w = min(1, C/14); EWMA-smoothed with α = 0.15.
 * One entry per day from the first intake/trend day to endDay.
 */
export function expenditureSeries(
  intake: readonly DayIntake[],
  trend: readonly TrendSample[],
  endDay: ISODate,
  opts: ExpenditureOptions,
): ExpenditureDay[] {
  const W = opts.windowDays ?? 21;
  const rho = opts.rhoKcalPerKg ?? 7700;
  const minComplete = opts.minCompleteDays ?? 7;
  const priorDays = opts.priorWeightDays ?? 14;
  const alpha = opts.alpha ?? 0.15;
  const prior = opts.priorKcal;
  const sigmaPrior = 0.15 * prior;

  const complete = new Map<number, number>(); // day number -> kcal of complete days
  for (const d of intake) {
    const n = dayNumber(d.day);
    if (d.complete) complete.set(n, d.kcal);
    else complete.delete(n);
  }
  const samples = trend
    .map((s) => ({ ...s, dn: dayNumber(s.day) }))
    .sort((a, b) => a.dn - b.dn);

  const firsts = [...intake.map((d) => dayNumber(d.day)), ...(samples.length ? [samples[0].dn] : [])];
  if (!firsts.length) return [];
  const first = Math.min(...firsts);
  const last = dayNumber(endDay);

  const out: ExpenditureDay[] = [];
  let est = prior;
  let sigma = sigmaPrior;
  let everUpdated = false;
  for (let D = first; D <= last; D++) {
    const start = D - (W - 1);
    const kcals: number[] = [];
    for (let n = start; n <= D; n++) {
      const k = complete.get(n);
      if (k !== undefined) kcals.push(k);
    }
    const C = kcals.length;
    let incompleteLast7 = 0;
    for (let n = Math.max(D - 6, first); n <= D; n++) if (!complete.has(n)) incompleteLast7++;
    const paused = incompleteLast7 > 3;

    let raw: number | null = null;
    let sigmaData = 0;
    if (C >= minComplete) {
      const end = sampleAtOrBefore(samples, D);
      let begin = sampleAtOrBefore(samples, start);
      if (!begin) begin = samples.find((s) => s.dn >= start && s.dn <= D) ?? null;
      const gap = end && begin ? end.dn - begin.dn : 0;
      if (end && begin && gap >= 7) {
        const meanIntake = mean(kcals)!;
        raw = meanIntake - (rho * (end.kg - begin.kg)) / gap;
        sigmaData = Math.hypot((rho * Math.hypot(end.sd, begin.sd)) / gap, 0.05 * meanIntake);
      }
    }

    if (raw !== null && !paused) {
      const w = Math.min(1, C / priorDays);
      const blended = w * raw + (1 - w) * prior;
      est += alpha * (blended - est);
      sigma = w * sigmaData + (1 - w) * sigmaPrior;
      everUpdated = true;
    }

    const confidence: ExpenditureConfidence =
      C < minComplete || !everUpdated ? "prior" : C < 14 ? "low" : C < W || sigma > 250 ? "medium" : "high";
    out.push({
      day: fromDayNumber(D),
      kcal: est,
      raw,
      low: est - Z80 * sigma,
      high: est + Z80 * sigma,
      completeDays: C,
      paused,
      confidence,
    });
  }
  return out;
}

export type Phase = "cut" | "maintain" | "bulk";

export interface CalorieTargetOptions {
  phase: Phase;
  ratePctPerWeek?: number; // % of bodyweight per week; defaults cut −0.5, maintain 0, bulk +0.25
  weightKg: number;
  sex: "male" | "female";
  proteinG?: number | null; // null/undefined → 1.8 g/kg
  rho?: number; // 7700 kcal/kg
}

export interface CalorieTargets {
  kcal: number; // rounded to 10, never below 1500 (male) / 1200 (female)
  dailyDeltaKcal: number; // target − TDEE (planned; recomputed if floored)
  weeklyChangeKg: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  floored: boolean; // the safety floor raised the target
}

export const DEFAULT_RATE_PCT: Record<Phase, number> = { cut: -0.5, maintain: 0, bulk: 0.25 };

/** Target = TDEE + rate%·kg·ρ/7; protein 1.8 g/kg (Morton 2018), fat ≥ max(0.7 g/kg, 25 % kcal), carbs = rest. */
export function calorieTargets(tdee: number, o: CalorieTargetOptions): CalorieTargets {
  const rho = o.rho ?? 7700;
  const rate = o.ratePctPerWeek ?? DEFAULT_RATE_PCT[o.phase];
  let weeklyChangeKg = (rate / 100) * o.weightKg;
  let dailyDeltaKcal = (weeklyChangeKg * rho) / 7;
  const floor = o.sex === "male" ? 1500 : 1200;
  const planned = Math.round((tdee + dailyDeltaKcal) / 10) * 10;
  const floored = planned < floor;
  const kcal = floored ? floor : planned;
  if (floored) {
    dailyDeltaKcal = kcal - tdee;
    weeklyChangeKg = (dailyDeltaKcal * 7) / rho;
  }
  const proteinG = Math.round(o.proteinG ?? 1.8 * o.weightKg);
  const fatG = Math.round(Math.max(0.7 * o.weightKg, (0.25 * kcal) / 9));
  const carbG = Math.max(0, Math.round((kcal - 4 * proteinG - 9 * fatG) / 4));
  return { kcal, dailyDeltaKcal, weeklyChangeKg, proteinG, fatG, carbG, floored };
}

export interface CheckInState {
  due: boolean; // never checked in, or ≥ 7 days since the last check-in
  ready: boolean; // ≥ 4 complete days and ≥ 1 weigh-in in the last 7 days
  missing: string | null; // e.g. "2/4 LOGGED DAYS · NO WEIGH-IN"; null when ready
}

/** MacroFactor-style weekly check-in: needs ≥ 4 complete intake days and ≥ 1 weigh-in in the last 7 days. */
export function weeklyCheckIn(
  lastCheckInDay: ISODate | null,
  today: ISODate,
  completeDaysLast7: number,
  weighInsLast7: number,
): CheckInState {
  const due = lastCheckInDay === null || dayNumber(today) - dayNumber(lastCheckInDay) >= 7;
  const parts: string[] = [];
  if (completeDaysLast7 < 4) parts.push(`${Math.max(0, completeDaysLast7)}/4 LOGGED DAYS`);
  if (weighInsLast7 < 1) parts.push("NO WEIGH-IN");
  return { due, ready: parts.length === 0, missing: parts.length ? parts.join(" · ") : null };
}

/** Prior TDEE for a new user: Mifflin–St Jeor × activity factor (1.4 ≈ lightly active), rounded to 10. */
export function priorTdee(kg: number, cm: number, ageYears: number, sex: "male" | "female", activityFactor = 1.4): number {
  return Math.round((mifflinStJeor(kg, cm, ageYears, sex) * activityFactor) / 10) * 10;
}

/**
 * weightTrend() points → one TrendSample per nutrition day (the last point of the day, i.e. its end-of-day trend).
 * Days use the same boundary hour as food logging so intake and weight days line up.
 */
export function trendSamplesByDay(
  points: readonly { t: number; trend: number; trendSD: number }[],
  timeZone: string,
  boundaryHour = 4,
): TrendSample[] {
  const byDay = new Map<ISODate, { t: number; s: TrendSample }>();
  for (const p of points) {
    const day = nutritionDay(p.t, timeZone, boundaryHour);
    const prev = byDay.get(day);
    if (!prev || p.t >= prev.t) byDay.set(day, { t: p.t, s: { day, kg: p.trend, sd: p.trendSD } });
  }
  return [...byDay.values()].map((v) => v.s).sort((a, b) => dayNumber(a.day) - dayNumber(b.day));
}

/** Count of complete days and weigh-in days in the 7 days ending `today` (inputs for weeklyCheckIn). */
export function last7Counts(intake: readonly DayIntake[], weighInDays: readonly ISODate[], today: ISODate): { completeDays: number; weighIns: number } {
  const from = addDays(today, -6);
  const inRange = (d: ISODate) => d >= from && d <= today;
  const completeDays = new Set(intake.filter((d) => d.complete && inRange(d.day)).map((d) => d.day)).size;
  const weighIns = new Set(weighInDays.filter(inRange)).size;
  return { completeDays, weighIns };
}
