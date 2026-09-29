// Per-muscle fatigue / recovery estimate for the body map.
//
// A HEURISTIC in the style of Fitbod's "muscle recovery" map, NOT validated physiology: it turns logged hard
// sets into a 0..1 "how recently and how hard was this muscle worked" level with a first-order decay.
//
//   stimulus of one hard set  s = role × RIR factor
//     hard set  = working set with RIR ≤ 4 or RIR not logged (the same rule as the weekly volume count)
//     role      = 1 for a primary muscle, 0.5 for a secondary one (musclesFor, volume.ts)
//     RIR factor: 0 → 1.2 · 1 → 1.1 · 2 → 1.0 · 3 → 0.85 · 4 → 0.7 · not logged → 1.0
//   residual fatigue  F(t) = Σ s · exp(−Δh / τ)        Δh = hours since the set, sets older than 7 days ignored
//     τ by muscle size: large (quads, hamstrings, glutes, back, chest) 30 h · medium (shoulders, adductors) 24 h
//                       small (biceps, triceps, forearms, calves, abs) 18 h
//   level = 1 − exp(−F / 6)          (≈ 6 hard primary sets just done → 0.63)
//   band  = 0 FRESH < 0.10 ≤ 1 LOW < 0.30 ≤ 2 MOD < 0.55 ≤ 3 HIGH < 0.80 ≤ 4 MAX
//   readyInH = hours until level < 0.30 (0 when already below, null when the muscle has no logged hard set).
//     Every set of one muscle decays with the same τ, so F(t + h) = F(t)·e^(−h/τ) and the answer is closed form:
//     readyInH = ⌈τ · ln(F / F*)⌉ with F* = −6·ln(0.7). (Sets leaving the 7-day window are ignored here; their
//     weight at 7 days is ≤ e^(−168/30) ≈ 0.4 %, so the error is negligible.)

import { MUSCLES, musclesFor, type Muscle, type MuscleMap } from "./volume";

export interface FatigueSet {
  exerciseName: string;
  group?: string;
  rir: number | null;
  kind: "warmup" | "working";
  completedAt: number;
}

export type FatigueBand = 0 | 1 | 2 | 3 | 4;

export interface MuscleFatigue {
  /** 0..1 */
  level: number;
  band: FatigueBand;
  /** whole hours until level < 0.30; 0 = ready now; null = no hard set logged for this muscle */
  readyInH: number | null;
  /** completion time of the latest hard set that worked this muscle (primary or secondary); null = none */
  lastTrainedMs: number | null;
  /** hard sets in the last 72 h (primary 1, secondary 0.5) */
  hardSets72h: number;
}

/** Recovery time constant τ (hours) by muscle size. */
export const FATIGUE_TAU_H: Readonly<Record<Muscle, number>> = {
  chest: 30,
  back: 30,
  quads: 30,
  hamstrings: 30,
  glutes: 30,
  shoulders: 24,
  adductors: 24,
  biceps: 18,
  triceps: 18,
  forearms: 18,
  calves: 18,
  abs: 18,
};

/** Stimulus multiplier by reps in reserve 0..4 (index); a set with no RIR logged counts 1.0. */
export const RIR_FACTOR: readonly number[] = [1.2, 1.1, 1.0, 0.85, 0.7];
export const SECONDARY_WEIGHT = 0.5;
/** level = 1 − exp(−F / FATIGUE_SCALE) */
export const FATIGUE_SCALE = 6;
/** lower edges of bands 1..4 */
export const BAND_EDGES: readonly number[] = [0.1, 0.3, 0.55, 0.8];
export const BAND_LABEL: readonly string[] = ["FRESH", "LOW", "MOD", "HIGH", "MAX"];
/** a muscle counts as ready below this level (band ≤ 1) */
export const READY_LEVEL = 0.3;
export const FATIGUE_WINDOW_H = 7 * 24;

const H = 3600000;

export function rirFactor(rir: number | null): number {
  if (rir === null || !Number.isFinite(rir)) return 1;
  return RIR_FACTOR[Math.max(0, Math.min(4, Math.round(rir)))];
}

export function fatigueBand(level: number): FatigueBand {
  let b = 0;
  while (b < BAND_EDGES.length && level >= BAND_EDGES[b]) b++;
  return b as FatigueBand;
}

/** Fatigue per muscle at `nowMs` from logged sets (any order). Sets after `nowMs` are ignored. */
export function muscleFatigue(sets: readonly FatigueSet[], nowMs: number): Record<Muscle, MuscleFatigue> {
  const F = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  const last = Object.fromEntries(MUSCLES.map((m) => [m, null])) as Record<Muscle, number | null>;
  const recent = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  const cache = new Map<string, MuscleMap>();
  for (const s of sets) {
    if (s.kind !== "working" || !(s.completedAt <= nowMs)) continue;
    if (s.rir !== null && s.rir > 4) continue;
    const key = `${s.exerciseName}\u0000${s.group ?? ""}`;
    let map = cache.get(key);
    if (!map) cache.set(key, (map = musclesFor(s.exerciseName, s.group)));
    const dh = (nowMs - s.completedAt) / H;
    const k = rirFactor(s.rir);
    const hit = (m: Muscle, role: number) => {
      if (last[m] === null || s.completedAt > last[m]!) last[m] = s.completedAt;
      if (dh > FATIGUE_WINDOW_H) return;
      F[m] += role * k * Math.exp(-dh / FATIGUE_TAU_H[m]);
      if (dh <= 72) recent[m] += role;
    };
    for (const m of map.primary) hit(m, 1);
    for (const m of map.secondary) hit(m, SECONDARY_WEIGHT);
  }
  const fStar = -FATIGUE_SCALE * Math.log(1 - READY_LEVEL);
  const out = {} as Record<Muscle, MuscleFatigue>;
  for (const m of MUSCLES) {
    const f = F[m];
    const level = 1 - Math.exp(-f / FATIGUE_SCALE);
    const readyInH = last[m] === null ? null : level < READY_LEVEL ? 0 : Math.max(1, Math.ceil(FATIGUE_TAU_H[m] * Math.log(f / fStar) - 1e-9));
    out[m] = { level, band: fatigueBand(level), readyInH, lastTrainedMs: last[m], hardSets72h: recent[m] };
  }
  return out;
}

/** Muscles ranked by level, most fatigued first (ties keep MUSCLES order); only band ≥ minBand. */
export function rankFatigue(f: Readonly<Record<Muscle, { level: number; band: number }>>, minBand = 1): Muscle[] {
  return MUSCLES.filter((m) => f[m].band >= minBand).sort((a, b) => f[b].level - f[a].level);
}
