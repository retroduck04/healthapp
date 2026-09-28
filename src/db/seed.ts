// Starter exercise library (generic names for common gym machines) and two templates.
// Load ranges are editable per machine; these are only starting points.

import type { Exercise, Template } from "./types";

const machine = { min: 10, max: 300, step: 10 };
const cable = { min: 5, max: 200, step: 5 };
const dumbbell = { min: 5, max: 75, step: 5 };
const plates = { min: 0, max: 400, step: 10 };

const ex = (
  id: string,
  name: string,
  equipment: Exercise["equipment"],
  group: Exercise["group"],
  loads: Exercise["loads"],
  repMin = 8,
  repMax = 12,
  setupNote?: string,
): Exercise => ({ id, name, equipment, group, loads, repMin, repMax, targetRIR: 1, setupNote });

export const seedExercises: Exercise[] = [
  ex("ex-chest-press", "Chest press (machine)", "machine", "push", machine),
  ex("ex-pec-deck", "Pec deck", "machine", "push", machine, 10, 15),
  ex("ex-shoulder-press", "Shoulder press (machine)", "machine", "push", machine),
  ex("ex-smith-bench", "Smith machine bench press", "smith", "push", plates, 6, 10, "Load = plates added, not counting the bar."),
  ex("ex-db-bench", "Dumbbell bench press", "dumbbell", "push", dumbbell, 6, 10, "Load = one dumbbell."),
  ex("ex-db-shoulder", "Dumbbell shoulder press", "dumbbell", "push", dumbbell, 6, 10, "Load = one dumbbell."),
  ex("ex-lateral-raise", "Dumbbell lateral raise", "dumbbell", "push", dumbbell, 10, 15, "Load = one dumbbell."),
  ex("ex-cable-fly", "Cable fly", "cable", "push", cable, 10, 15),
  ex("ex-triceps-pressdown", "Triceps pressdown (cable)", "cable", "arms", cable, 10, 15),
  ex("ex-lat-pulldown", "Lat pulldown", "machine", "pull", machine),
  ex("ex-seated-row", "Seated row (machine)", "machine", "pull", machine),
  ex("ex-cable-row", "Seated cable row", "cable", "pull", cable),
  ex("ex-db-row", "One-arm dumbbell row", "dumbbell", "pull", dumbbell, 8, 12, "Load = one dumbbell."),
  ex("ex-assisted-pullup", "Assisted pull-up", "machine", "pull", machine, 6, 12, "Load = assistance (lower is harder)."),
  ex("ex-face-pull", "Face pull (cable)", "cable", "pull", cable, 12, 20),
  ex("ex-preacher-curl", "Preacher curl (machine)", "machine", "arms", machine, 10, 15),
  ex("ex-db-curl", "Dumbbell curl", "dumbbell", "arms", dumbbell, 10, 15, "Load = one dumbbell."),
  ex("ex-leg-press", "Leg press", "machine", "legs", machine, 10, 15),
  ex("ex-smith-squat", "Smith machine squat", "smith", "legs", plates, 6, 10, "Load = plates added, not counting the bar."),
  ex("ex-leg-extension", "Leg extension", "machine", "legs", machine, 10, 15),
  ex("ex-seated-leg-curl", "Seated leg curl", "machine", "legs", machine, 10, 15),
  ex("ex-lying-leg-curl", "Lying leg curl", "machine", "legs", machine, 10, 15),
  ex("ex-calf-raise", "Calf raise (machine)", "machine", "legs", machine, 10, 15),
  ex("ex-hip-abduction", "Hip abduction", "machine", "legs", machine, 12, 20),
  ex("ex-hip-adduction", "Hip adduction", "machine", "legs", machine, 12, 20),
  ex("ex-ab-crunch", "Ab crunch (machine)", "machine", "core", machine, 10, 15),
  ex("ex-back-extension", "Back extension", "bodyweight", "core", { min: 0, max: 100, step: 5 }, 10, 15, "Load = added weight."),
];

export const seedTemplates: Template[] = [
  {
    id: "tpl-upper",
    name: "Upper",
    exerciseIds: ["ex-chest-press", "ex-lat-pulldown", "ex-shoulder-press", "ex-seated-row", "ex-preacher-curl", "ex-triceps-pressdown"],
    setsPerExercise: 3,
  },
  {
    id: "tpl-lower",
    name: "Lower",
    exerciseIds: ["ex-leg-press", "ex-leg-extension", "ex-seated-leg-curl", "ex-calf-raise", "ex-ab-crunch"],
    setsPerExercise: 3,
  },
];
