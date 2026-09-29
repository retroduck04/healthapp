// Weekly hard sets per muscle from exercise names (keyword rules), Hevy/RP-style set counting.
//
// Refinements to the brief (documented deviations):
// - Adds "adductors": the seed's "Hip adduction" has no sensible home among the other ten muscles.
// - "Back extension" maps to back (erectors) + glutes/hamstrings; "Face pull"/rear-delt work to shoulders + back.
// - Group fallback for "arms" is biceps + triceps as secondary (half a set each), since the name gave no hint.
// - Adds "forearms" (seed v2: reverse curl, wrist curl; hammer curls count forearms as secondary).
// - Upright rows count back (traps) as secondary; straight-arm pulldowns are back only (no elbow flexion);
//   chest-supported rows are back work (the word "chest" names the pad, not the target).

export type Muscle =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "adductors"
  | "calves"
  | "abs";

export const MUSCLES: readonly Muscle[] = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "adductors",
  "calves",
  "abs",
];

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: "CHEST",
  back: "BACK",
  shoulders: "SHOULDERS",
  biceps: "BICEPS",
  triceps: "TRICEPS",
  forearms: "FOREARMS",
  quads: "QUADS",
  hamstrings: "HAMSTRINGS",
  glutes: "GLUTES",
  adductors: "ADDUCTORS",
  calves: "CALVES",
  abs: "ABS",
};

export interface MuscleMap {
  primary: Muscle[];
  secondary: Muscle[];
}

type Rule = [RegExp, Muscle[], Muscle[]];

// First match wins, so specific phrases come before the generic words they contain.
const RULES: readonly Rule[] = [
  [/\bcalf|\bcalves/, ["calves"], []],
  [/pull[- ]?through/, ["glutes"], ["hamstrings"]],
  [/hip thrust|glute (bridge|drive|kickback)|\bbridge/, ["glutes"], ["hamstrings"]],
  [/glute|abduct/, ["glutes"], []],
  [/adduct/, ["adductors"], []],
  [/back extension|hyperextension|good ?morning/, ["back"], ["glutes", "hamstrings"]],
  [/wrist|forearm|gripper/, ["forearms"], []],
  [/reverse[- ](grip )?curl|zottman/, ["forearms"], ["biceps"]],
  [/tricep|pressdown|push ?down|skull ?crusher|french press|kickback/, ["triceps"], []],
  [/close[- ]grip bench/, ["triceps"], ["chest"]],
  [/leg extension|quad extension/, ["quads"], []],
  [/leg curl|hamstring curl|nordic/, ["hamstrings"], []],
  [/leg press|squat|hack|lunge|split squat|step[- ]?up|pendulum/, ["quads"], ["glutes"]],
  [/deadlift|\brdl\b|romanian|stiff[- ]leg/, ["hamstrings"], ["glutes", "back"]],
  [/crunch|\babs?\b|abdominal|plank|sit[- ]?up|leg raise|knee raise|rollout|wood ?chop|pallof|oblique|rotary|torso|twist/, ["abs"], []],
  [/face pull|rear delt|reverse (pec deck|fly|flye)/, ["shoulders"], ["back"]],
  [/upright row/, ["shoulders"], ["back"]],
  [/lateral raise|lat raise|side raise|front raise|\by[- ]raise/, ["shoulders"], []],
  [/shoulder press|overhead press|military|\bohp\b|arnold|landmine press/, ["shoulders"], ["triceps"]],
  [/\bdips?\b/, ["triceps"], ["chest", "shoulders"]],
  [/chest[- ]supported/, ["back"], ["biceps", "shoulders"]],
  [/straight[- ]arm/, ["back"], []],
  [/pec deck|\bfly|\bflye|crossover|\bpec\b/, ["chest"], ["shoulders"]],
  [/chest press|bench|push[- ]?up|\bchest\b/, ["chest"], ["triceps", "shoulders"]],
  [/pulldown|pull[- ]down|pull[- ]?up|chin[- ]?up|\brow\b|\browing\b|pullover|\blat\b|\blats\b/, ["back"], ["biceps"]],
  [/shrug/, ["back"], []],
  [/hammer/, ["biceps"], ["forearms"]],
  [/curl|preacher/, ["biceps"], []],
  [/extension/, ["triceps"], []],
  [/press/, ["chest"], ["triceps", "shoulders"]],
];

const GROUP_FALLBACK: Record<string, MuscleMap> = {
  push: { primary: ["chest"], secondary: ["triceps", "shoulders"] },
  pull: { primary: ["back"], secondary: ["biceps"] },
  legs: { primary: ["quads"], secondary: ["glutes"] },
  core: { primary: ["abs"], secondary: [] },
  arms: { primary: [], secondary: ["biceps", "triceps"] },
};

/** Primary/secondary muscles for an exercise name by ordered keyword rules; falls back to the exercise group. */
export function musclesFor(exerciseName: string, group?: string): MuscleMap {
  const name = exerciseName.toLowerCase();
  for (const [re, primary, secondary] of RULES) if (re.test(name)) return { primary: [...primary], secondary: [...secondary] };
  const g = group ? GROUP_FALLBACK[group] : undefined;
  return g ? { primary: [...g.primary], secondary: [...g.secondary] } : { primary: [], secondary: [] };
}

export interface VolumeSet {
  exerciseName: string;
  group?: string;
  rir: number | null;
  kind: "warmup" | "working";
  completedAt: number;
}

/** Hard sets per muscle in [fromMs, toMs): working sets with RIR ≤ 4 (or unknown); primary +1, secondary +0.5. */
export function weeklySetsPerMuscle(sets: readonly VolumeSet[], fromMs: number, toMs: number): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  const cache = new Map<string, MuscleMap>();
  for (const s of sets) {
    if (s.kind !== "working" || s.completedAt < fromMs || s.completedAt >= toMs) continue;
    if (s.rir !== null && s.rir > 4) continue;
    const key = `${s.exerciseName}\u0000${s.group ?? ""}`;
    let m = cache.get(key);
    if (!m) cache.set(key, (m = musclesFor(s.exerciseName, s.group)));
    for (const p of m.primary) out[p] += 1;
    for (const p of m.secondary) out[p] += 0.5;
  }
  return out;
}
