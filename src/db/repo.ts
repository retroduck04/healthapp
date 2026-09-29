// Domain operations on top of the raw store.

import { deviceTimeZone, nutritionDay, type ISODate } from "../engine/dates";
import { loadsFromSpec, type SetResult } from "../engine/strength";
import { byIndex, del, delMany, get, getAll, put, putMany, uid } from "./db";
import { SEED_VERSION, seedReleases, seedTemplates } from "./seed";
import {
  defaultSettings,
  type CaffeineEntry,
  type CardioSession,
  type CheckIn,
  type DayStatus,
  type Exercise,
  type Food,
  type FoodEntry,
  type Meal,
  type Nutrients,
  type SavedMeal,
  type Settings,
  type StrengthSet,
  type Template,
  type WeightEntry,
  type Workout,
} from "./types";

export const TZ = deviceTimeZone();

// ---- settings & seed ------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  const row = await get<{ key: string; value: Partial<Settings> }>("meta", "settings");
  return { ...defaultSettings, ...(row?.value ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await put("meta", { key: "settings", value: { ...current, ...patch } });
}

/**
 * Seeds the exercise library and templates on first run, then adds the exercises of every newer seed
 * release on later runs (meta "seedVersion"; a database with only meta "seeded" counts as version 1).
 * Only missing ids are inserted: stored exercises (edited load ranges, archived ones) are never touched,
 * and an older release is never replayed, so nothing the owner removed from use comes back.
 */
export async function ensureSeeded(): Promise<void> {
  const [seeded, ver] = await Promise.all([
    get<{ key: string; value: boolean }>("meta", "seeded"),
    get<{ key: string; value: number }>("meta", "seedVersion"),
  ]);
  const have = typeof ver?.value === "number" ? ver.value : seeded?.value ? 1 : 0;
  if (have >= SEED_VERSION) return;
  const stored = new Set((await getAll<Exercise>("exercises")).map((e) => e.id));
  const add = seedReleases.filter((r) => r.version > have).flatMap((r) => r.exercises).filter((e) => !stored.has(e.id));
  if (add.length) await putMany("exercises", add);
  if (have === 0) {
    const tpl = new Set((await getAll<Template>("templates")).map((t) => t.id));
    const missing = seedTemplates.filter((t) => !tpl.has(t.id));
    if (missing.length) await putMany("templates", missing);
    await put("meta", { key: "seeded", value: true });
  }
  await put("meta", { key: "seedVersion", value: SEED_VERSION });
}

export const today = (settings?: Settings): ISODate => nutritionDay(Date.now(), TZ, settings?.dayBoundaryHour ?? 4);

// ---- bodyweight -----------------------------------------------------------

export async function listWeights(): Promise<WeightEntry[]> {
  return (await getAll<WeightEntry>("weights")).sort((a, b) => a.t - b.t);
}

export async function addWeight(kg: number, t = Date.now()): Promise<WeightEntry> {
  const w: WeightEntry = { id: uid(), t, kg, source: "manual", quality: "manual" };
  await put("weights", w);
  return w;
}

// ---- food -----------------------------------------------------------------

export function scale(per100g: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  const opt = (v?: number | null) => (v === null || v === undefined ? null : v * f);
  return {
    kcal: per100g.kcal * f,
    protein: per100g.protein * f,
    carbs: per100g.carbs * f,
    fat: per100g.fat * f,
    fiber: opt(per100g.fiber),
    sugar: opt(per100g.sugar),
    sodiumMg: opt(per100g.sodiumMg),
  };
}

export function sumNutrients(items: readonly Nutrients[]): Nutrients {
  return items.reduce<Nutrients>(
    (a, b) => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export async function entriesForDay(day: ISODate): Promise<FoodEntry[]> {
  return (await byIndex<FoodEntry>("entries", "day", day)).sort((a, b) => a.t - b.t);
}

export async function entriesBetween(from: ISODate, to: ISODate): Promise<FoodEntry[]> {
  return byIndex<FoodEntry>("entries", "day", IDBKeyRange.bound(from, to));
}

export async function addEntry(e: Omit<FoodEntry, "id" | "t"> & { t?: number }): Promise<FoodEntry> {
  const entry: FoodEntry = { ...e, id: uid(), t: e.t ?? Date.now() };
  await put("entries", entry);
  return entry;
}

export async function addFoodEntry(food: Food, grams: number, amountLabel: string, day: ISODate, meal: Meal, method: FoodEntry["method"]) {
  await addEntry({ ...scale(food.per100g, grams), day, meal, name: food.brand ? `${food.name} (${food.brand})` : food.name, foodId: food.id, grams: food.unitOnly ? null : grams, amountLabel, method });
  await put("foods", { ...food, lastUsedAt: Date.now(), useCount: (food.useCount ?? 0) + 1 });
}

export async function deleteEntry(id: string): Promise<void> {
  await del("entries", id);
}

export async function allFoods(): Promise<Food[]> {
  return (await getAll<Food>("foods")).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function saveFood(food: Food): Promise<void> {
  await put("foods", food);
}

export async function dayStatus(day: ISODate): Promise<DayStatus> {
  return (await get<DayStatus>("days", day)) ?? { day, complete: null };
}

export async function setDayComplete(day: ISODate, complete: boolean | null): Promise<void> {
  await put("days", { day, complete });
}

export async function copyMeal(fromDay: ISODate, toDay: ISODate, meal?: Meal): Promise<number> {
  const src = (await entriesForDay(fromDay)).filter((e) => !meal || e.meal === meal);
  const now = Date.now();
  await putMany(
    "entries",
    src.map((e, i) => ({ ...e, id: uid(), t: now + i, day: toDay, method: "copy" as const })),
  );
  return src.length;
}

export async function listSavedMeals(): Promise<SavedMeal[]> {
  return (await getAll<SavedMeal>("savedMeals")).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveMealFrom(name: string, entries: readonly FoodEntry[]): Promise<void> {
  const meal: SavedMeal = {
    id: uid(),
    name,
    createdAt: Date.now(),
    items: entries.map((e) => ({
      name: e.name,
      foodId: e.foodId,
      grams: e.grams,
      amountLabel: e.amountLabel,
      kcal: e.kcal,
      protein: e.protein,
      carbs: e.carbs,
      fat: e.fat,
      fiber: e.fiber,
      sugar: e.sugar,
      sodiumMg: e.sodiumMg,
    })),
  };
  await put("savedMeals", meal);
}

export async function addSavedMeal(saved: SavedMeal, day: ISODate, meal: Meal): Promise<void> {
  const now = Date.now();
  await putMany(
    "entries",
    saved.items.map((it, i) => ({ ...it, id: uid(), t: now + i, day, meal, method: "saved" as const })),
  );
}

/** Looks up a barcode in the local cache first, then Open Food Facts. */
export async function lookupBarcode(code: string): Promise<{ food: Food | null; partial?: Partial<Food>; error?: string }> {
  const clean = code.replace(/\D/g, "");
  const local = await byIndex<Food>("foods", "barcode", clean);
  if (local.length) return { food: local[0] };
  let json: any;
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=product_name,product_name_en,product_name_fr,brands,nutriments,serving_size,serving_quantity`,
    );
    if (res.status === 404) return { food: null, error: "Not in Open Food Facts." };
    if (!res.ok) return { food: null, error: `Open Food Facts answered ${res.status}.` };
    json = await res.json();
  } catch {
    return { food: null, error: "Couldn't reach Open Food Facts (offline?)." };
  }
  const p = json?.product;
  if (!p || json.status === 0) return { food: null, error: "Not in Open Food Facts." };
  const parsed = parseOpenFoodFacts(clean, p);
  return parsed.complete ? { food: parsed.food } : { food: null, partial: parsed.food, error: "Open Food Facts has this product but not its full nutrition. Please check the label." };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function parseOpenFoodFacts(barcode: string, p: any): { food: Food; complete: boolean } {
  const n = p.nutriments ?? {};
  let kcal = num(n["energy-kcal_100g"]);
  const kj = num(n["energy_100g"]);
  if (kcal === null && kj !== null) kcal = kj / 4.184;
  const protein = num(n.proteins_100g);
  const carbs = num(n.carbohydrates_100g);
  const fat = num(n.fat_100g);
  const sodium = num(n.sodium_100g);
  const servings = [{ label: "100 g", grams: 100 }];
  const sq = num(p.serving_quantity);
  if (sq && sq > 0) servings.unshift({ label: p.serving_size ? String(p.serving_size) : `${sq} g`, grams: sq });
  const food: Food = {
    id: uid(),
    name: String(p.product_name || p.product_name_en || p.product_name_fr || "Unnamed product").trim(),
    brand: p.brands ? String(p.brands).split(",")[0].trim() : undefined,
    barcode,
    source: "openfoodfacts",
    per100g: {
      kcal: kcal ?? 0,
      protein: protein ?? 0,
      carbs: carbs ?? 0,
      fat: fat ?? 0,
      fiber: num(n.fiber_100g),
      sugar: num(n.sugars_100g),
      sodiumMg: sodium === null ? null : sodium * 1000,
    },
    servings,
    attribution: "Open Food Facts (ODbL)",
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    useCount: 0,
  };
  return { food, complete: kcal !== null && protein !== null && carbs !== null && fat !== null };
}

// ---- strength -------------------------------------------------------------

export async function listExercises(includeArchived = false): Promise<Exercise[]> {
  return (await getAll<Exercise>("exercises")).filter((e) => includeArchived || !e.archived).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTemplates(): Promise<Template[]> {
  return (await getAll<Template>("templates")).sort((a, b) => a.name.localeCompare(b.name));
}

export async function activeWorkout(): Promise<Workout | null> {
  const all = await getAll<Workout>("workouts");
  return all.filter((w) => w.end === null).sort((a, b) => b.start - a.start)[0] ?? null;
}

export async function startWorkout(template?: Template): Promise<Workout> {
  const w: Workout = {
    id: uid(),
    start: Date.now(),
    end: null,
    templateId: template?.id,
    name: template?.name ?? "Workout",
    exerciseIds: template ? [...template.exerciseIds] : [],
  };
  await put("workouts", w);
  return w;
}

export async function setsForWorkout(workoutId: string): Promise<StrengthSet[]> {
  return (await byIndex<StrengthSet>("sets", "workoutId", workoutId)).sort((a, b) => a.completedAt - b.completedAt);
}

export interface ExerciseSession {
  workout: Workout;
  sets: StrengthSet[];
}

/** Completed sessions for an exercise, oldest first (excluding `excludeWorkoutId`). */
export async function exerciseHistory(exerciseId: string, excludeWorkoutId?: string): Promise<ExerciseSession[]> {
  const sets = await byIndex<StrengthSet>("sets", "exerciseId", exerciseId);
  const byWorkout = new Map<string, StrengthSet[]>();
  for (const s of sets) {
    if (s.workoutId === excludeWorkoutId) continue;
    const list = byWorkout.get(s.workoutId) ?? [];
    list.push(s);
    byWorkout.set(s.workoutId, list);
  }
  const out: ExerciseSession[] = [];
  for (const [id, list] of byWorkout) {
    const w = await get<Workout>("workouts", id);
    if (w) out.push({ workout: w, sets: list.sort((a, b) => a.index - b.index) });
  }
  return out.sort((a, b) => a.workout.start - b.workout.start);
}

export const workingSets = (sets: readonly StrengthSet[]): SetResult[] =>
  sets.filter((s) => s.kind === "working").map((s) => ({ load: s.load, reps: s.reps, rir: s.rir }));

export const exerciseLoads = (e: Exercise): number[] => loadsFromSpec(e.loads);

export async function logSet(s: Omit<StrengthSet, "id" | "completedAt">): Promise<StrengthSet> {
  const set: StrengthSet = { ...s, id: uid(), completedAt: Date.now() };
  await put("sets", set);
  return set;
}

export async function finishWorkout(w: Workout, sessionRPE: number | null, notes?: string): Promise<void> {
  const sets = await setsForWorkout(w.id);
  if (!sets.length) {
    await del("workouts", w.id);
    return;
  }
  await put("workouts", { ...w, end: Date.now(), sessionRPE, notes });
}

export async function deleteWorkout(id: string): Promise<void> {
  const sets = await setsForWorkout(id);
  await delMany("sets", sets.map((s) => s.id));
  await del("workouts", id);
}

export async function listWorkouts(): Promise<Workout[]> {
  return (await getAll<Workout>("workouts")).filter((w) => w.end !== null).sort((a, b) => b.start - a.start);
}

// ---- cardio, check-ins, caffeine -----------------------------------------

export async function listCardio(): Promise<CardioSession[]> {
  return (await getAll<CardioSession>("cardio")).filter((c) => !c.hidden).sort((a, b) => b.start - a.start);
}

export async function listCheckIns(): Promise<CheckIn[]> {
  return (await getAll<CheckIn>("checkins")).sort((a, b) => (a.day < b.day ? -1 : 1));
}

export async function listCaffeine(sinceMs: number): Promise<CaffeineEntry[]> {
  return byIndex<CaffeineEntry>("caffeine", "t", IDBKeyRange.lowerBound(sinceMs));
}
