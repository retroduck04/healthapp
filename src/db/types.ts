// Record types stored in IndexedDB. Units are SI (kg, km, minutes, kcal) unless a field says otherwise.

import type { ISODate } from "../engine/dates";

export type Source = "manual" | "barcode" | "openfoodfacts" | "custom" | "garmin-manual" | "import" | "computed";
export type Quality = "verified" | "manual" | "imported" | "estimated" | "partial" | "suspect";

export interface Settings {
  weightUnit: "lb" | "kg";
  distanceUnit: "km" | "mi";
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  kcalTarget: number | null;
  proteinTarget: number | null;
  carbTarget: number | null;
  fatTarget: number | null;
  sleepNeedHours: number;
  bedtime: string; // "23:00"
  restSeconds: number;
  caffeineHalfLifeHours: number;
  dayBoundaryHour: number;
  lastBackupAt: number | null;
  phase: "cut" | "maintain" | "bulk";
  /** calorie/macro targets follow the adaptive expenditure estimate, updated at a weekly check-in */
  autoTargets: boolean;
  /** goal rate in % of bodyweight per week; null = the phase default (cut −0.5, maintain 0, bulk +0.25) */
  goalRatePct: number | null;
  caffeinePresets: { label: string; mg: number }[];
}

export const defaultSettings: Settings = {
  weightUnit: "lb",
  distanceUnit: "km",
  sex: "male",
  birthYear: 2004,
  heightCm: 183,
  kcalTarget: null,
  proteinTarget: 150,
  carbTarget: null,
  fatTarget: null,
  sleepNeedHours: 8.25,
  bedtime: "23:00",
  restSeconds: 120,
  caffeineHalfLifeHours: 5,
  dayBoundaryHour: 4,
  lastBackupAt: null,
  phase: "maintain",
  autoTargets: true,
  goalRatePct: null,
  caffeinePresets: [
    { label: "Coffee", mg: 95 },
    { label: "Espresso", mg: 65 },
    { label: "Energy drink", mg: 160 },
    { label: "Pre-workout", mg: 200 },
  ],
};

export interface WeightEntry {
  id: string;
  t: number; // ms
  kg: number;
  source: Source;
  quality: Quality;
  note?: string;
}

export interface Nutrients {
  kcal: number;
  protein: number; // g
  carbs: number; // g
  fat: number; // g
  fiber?: number | null;
  sugar?: number | null;
  sodiumMg?: number | null;
}

export interface Serving {
  label: string; // "1 bar", "1 cup"
  grams: number;
}

export interface Food {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  source: "openfoodfacts" | "custom";
  per100g: Nutrients;
  servings: Serving[];
  attribution?: string;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

export type Meal = "breakfast" | "lunch" | "dinner" | "snacks";
export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snacks"];

export interface FoodEntry extends Nutrients {
  id: string;
  t: number;
  day: ISODate; // nutrition day
  meal: Meal;
  name: string;
  foodId?: string;
  grams?: number | null;
  amountLabel?: string; // "1.5 × 1 bar" or "150 g"
  method: "search" | "barcode" | "quick" | "saved" | "copy" | "custom";
}

export interface DayStatus {
  day: ISODate;
  complete: boolean | null; // null = not answered
}

export interface SavedMeal {
  id: string;
  name: string;
  items: (Nutrients & { name: string; foodId?: string; grams?: number | null; amountLabel?: string })[];
  createdAt: number;
}

export type Equipment = "machine" | "cable" | "dumbbell" | "barbell" | "smith" | "bodyweight" | "other";

export interface Exercise {
  id: string;
  name: string;
  equipment: Equipment;
  group: "push" | "pull" | "legs" | "core" | "arms" | "other";
  machineLabel?: string; // e.g. "Planet Fitness — Matrix — machine 2"
  loads: { min: number; max: number; step: number; extras?: number[] };
  repMin: number;
  repMax: number;
  targetRIR: number;
  setupNote?: string;
  archived?: boolean;
}

export interface Template {
  id: string;
  name: string;
  exerciseIds: string[];
  setsPerExercise: number;
}

export interface Workout {
  id: string;
  start: number;
  end: number | null;
  templateId?: string;
  name: string;
  exerciseIds: string[]; // in order
  sessionRPE?: number | null;
  notes?: string;
}

export interface StrengthSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  index: number; // set number within this exercise in this workout
  kind: "warmup" | "working";
  load: number; // display unit of the machine (lb by default)
  reps: number;
  rir: number | null;
  completedAt: number;
}

export type CardioModality =
  | "treadmill-run"
  | "outdoor-run"
  | "walk"
  | "incline-walk"
  | "hike"
  | "stationary-bike"
  | "outdoor-bike"
  | "elliptical"
  | "stair-climber"
  | "rower"
  | "other";

export type CardioType =
  | "recovery"
  | "easy"
  | "zone2"
  | "long"
  | "tempo"
  | "threshold"
  | "vo2"
  | "intervals"
  | "sprints"
  | "hills"
  | "mixed"
  | "test"
  | "recreational";

export interface CardioSession {
  id: string;
  start: number;
  minutes: number;
  modality: CardioModality;
  sessionType: CardioType;
  distanceKm?: number | null;
  avgHR?: number | null;
  maxHR?: number | null;
  rpe?: number | null; // 1-10
  machine?: string;
  notes?: string;
  source?: "manual" | "garmin";
  garminId?: string;
  garminName?: string;
  kcal?: number | null;
  aerobicTE?: number | null;
  zonesSec?: (number | null)[] | null;
  editedByUser?: boolean;
  hidden?: boolean; // Garmin sessions you deleted stay hidden instead of coming back on the next sync
}

export interface GarminDay {
  date: string;
  sleep: {
    start: number | null;
    end: number | null;
    totalSec: number | null;
    deepSec: number | null;
    lightSec: number | null;
    remSec: number | null;
    awakeSec: number | null;
    napSec: number | null;
    score: number | null;
    respiration: number | null;
  };
  hrv: { lastNight: number | null; weeklyAvg: number | null; status: string | null; baselineLow: number | null; baselineHigh: number | null };
  restingHR: number | null;
  steps: number | null;
  activeKcal: number | null;
  restingKcal: number | null;
  totalKcal: number | null;
  stressAvg: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  bodyBatteryWake: number | null;
  moderateMin: number | null;
  vigorousMin: number | null;
  floors: number | null;
  vo2max: number | null;
  readiness: number | null;
}

export interface CheckIn {
  day: ISODate; // wake date
  sleepHours?: number | null;
  bedtime?: string | null; // "23:40"
  wakeTime?: string | null; // "07:10"
  napMinutes?: number | null;
  energy?: number | null; // 1-5
  soreness?: number | null;
  stress?: number | null;
  ill?: boolean;
  hrv?: number | null; // Garmin overnight HRV (RMSSD, ms)
  restingHR?: number | null;
  bodyBattery?: number | null;
  sleepScore?: number | null;
  updatedAt: number;
}

export interface CaffeineEntry {
  id: string;
  t: number;
  mg: number;
  label: string;
}

export interface EventTag {
  id: string;
  tag: string;
  start: ISODate;
  end?: ISODate | null;
  note?: string;
}

/** One Garmin activity of any type (strength included), kept for training-load tracking. */
export interface GarminActivityRecord {
  id: string; // Garmin activity id
  start: number; // ms
  minutes: number;
  type: string | null;
  name: string | null;
  trainingLoad: number | null; // Garmin's EPOC-based load
  avgHR: number | null;
  maxHR: number | null;
  kcal: number | null;
  aerobicTE: number | null;
  anaerobicTE: number | null;
  zonesSec: (number | null)[] | null;
}

/** Weekly check-in result: the targets the app is currently using (MacroFactor-style). */
export interface EnergyCheckIn {
  key: "energyCheckIn";
  day: string; // ISO date of the check-in
  tdee: number;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  confidence: string;
  goalSig?: string; // phase|rate|protein when set; a change forces a new check-in
  history: { day: string; tdee: number; kcal: number }[];
}
