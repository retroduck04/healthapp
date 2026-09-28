// Personal records (Hevy-style): heaviest load, best e1RM, best set volume, reps at load, best session volume.
//
// Refinements to the brief (documented deviations):
// - Per-set records compare against previous workouts AND this workout's earlier working sets, so the same
//   record is not stamped twice in one session; sessionVolume fires once, on the set that crosses the best.
// - A record needs a previous comparable value (no "first ever" records), so `previous` is never null in hits.
// - `sessionSets` may include `newSet` or not; it is matched by identity or identical fields.
// - sessionRecords() added: replays a finished workout set by set (for summaries and the weekly report).
// - Loads where lower is harder (assisted machines) are not handled here: skip records for those exercises.

import { e1RM } from "./strength";

export interface SetLite {
  exerciseId: string;
  workoutId: string;
  load: number;
  reps: number;
  rir: number | null;
  kind: "warmup" | "working";
  completedAt: number;
}

export type RecordKind = "heaviest" | "e1rm" | "setVolume" | "repsAtLoad" | "sessionVolume";

export interface RecordHit {
  kind: RecordKind;
  value: number;
  previous: number | null;
}

const EPS = 1e-9;
const E1RM_MAX_REPS = 15; // reps + RIR beyond this makes Epley unreliable

const sameSet = (a: SetLite, b: SetLite) =>
  a === b ||
  (a.workoutId === b.workoutId && a.exerciseId === b.exerciseId && a.completedAt === b.completedAt && a.load === b.load && a.reps === b.reps);

/** Epley e1RM when reps + RIR ≤ 15, else null. */
export function recordE1rm(s: Pick<SetLite, "load" | "reps" | "rir">): number | null {
  return s.reps + (s.rir ?? 0) <= E1RM_MAX_REPS && s.reps > 0 ? e1RM(s.load, s.reps, s.rir ?? 0) : null;
}

const maxOf = (values: readonly (number | null)[]): number | null => {
  let best: number | null = null;
  for (const v of values) if (v !== null && (best === null || v > best)) best = v;
  return best;
};

/** Σ load × reps per workout (working sets only). */
function sessionTotals(sets: readonly SetLite[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sets) if (s.kind === "working") m.set(s.workoutId, (m.get(s.workoutId) ?? 0) + s.load * s.reps);
  return m;
}

/**
 * Records set by `newSet`. history = all logged sets (any exercise); sessionSets = this workout's sets.
 * No records for warm-ups or when this exercise has no working sets in earlier workouts.
 */
export function detectRecords(history: readonly SetLite[], newSet: SetLite, sessionSets: readonly SetLite[]): RecordHit[] {
  if (newSet.kind !== "working") return [];
  const ex = newSet.exerciseId;
  const previous = history.filter((s) => s.exerciseId === ex && s.kind === "working" && s.workoutId !== newSet.workoutId);
  if (!previous.length) return [];
  const session = sessionSets.filter((s) => s.exerciseId === ex && s.kind === "working" && s.workoutId === newSet.workoutId);
  const earlier = session.filter((s) => !sameSet(s, newSet) && s.completedAt <= newSet.completedAt);
  const baseline = [...previous, ...earlier];
  const hits: RecordHit[] = [];
  const push = (kind: RecordKind, value: number, prev: number | null) => {
    if (prev !== null && value > prev + EPS) hits.push({ kind, value, previous: prev });
  };

  push("heaviest", newSet.load, maxOf(baseline.map((s) => s.load)));
  const e = recordE1rm(newSet);
  if (e !== null) push("e1rm", e, maxOf(baseline.map(recordE1rm)));
  push("setVolume", newSet.load * newSet.reps, maxOf(baseline.map((s) => s.load * s.reps)));
  push("repsAtLoad", newSet.reps, maxOf(baseline.filter((s) => s.load >= newSet.load - EPS).map((s) => s.reps)));

  const bestSession = maxOf([...sessionTotals(previous).values()]);
  const before = earlier.reduce((a, s) => a + s.load * s.reps, 0);
  const after = before + newSet.load * newSet.reps;
  if (bestSession !== null && after > bestSession + EPS && before <= bestSession + EPS) {
    hits.push({ kind: "sessionVolume", value: after, previous: bestSession });
  }
  return hits;
}

export interface BestRecords {
  heaviest: number | null;
  bestE1rm: number | null;
  bestSetVolume: number | null;
  bestSessionVolume: number | null;
}

/** All-time bests over working sets (pass one exercise's sets, or give `exerciseId` to filter). */
export function bestRecords(history: readonly SetLite[], exerciseId?: string): BestRecords {
  const w = history.filter((s) => s.kind === "working" && (exerciseId === undefined || s.exerciseId === exerciseId));
  return {
    heaviest: maxOf(w.map((s) => s.load)),
    bestE1rm: maxOf(w.map(recordE1rm)),
    bestSetVolume: maxOf(w.map((s) => s.load * s.reps)),
    bestSessionVolume: maxOf([...sessionTotals(w).values()]),
  };
}

/** Replays a workout's sets in completion order and returns every record hit with its exercise. */
export function sessionRecords(history: readonly SetLite[], workoutSets: readonly SetLite[]): (RecordHit & { exerciseId: string })[] {
  const ordered = [...workoutSets].sort((a, b) => a.completedAt - b.completedAt);
  const out: (RecordHit & { exerciseId: string })[] = [];
  ordered.forEach((s, i) => {
    for (const h of detectRecords(history, s, ordered.slice(0, i + 1))) out.push({ ...h, exerciseId: s.exerciseId });
  });
  return out;
}
