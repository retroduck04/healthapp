// Starter exercise library (generic names for common gym machines) and two templates.
// Load ranges are editable per machine; these are only starting points.
//
// Seed versions: an existing database records the version it was seeded with (meta "seedVersion";
// databases from before versioning only have meta "seeded" and count as version 1). On start-up
// ensureSeeded() inserts the exercises of every newer release whose id is missing. It never
// overwrites a stored exercise (the owner may have edited its loads) and never revives an archived one.
// Ids are stable forever: never rename or reuse an id, only add new releases.

import type { Exercise, Template } from "./types";

const machine = { min: 10, max: 300, step: 10 };
const cable = { min: 5, max: 200, step: 5 };
const dumbbell = { min: 5, max: 75, step: 5 };
const plates = { min: 0, max: 400, step: 10 };
/** smaller selectorized stacks (isolation machines) */
const machineSmall = { min: 10, max: 200, step: 10 };

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

/** Seed release 1: the original library. Frozen (tests pin its length and ids). */
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
  ex("ex-lying-leg-curl", "Lying leg curl (prone)", "machine", "legs", machine, 10, 15),
  ex("ex-calf-raise", "Calf raise (machine)", "machine", "legs", machine, 10, 15),
  ex("ex-hip-abduction", "Hip abduction", "machine", "legs", machine, 12, 20),
  ex("ex-hip-adduction", "Hip adduction", "machine", "legs", machine, 12, 20),
  ex("ex-ab-crunch", "Ab crunch (machine)", "machine", "core", machine, 10, 15),
  ex("ex-back-extension", "Back extension", "bodyweight", "core", { min: 0, max: 100, step: 5 }, 10, 15, "Load = added weight."),
];

/** Seed release 2: Planet Fitness selectorized machines and cable-station exercises. */
export const seedExercisesV2: Exercise[] = [
  // machines
  ex("ex-incline-chest-press", "Incline chest press (machine)", "machine", "push", machine, 8, 12, "Seat so the handles line up with the upper chest."),
  ex("ex-chest-supported-row", "Chest-supported row (machine)", "machine", "pull", machine, 8, 12, "Chest pad set so the arms are fully straight at the start."),
  ex("ex-pec-fly", "Pec fly (machine)", "machine", "push", machineSmall, 10, 15, "Pec fly / rear delt machine: handles to the front, elbows slightly bent."),
  ex("ex-rear-delt-fly", "Rear delt fly (machine)", "machine", "pull", machineSmall, 12, 20, "Pec fly / rear delt machine: face the pad, handles to the back."),
  ex("ex-lateral-raise-machine", "Lateral raise (machine)", "machine", "push", machineSmall, 10, 15, "Shoulders in line with the machine pivots."),
  ex("ex-biceps-curl-machine", "Biceps curl (machine)", "machine", "arms", machineSmall, 10, 15, "Elbows in line with the machine pivot."),
  ex("ex-triceps-extension-machine", "Triceps extension (machine)", "machine", "arms", machineSmall, 10, 15, "Elbows in line with the machine pivot."),
  ex("ex-seated-dip", "Seated dip (machine)", "machine", "push", machine, 8, 12, "Press the handles down; torso upright."),
  ex("ex-assisted-dip", "Assisted dip (machine)", "machine", "push", machine, 6, 12, "Load = assistance (lower is harder)."),
  ex("ex-rotary-torso", "Rotary torso (machine)", "machine", "core", machineSmall, 10, 15, "One set = both directions."),
  ex("ex-glute-drive", "Glute drive (hip thrust machine)", "machine", "legs", plates, 8, 12, "Pad across the hips. If plate-loaded: load = plates added."),
  ex("ex-standing-calf-raise", "Standing calf raise (machine)", "machine", "legs", machine, 10, 15, "Full stretch at the bottom, pause at the top."),
  ex("ex-seated-calf-raise", "Seated calf raise (machine)", "machine", "legs", { min: 0, max: 300, step: 10 }, 12, 20, "If plate-loaded: load = plates added."),
  ex("ex-hack-squat", "Hack squat (machine)", "machine", "legs", plates, 6, 10, "Plate-loaded at most clubs: load = plates added, not counting the sled."),
  // cable station (load = the stack pin; single-arm work: one set = both sides)
  ex("ex-cable-reverse-curl", "Reverse curl (cable)", "cable", "arms", cable, 10, 15, "Straight bar, pulley low, palms down."),
  ex("ex-cable-curl-bar", "Cable curl (straight bar)", "cable", "arms", cable, 10, 15, "Straight bar, pulley low."),
  ex("ex-cable-hammer-curl", "Rope hammer curl (cable)", "cable", "arms", cable, 10, 15, "Rope, pulley low, palms facing in."),
  ex("ex-pushdown-rope", "Triceps pushdown (rope)", "cable", "arms", cable, 10, 15, "Pulley high; spread the rope at the bottom."),
  ex("ex-pushdown-bar", "Triceps pushdown (straight bar)", "cable", "arms", cable, 10, 15, "Pulley high."),
  ex("ex-cable-overhead-triceps", "Overhead triceps extension (cable)", "cable", "arms", cable, 10, 15, "Rope; face away from the stack."),
  ex("ex-cable-crossover", "Cable crossover (high to low)", "cable", "push", cable, 10, 15, "Pulleys high; sweep down and together."),
  ex("ex-cable-fly-low-high", "Low-to-high cable fly", "cable", "push", cable, 10, 15, "Pulleys low; sweep up to chin height."),
  ex("ex-cable-lateral-raise", "Cable lateral raise", "cable", "push", cable, 12, 20, "Pulley low, one arm at a time."),
  ex("ex-cable-front-raise", "Cable front raise", "cable", "push", cable, 10, 15, "Pulley low; rope or straight bar."),
  ex("ex-cable-upright-row", "Cable upright row", "cable", "pull", cable, 10, 15, "Pulley low; straight bar or rope."),
  ex("ex-straight-arm-pulldown", "Straight-arm pulldown (cable)", "cable", "pull", cable, 10, 15, "Pulley high; arms straight, bar to the thighs."),
  ex("ex-single-arm-pulldown", "Single-arm lat pulldown (cable)", "cable", "pull", cable, 10, 15, "Pulley high, one handle."),
  ex("ex-single-arm-cable-row", "Single-arm cable row", "cable", "pull", cable, 10, 15, "Pulley at chest height, one handle."),
  ex("ex-cable-rear-delt-fly", "Cable rear delt fly", "cable", "pull", cable, 12, 20, "Pulleys at shoulder height; cross the cables."),
  ex("ex-cable-crunch", "Cable crunch", "cable", "core", cable, 10, 15, "Rope, pulley high; kneel facing the stack."),
  ex("ex-cable-woodchopper", "Cable woodchopper", "cable", "core", cable, 10, 15, "Pulley high. One set = both sides."),
  ex("ex-pallof-press", "Pallof press (cable)", "cable", "core", cable, 10, 15, "Pulley at chest height; press out and hold. One set = both sides."),
  ex("ex-cable-pull-through", "Cable pull-through", "cable", "legs", cable, 10, 15, "Rope, pulley low, face away; hinge at the hips."),
  ex("ex-cable-glute-kickback", "Cable glute kickback", "cable", "legs", cable, 12, 20, "Ankle strap, pulley low."),
  ex("ex-cable-hip-abduction", "Cable hip abduction", "cable", "legs", cable, 12, 20, "Ankle strap, pulley low; leg out to the side."),
  ex("ex-cable-shrug", "Cable shrug", "cable", "pull", cable, 10, 15, "Straight bar, pulley low."),
  ex("ex-cable-wrist-curl", "Cable wrist curl", "cable", "arms", cable, 12, 20, "Straight bar, pulley low; forearms on the thighs."),
  ex("ex-cable-y-raise", "Cable Y-raise", "cable", "pull", cable, 12, 20, "Pulleys low, cables crossed; raise into a Y."),
];

/** Current seed release. Bump it when a new release list is added below. */
export const SEED_VERSION = 2;

/** Every seed release, oldest first. */
export const seedReleases: { version: number; exercises: Exercise[] }[] = [
  { version: 1, exercises: seedExercises },
  { version: 2, exercises: seedExercisesV2 },
];

/** The whole seed library (all releases). */
export const allSeedExercises: Exercise[] = seedReleases.flatMap((r) => r.exercises);

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
