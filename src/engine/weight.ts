// Robust local-linear-trend Kalman filter for bodyweight, and checks for bad weigh-ins.

import { KG_PER_LB } from "./units";

export interface WeightObservation {
  t: number; // ms
  kg: number;
}

export interface TrendPoint {
  t: number;
  observed: number;
  trend: number; // kg
  slopePerDay: number; // kg/day
  trendSD: number; // kg
  suspect: boolean; // far from expectation, down-weighted
}

export interface TrendParams {
  levelNoise: number; // kg per sqrt(day)
  slopeNoise: number; // kg/day per sqrt(day)
  observationSD: number; // kg (water, food, glycogen)
  outlierThreshold: number; // predictive SDs
  initialLevelSD: number;
  initialSlopeSD: number;
}

export const defaultTrendParams: TrendParams = {
  levelNoise: 0.05,
  slopeNoise: 0.004,
  observationSD: 0.6,
  outlierThreshold: 3,
  initialLevelSD: 2,
  initialSlopeSD: 0.1,
};

export function weightTrend(observations: readonly WeightObservation[], p: TrendParams = defaultTrendParams): TrendPoint[] {
  const obs = [...observations].sort((a, b) => a.t - b.t);
  if (!obs.length) return [];
  let level = obs[0].kg;
  let slope = 0;
  let p00 = p.initialLevelSD ** 2;
  let p01 = 0;
  let p11 = p.initialSlopeSD ** 2;
  let prev = obs[0].t;
  const r = p.observationSD ** 2;
  const out: TrendPoint[] = [{ t: obs[0].t, observed: obs[0].kg, trend: level, slopePerDay: 0, trendSD: Math.sqrt(p00), suspect: false }];

  for (const o of obs.slice(1)) {
    const dt = Math.max((o.t - prev) / 86400000, 0);
    prev = o.t;
    // Predict.
    level += dt * slope;
    const q00 = p00 + 2 * dt * p01 + dt * dt * p11 + p.levelNoise ** 2 * dt;
    const q01 = p01 + dt * p11;
    const q11 = p11 + p.slopeNoise ** 2 * dt;
    p00 = q00;
    p01 = q01;
    p11 = q11;
    // Update, inflating the noise of outliers instead of trusting them.
    const innovation = o.kg - level;
    const z = Math.abs(innovation) / Math.sqrt(p00 + r);
    const suspect = z > p.outlierThreshold;
    const rEff = suspect ? r * (z / p.outlierThreshold) ** 2 : r;
    const s = p00 + rEff;
    const k0 = p00 / s;
    const k1 = p01 / s;
    level += k0 * innovation;
    slope += k1 * innovation;
    const n00 = (1 - k0) * p00;
    const n01 = (1 - k0) * p01;
    const n11 = p11 - k1 * p01;
    p00 = n00;
    p01 = n01;
    p11 = n11;
    out.push({ t: o.t, observed: o.kg, trend: level, slopePerDay: slope, trendSD: Math.sqrt(Math.max(p00, 0)), suspect });
  }
  return out;
}

export type EntryVerdict = { ok: true } | { ok: false; reason: string; suggestion: number | null };

/** Checks a typed weigh-in before saving. `value` and `reference` (current trend) are in the display unit. */
export function checkWeightEntry(value: number, reference: number | null, unitIsPounds: boolean): EntryVerdict {
  const kg = unitIsPounds ? value * KG_PER_LB : value;
  const plausible = kg >= 30 && kg <= 300;
  const far = reference !== null && reference > 0 && Math.abs(value - reference) / reference > 0.05;
  if (plausible && !far) return { ok: true };
  const suggestion = reference !== null ? likelyIntended(value, reference, unitIsPounds) : null;
  return {
    ok: false,
    reason: !plausible ? "That weight is outside the plausible range." : "That is more than 5% away from your trend weight.",
    suggestion,
  };
}

function likelyIntended(value: number, reference: number, unitIsPounds: boolean): number | null {
  const factor = 1 / KG_PER_LB;
  const candidates = [value / 10, value * 10, unitIsPounds ? value * factor : value / factor];
  const close = candidates.filter((c) => Math.abs(c - reference) / reference <= 0.05);
  if (!close.length) return null;
  close.sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference));
  return Math.round(close[0] * 10) / 10;
}
