// Strength maths: e1RM, rep prediction and double-progression advice.

export interface SetResult {
  load: number; // in the machine's own display unit (e.g. stack number in lb)
  reps: number;
  rir?: number | null; // reps in reserve; 0 = failure
}

/** Epley estimated 1RM using reps-to-failure (reps + reps in reserve). A within-exercise index above ~12 reps. */
export function e1RM(load: number, reps: number, rir = 0): number {
  return load * (1 + (reps + Math.max(rir, 0)) / 30);
}

/** Predicted reps at `load` for set `setIndex` (1-based), leaving `targetRIR` in reserve. */
export function predictedReps(e1rm: number, load: number, targetRIR: number, setIndex = 1, fatiguePerSet = 1): number {
  if (load <= 0) return 0;
  const toFailure = 30 * (e1rm / load - 1);
  return Math.max(0, toFailure - targetRIR - fatiguePerSet * Math.max(setIndex - 1, 0));
}

export const nextLoad = (load: number, available: readonly number[]): number | null => {
  const heavier = available.filter((x) => x > load + 1e-9);
  return heavier.length ? Math.min(...heavier) : null;
};

export const previousLoad = (load: number, available: readonly number[]): number | null => {
  const lighter = available.filter((x) => x < load - 1e-9);
  return lighter.length ? Math.max(...lighter) : null;
};

/** All selectable loads for an increment spec like { min: 10, max: 300, step: 10 } plus optional extras. */
export function loadsFromSpec(spec: { min: number; max: number; step: number; extras?: number[] }): number[] {
  const out = new Set<number>();
  if (spec.step > 0 && spec.max >= spec.min) {
    for (let x = spec.min; x <= spec.max + 1e-9; x += spec.step) out.add(Math.round(x * 100) / 100);
  }
  for (const e of spec.extras ?? []) out.add(e);
  return [...out].sort((a, b) => a - b);
}

export type ProgressionAdvice =
  | { kind: "increaseLoad"; load: number; repMin: number; repMax: number }
  | { kind: "addReps"; load: number; targetReps: number }
  | { kind: "repeatLoad"; load: number }
  | { kind: "reduceLoad"; load: number }
  | { kind: "insufficientData" };

export interface ProgressionRules {
  repMin: number;
  repMax: number;
  targetRIR: number;
  maxJumpFraction: number; // bigger jumps are avoided; reps are extended instead
}

export const defaultRules: ProgressionRules = { repMin: 8, repMax: 12, targetRIR: 1, maxJumpFraction: 0.1 };

const fmtLoad = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100));

function consecutiveSessionsBelow(repMin: number, sessions: readonly SetResult[][]): number {
  let streak = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (!s.length) break;
    const top = Math.max(...s.map((x) => x.load));
    const best = Math.max(...s.filter((x) => x.load === top).map((x) => x.reps));
    if (best < repMin) streak++;
    else break;
  }
  return streak;
}

/**
 * Double progression: add reps within a range, then add load using the machine's real increments.
 * @param sessions working sets per session for this exercise, most recent LAST.
 */
export function adviseProgression(
  sessions: readonly SetResult[][],
  availableLoads: readonly number[],
  rules: ProgressionRules = defaultRules,
): { advice: ProgressionAdvice; why: string } {
  const last = sessions.length ? sessions[sessions.length - 1] : [];
  if (!last.length) return { advice: { kind: "insufficientData" }, why: "No previous working sets for this exercise yet." };
  const { repMin, repMax, targetRIR, maxJumpFraction } = rules;
  const top = Math.max(...last.map((s) => s.load));
  const topSets = last.filter((s) => s.load === top);
  const L = fmtLoad(top);

  const allAtTop = topSets.every((s) => s.reps >= repMax && (s.rir ?? targetRIR) >= targetRIR);
  if (allAtTop) {
    const next = nextLoad(top, availableLoads);
    if (next === null) {
      return {
        advice: { kind: "addReps", load: top, targetReps: repMax + 1 },
        why: `You reached the top of your ${repMin}–${repMax} range at ${L}, and no heavier setting is recorded for this machine.`,
      };
    }
    const jump = (next - top) / top;
    if (jump <= maxJumpFraction) {
      const newTop = Math.min(repMin + 2, repMax);
      return {
        advice: { kind: "increaseLoad", load: next, repMin, repMax: newTop },
        why: `Every working set reached ${repMax} reps at ${L}. The next setting is ${fmtLoad(next)}. Target: ${fmtLoad(next)} × ${repMin}–${newTop}.`,
      };
    }
    return {
      advice: { kind: "addReps", load: top, targetReps: repMax + 2 },
      why: `The next setting (${fmtLoad(next)}) is a ${Math.round(jump * 100)}% jump, so add reps at ${L} first.`,
    };
  }

  const below = consecutiveSessionsBelow(repMin, sessions);
  if (below >= 2) {
    const lighter = previousLoad(top, availableLoads);
    if (lighter !== null) {
      return {
        advice: { kind: "reduceLoad", load: lighter },
        why: `Two sessions in a row fell below ${repMin} reps at ${L}. Drop one setting to ${fmtLoad(lighter)}.`,
      };
    }
    return { advice: { kind: "repeatLoad", load: top }, why: `Two sessions fell below ${repMin} reps, but no lighter setting is recorded; repeat ${L}.` };
  }
  if (below === 1) {
    return { advice: { kind: "repeatLoad", load: top }, why: `Last session fell below ${repMin} reps at ${L}. Repeat the load before changing anything.` };
  }
  const weakest = Math.min(...topSets.map((s) => s.reps));
  const target = Math.min(weakest + 1, repMax);
  return {
    advice: { kind: "addReps", load: top, targetReps: target },
    why: `You're inside your ${repMin}–${repMax} range at ${L}. Aim for ${target} reps on your weakest set.`,
  };
}
