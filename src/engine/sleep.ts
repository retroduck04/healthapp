// Sleep debt (weighted 14-night balance), caffeine decay, and an initial energy estimate.

import { mean } from "./stats";

export interface SleepNight {
  mainSleepHours: number | null; // null = no data that night
  napHours?: number;
}

export interface SleepDebtParams {
  needHours: number;
  napCredit: number;
  maxSurplusPerNight: number;
  window: number;
  weightStep: number; // 1.0 for last night, 0.35 fourteen nights ago
  maxMissingNights: number;
}

export const defaultSleepDebtParams = (needHours: number): SleepDebtParams => ({
  needHours,
  napCredit: 0.8,
  maxSurplusPerNight: 2,
  window: 14,
  weightStep: 0.05,
  maxMissingNights: 3,
});

export interface SleepDebtResult {
  debtHours: number | null; // null = insufficient data
  missingNights: number;
  estimatedNights: number;
}

/** @param nights in date order, most recent LAST. A model, not a literal bank balance. */
export function sleepDebt(nights: readonly SleepNight[], p: SleepDebtParams): SleepDebtResult {
  const recent = nights.slice(-p.window);
  const absent = p.window - recent.length;
  const missing = recent.filter((n) => n.mainSleepHours === null).length + absent;
  const fill = mean(recent.flatMap((n) => (n.mainSleepHours === null ? [] : [n.mainSleepHours])));
  if (missing > p.maxMissingNights || fill === null) return { debtHours: null, missingNights: missing, estimatedNights: 0 };
  const padded: SleepNight[] = [...Array.from({ length: absent }, () => ({ mainSleepHours: null })), ...recent];
  let weighted = 0;
  padded
    .slice()
    .reverse()
    .forEach((n, k) => {
      const w = 1 - p.weightStep * k;
      const sleep = (n.mainSleepHours ?? fill) + p.napCredit * (n.napHours ?? 0);
      weighted += w * Math.min(sleep - p.needHours, p.maxSurplusPerNight);
    });
  return { debtHours: Math.max(0, -weighted), missingNights: missing, estimatedNights: missing };
}

export interface CaffeineDose {
  mg: number;
  t: number; // ms
}

/** One-compartment first-order elimination. Individual half-lives vary widely (about 2–10 h). */
export function caffeineRemaining(doses: readonly CaffeineDose[], atMs: number, halfLifeHours = 5): number {
  return doses.reduce((total, d) => {
    const hours = (atMs - d.t) / 3600000;
    return hours < 0 ? total : total + d.mg * 0.5 ** (hours / halfLifeHours);
  }, 0);
}

/** Mifflin–St Jeor resting energy (kcal/day). */
export function mifflinStJeor(kg: number, cm: number, ageYears: number, sex: "male" | "female"): number {
  return 10 * kg + 6.25 * cm - 5 * ageYears + (sex === "male" ? 5 : -161);
}
