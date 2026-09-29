import { test } from "node:test";
import assert from "node:assert/strict";
import {
  muscleFatigue,
  fatigueBand,
  rankFatigue,
  rirFactor,
  FATIGUE_TAU_H,
  BAND_LABEL,
  type FatigueSet,
} from "../src/engine/fatigue";
import { musclesFor, weeklySetsPerMuscle, MUSCLES, MUSCLE_LABEL, type Muscle } from "../src/engine/volume";
import { allSeedExercises, seedExercises, seedExercisesV2, seedReleases, seedTemplates, SEED_VERSION } from "../src/db/seed";

const H = 3600000;
const NOW = Date.parse("2026-09-28T18:00:00Z");
const set = (exerciseName: string, hoursAgo: number, rir: number | null = 2, kind: "warmup" | "working" = "working", group?: string): FatigueSet => ({
  exerciseName,
  group,
  rir,
  kind,
  completedAt: NOW - hoursAgo * H,
});
const times = (n: number, f: (i: number) => FatigueSet) => Array.from({ length: n }, (_, i) => f(i));

// ---------- fatigue model ----------

test("fatigue: fresh muscles are band 0 with no ready time", () => {
  const f = muscleFatigue([], NOW);
  assert.deepEqual(Object.keys(f).sort(), [...MUSCLES].sort());
  for (const m of MUSCLES) {
    assert.equal(f[m].band, 0);
    assert.equal(f[m].level, 0);
    assert.equal(f[m].readyInH, null);
    assert.equal(f[m].lastTrainedMs, null);
    assert.equal(f[m].hardSets72h, 0);
  }
});

test("fatigue: six hard chest sets just now → HIGH, then decays to LOW or less in about 3 days", () => {
  const sets = times(6, (i) => set("Chest press (machine)", 0.5 - i * 0.05));
  const f = muscleFatigue(sets, NOW);
  assert.ok(f.chest.band >= 3, `band ${f.chest.band} level ${f.chest.level}`);
  assert.ok(f.chest.level > 0.55 && f.chest.level < 0.8);
  assert.equal(f.chest.hardSets72h, 6);
  assert.equal(f.chest.lastTrainedMs, NOW - 0.25 * H);
  // secondary muscles (triceps, shoulders) get less
  assert.ok(f.triceps.level < f.chest.level && f.triceps.level > 0);
  assert.ok(f.shoulders.level < f.chest.level && f.shoulders.level > 0);
  assert.equal(f.triceps.hardSets72h, 3);
  assert.ok(f.triceps.band < f.chest.band);
  // untouched muscles stay fresh
  assert.equal(f.quads.band, 0);
  assert.equal(f.quads.readyInH, null);
  // ~3 days later
  const later = muscleFatigue(sets, NOW + 72 * H);
  assert.ok(later.chest.band <= 1, `band ${later.chest.band}`);
  assert.equal(later.chest.readyInH, 0);
  assert.equal(later.chest.hardSets72h, 0);
  // monotone decay
  let prev = 1;
  for (let h = 0; h <= 96; h += 6) {
    const lv = muscleFatigue(sets, NOW + h * H).chest.level;
    assert.ok(lv <= prev + 1e-12);
    prev = lv;
  }
});

test("fatigue: readyInH is the time until the level drops below 0.30", () => {
  const sets = times(6, () => set("Chest press (machine)", 0));
  const f = muscleFatigue(sets, NOW);
  const r = f.chest.readyInH!;
  // F = 6 → τ·ln(6 / (−6·ln 0.7)) = 30·ln(2.804) ≈ 30.9 h
  assert.equal(r, 31);
  assert.ok(muscleFatigue(sets, NOW + (r - 1) * H).chest.level >= 0.3);
  assert.ok(muscleFatigue(sets, NOW + r * H).chest.level < 0.3);
  assert.equal(muscleFatigue(sets, NOW + r * H).chest.readyInH, 0);
  // readiness counts down as time passes
  assert.equal(muscleFatigue(sets, NOW + 10 * H).chest.readyInH, r - 10);
  // small muscles recover faster than large ones for the same stimulus
  const arms = muscleFatigue(times(6, () => set("Dumbbell curl", 0)), NOW);
  assert.ok(arms.biceps.readyInH! < r);
  assert.equal(FATIGUE_TAU_H.biceps, 18);
});

test("fatigue: warm-ups, easy sets, future sets and sets older than 7 days are ignored", () => {
  const f = muscleFatigue(
    [
      set("Leg press", 1, 1, "warmup"),
      set("Leg press", 1, 5),
      set("Leg press", -2, 1), // after now
      set("Leg press", 24 * 7 + 1, 0), // outside the window
    ],
    NOW,
  );
  assert.equal(f.quads.level, 0);
  assert.equal(f.quads.band, 0);
  // the old set still counts as the last time the muscle was trained
  assert.equal(f.quads.lastTrainedMs, NOW - (24 * 7 + 1) * H);
  assert.equal(f.quads.readyInH, 0);
});

test("fatigue: RIR factor and bands", () => {
  assert.equal(rirFactor(0), 1.2);
  assert.equal(rirFactor(1), 1.1);
  assert.equal(rirFactor(2), 1.0);
  assert.equal(rirFactor(3), 0.85);
  assert.equal(rirFactor(4), 0.7);
  assert.equal(rirFactor(null), 1.0);
  const hard = muscleFatigue(times(4, () => set("Leg extension", 0, 0)), NOW).quads.level;
  const easy = muscleFatigue(times(4, () => set("Leg extension", 0, 4)), NOW).quads.level;
  const unknown = muscleFatigue(times(4, () => set("Leg extension", 0, null)), NOW).quads.level;
  assert.ok(hard > unknown && unknown > easy);
  assert.equal(fatigueBand(0), 0);
  assert.equal(fatigueBand(0.099), 0);
  assert.equal(fatigueBand(0.1), 1);
  assert.equal(fatigueBand(0.3), 2);
  assert.equal(fatigueBand(0.55), 3);
  assert.equal(fatigueBand(0.8), 4);
  assert.equal(fatigueBand(1), 4);
  assert.deepEqual(BAND_LABEL, ["FRESH", "LOW", "MOD", "HIGH", "MAX"]);
  // a big session saturates at MAX but never reaches 1
  const max = muscleFatigue(times(14, () => set("Leg press", 0, 0)), NOW).quads;
  assert.equal(max.band, 4);
  assert.ok(max.level < 1);
});

test("fatigue: group fallback and ranking", () => {
  const f = muscleFatigue([set("Mystery machine", 0, 1, "working", "pull"), set("Mystery machine", 0, 1, "working", "pull")], NOW);
  assert.ok(f.back.level > 0 && f.biceps.level > 0 && f.biceps.level < f.back.level);
  const push = muscleFatigue(
    [...times(6, () => set("Chest press (machine)", 20)), ...times(4, () => set("Triceps pushdown (rope)", 19)), ...times(3, () => set("Leg press", 30))],
    NOW,
  );
  const ranked = rankFatigue(push);
  // chest (τ 30 h) outlasts triceps (τ 18 h) the day after, although triceps got more total stimulus
  assert.equal(ranked[0], "chest");
  assert.ok(ranked.includes("triceps") && ranked.includes("quads"));
  assert.ok(!ranked.includes("calves"));
  for (let i = 1; i < ranked.length; i++) assert.ok(push[ranked[i - 1]].level >= push[ranked[i]].level);
});

// ---------- seed library + muscle mapping ----------

test("seed: releases, ids and templates", () => {
  assert.equal(SEED_VERSION, seedReleases[seedReleases.length - 1].version);
  assert.deepEqual(
    seedReleases.map((r) => r.version),
    seedReleases.map((_, i) => i + 1),
  );
  assert.equal(allSeedExercises.length, seedExercises.length + seedExercisesV2.length);
  const ids = allSeedExercises.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "seed ids are unique");
  const names = allSeedExercises.map((e) => e.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, "seed names are unique");
  for (const e of allSeedExercises) {
    assert.match(e.id, /^ex-[a-z0-9-]+$/);
    assert.ok(e.loads.min < e.loads.max && e.loads.step > 0, e.name);
    assert.ok(Number.isInteger((e.loads.max - e.loads.min) / e.loads.step), e.name);
    assert.ok(e.repMin > 0 && e.repMin < e.repMax, e.name);
  }
  // templates are unchanged and reference release-1 exercises
  assert.deepEqual(
    seedTemplates.map((t) => [t.id, t.exerciseIds]),
    [
      ["tpl-upper", ["ex-chest-press", "ex-lat-pulldown", "ex-shoulder-press", "ex-seated-row", "ex-preacher-curl", "ex-triceps-pressdown"]],
      ["tpl-lower", ["ex-leg-press", "ex-leg-extension", "ex-seated-leg-curl", "ex-calf-raise", "ex-ab-crunch"]],
    ],
  );
  assert.ok(seedExercises.some((e) => e.id === "ex-chest-press" && e.name === "Chest press (machine)"));
  assert.ok(seedExercises.some((e) => e.id === "ex-triceps-pressdown" && e.name === "Triceps pressdown (cable)"));
});

test("seed: every seed exercise maps to at least one primary muscle", () => {
  for (const e of allSeedExercises) {
    const m = musclesFor(e.name, e.group);
    assert.ok(m.primary.length >= 1, e.name);
    for (const x of m.secondary) assert.ok(!m.primary.includes(x), e.name);
  }
});

test("seed: release-2 muscle mapping", () => {
  const expected: Record<string, [Muscle[], Muscle[]]> = {
    "Incline chest press (machine)": [["chest"], ["triceps", "shoulders"]],
    "Chest-supported row (machine)": [["back"], ["biceps", "shoulders"]],
    "Pec fly (machine)": [["chest"], ["shoulders"]],
    "Rear delt fly (machine)": [["shoulders"], ["back"]],
    "Lateral raise (machine)": [["shoulders"], []],
    "Biceps curl (machine)": [["biceps"], []],
    "Triceps extension (machine)": [["triceps"], []],
    "Seated dip (machine)": [["triceps"], ["chest", "shoulders"]],
    "Assisted dip (machine)": [["triceps"], ["chest", "shoulders"]],
    "Rotary torso (machine)": [["abs"], []],
    "Glute drive (hip thrust machine)": [["glutes"], ["hamstrings"]],
    "Standing calf raise (machine)": [["calves"], []],
    "Seated calf raise (machine)": [["calves"], []],
    "Hack squat (machine)": [["quads"], ["glutes"]],
    "Reverse curl (cable)": [["forearms"], ["biceps"]],
    "Cable curl (straight bar)": [["biceps"], []],
    "Rope hammer curl (cable)": [["biceps"], ["forearms"]],
    "Triceps pushdown (rope)": [["triceps"], []],
    "Triceps pushdown (straight bar)": [["triceps"], []],
    "Overhead triceps extension (cable)": [["triceps"], []],
    "Cable crossover (high to low)": [["chest"], ["shoulders"]],
    "Low-to-high cable fly": [["chest"], ["shoulders"]],
    "Cable lateral raise": [["shoulders"], []],
    "Cable front raise": [["shoulders"], []],
    "Cable upright row": [["shoulders"], ["back"]],
    "Straight-arm pulldown (cable)": [["back"], []],
    "Single-arm lat pulldown (cable)": [["back"], ["biceps"]],
    "Single-arm cable row": [["back"], ["biceps"]],
    "Cable rear delt fly": [["shoulders"], ["back"]],
    "Cable crunch": [["abs"], []],
    "Cable woodchopper": [["abs"], []],
    "Pallof press (cable)": [["abs"], []],
    "Cable pull-through": [["glutes"], ["hamstrings"]],
    "Cable glute kickback": [["glutes"], ["hamstrings"]],
    "Cable hip abduction": [["glutes"], []],
    "Cable shrug": [["back"], []],
    "Cable wrist curl": [["forearms"], []],
    "Cable Y-raise": [["shoulders"], []],
  };
  assert.equal(seedExercisesV2.length, Object.keys(expected).length);
  for (const e of seedExercisesV2) {
    const want = expected[e.name];
    assert.ok(want, `unexpected seed exercise ${e.name}`);
    assert.deepEqual(musclesFor(e.name, e.group), { primary: want[0], secondary: want[1] }, e.name);
  }
  // release-1 names keep their mapping
  assert.deepEqual(musclesFor("Lying leg curl (prone)"), { primary: ["hamstrings"], secondary: [] });
  assert.deepEqual(musclesFor("Triceps pressdown (cable)"), { primary: ["triceps"], secondary: [] });
  assert.deepEqual(musclesFor("Close-grip bench press"), { primary: ["triceps"], secondary: ["chest"] });
  assert.deepEqual(musclesFor("Hammer curl"), { primary: ["biceps"], secondary: ["forearms"] });
  assert.deepEqual(musclesFor("Dumbbell curl"), { primary: ["biceps"], secondary: [] });
  assert.deepEqual(musclesFor("Triceps kickback"), { primary: ["triceps"], secondary: [] });
});

test("volume: forearms is a first-class muscle", () => {
  assert.ok(MUSCLES.includes("forearms"));
  assert.equal(MUSCLE_LABEL.forearms, "FOREARMS");
  const v = weeklySetsPerMuscle(
    [
      { exerciseName: "Reverse curl (cable)", rir: 2, kind: "working", completedAt: 5 },
      { exerciseName: "Cable wrist curl", rir: 2, kind: "working", completedAt: 6 },
    ],
    0,
    10,
  );
  assert.equal(v.forearms, 2);
  assert.equal(v.biceps, 0.5);
});
