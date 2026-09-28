// Behaviour impact (Whoop-journal style): automatic tags per night and the effect of a tag on an outcome.
//
// Refinements to the brief (documented deviations):
// - minEach is raised to at least 2 (a variance needs two values).
// - When both groups have zero variance the CI collapses to the difference itself.
// - rankTagImpacts() added: every tag with enough data, largest absolute effect first.

import type { ISODate } from "./dates";
import { mean, sampleVariance, tQuantile975 } from "./stats";

export const AUTO_TAGS = ["LATE CAFFEINE", "LATE MEAL", "LATE WORKOUT", "HIGH LOAD"] as const;
export type AutoTag = (typeof AUTO_TAGS)[number];

export interface AutoTagContext {
  caffeineAfterCutoff: boolean;
  lastMealMinBeforeBed: number | null;
  workoutEndMinBeforeBed: number | null;
  dayLoad: number;
  ctl: number;
}

/** Tags derived from logged data: caffeine after cutoff, meal < 3 h and workout < 2 h before bed, load > 1.5 × CTL. */
export function autoTags(ctx: AutoTagContext): AutoTag[] {
  const tags: AutoTag[] = [];
  if (ctx.caffeineAfterCutoff) tags.push("LATE CAFFEINE");
  if (ctx.lastMealMinBeforeBed !== null && ctx.lastMealMinBeforeBed < 180) tags.push("LATE MEAL");
  if (ctx.workoutEndMinBeforeBed !== null && ctx.workoutEndMinBeforeBed < 120) tags.push("LATE WORKOUT");
  if (ctx.ctl > 0 && ctx.dayLoad > 1.5 * ctx.ctl) tags.push("HIGH LOAD");
  return tags;
}

export interface TagObservation {
  day: ISODate;
  tags: readonly string[];
  outcome: number; // e.g. sleep score, HRV, hours slept
}

export interface TagImpact {
  tag: string;
  nWith: number;
  nWithout: number;
  meanWith: number;
  meanWithout: number;
  diff: number; // meanWith − meanWithout
  ciLow: number; // 95 % Welch interval of diff
  ciHigh: number;
  significant: boolean; // the interval excludes 0
}

/**
 * Welch two-sample 95 % CI for mean(with tag) − mean(without): diff ± t(0.975, ν)·√(s₁²/n₁ + s₂²/n₂),
 * ν by Welch–Satterthwaite. Null when either group has fewer than minEach observations.
 */
export function tagImpact(obs: readonly TagObservation[], tag: string, minEach = 5): TagImpact | null {
  const need = Math.max(2, minEach);
  const withTag: number[] = [];
  const without: number[] = [];
  for (const o of obs) {
    if (!Number.isFinite(o.outcome)) continue;
    (o.tags.includes(tag) ? withTag : without).push(o.outcome);
  }
  if (withTag.length < need || without.length < need) return null;
  const n1 = withTag.length;
  const n2 = without.length;
  const m1 = mean(withTag)!;
  const m2 = mean(without)!;
  const a = sampleVariance(withTag)! / n1;
  const b = sampleVariance(without)! / n2;
  const diff = m1 - m2;
  const se = Math.sqrt(a + b);
  let ciLow = diff;
  let ciHigh = diff;
  if (se > 0) {
    const df = (a + b) ** 2 / (a ** 2 / (n1 - 1) + b ** 2 / (n2 - 1));
    const half = tQuantile975(df) * se;
    ciLow = diff - half;
    ciHigh = diff + half;
  }
  return {
    tag,
    nWith: n1,
    nWithout: n2,
    meanWith: m1,
    meanWithout: m2,
    diff,
    ciLow,
    ciHigh,
    significant: ciLow > 0 || ciHigh < 0,
  };
}

/** tagImpact for every tag seen in `obs`, dropping tags without enough data; largest |diff| first. */
export function rankTagImpacts(obs: readonly TagObservation[], minEach = 5): TagImpact[] {
  const tags = new Set(obs.flatMap((o) => o.tags));
  return [...tags]
    .map((t) => tagImpact(obs, t, minEach))
    .filter((x): x is TagImpact => x !== null)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
}
