// Derived models shared by several screens: adaptive expenditure + targets, training load, HRV trend.
// Each loader reads the database and returns plain data; screens call them through useLive.

import { get, getAll, put } from "../db/db";
import { listGarminActivities, listGarminDays } from "../db/garmin";
import { entriesBetween, listCardio, listWeights, listWorkouts, today, TZ } from "../db/repo";
import type { DayStatus, EnergyCheckIn, GarminActivityRecord, GarminDay, Settings, StrengthSet } from "../db/types";
import { addDays, localTime, type ISODate } from "../engine/dates";
import {
  calorieTargets,
  expenditureSeries,
  last7Counts,
  priorTdee,
  trendSamplesByDay,
  weeklyCheckIn,
  type CalorieTargets,
  type CheckInState,
  type DayIntake,
  type ExpenditureDay,
} from "../engine/energy";
import { hrvStatus, type HrvStatus } from "../engine/hrv";
import {
  cardioLoadEstimate,
  dailyLoadTarget,
  estimatedMaxHR,
  intensityFocus,
  loadSeries,
  ratioBand,
  strengthSessionLoad,
  type IntensityFocus,
  type LoadDay,
  type LoadItem,
  type LoadTarget,
  type RatioBand,
  type Recovery as LoadRecovery,
} from "../engine/load";
import { median } from "../engine/stats";
import { weightTrend } from "../engine/weight";

const STRENGTH = /strength/i;

export const ageOf = (s: Settings) => new Date().getFullYear() - s.birthYear;

// ---- energy -------------------------------------------------------------------------------------

export interface ActiveTargets {
  kcal: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
  source: "AUTO" | "MANUAL" | "NONE";
}

export interface EnergyModel {
  day: ISODate;
  intake: DayIntake[];
  series: ExpenditureDay[];
  current: ExpenditureDay | null;
  prior: number;
  priorSource: "GARMIN" | "FORMULA";
  weightKg: number | null;
  checkIn: EnergyCheckIn | null;
  checkInState: CheckInState;
  counts: { completeDays: number; weighIns: number };
  proposal: CalorieTargets | null; // what a check-in today would set
  targets: ActiveTargets;
}

async function intakeDays(endDay: ISODate, days = 150): Promise<DayIntake[]> {
  const from = addDays(endDay, -days);
  const entries = await entriesBetween(from, endDay);
  const statuses = await getAll<DayStatus>("days");
  const kcal = new Map<ISODate, number>();
  for (const e of entries) kcal.set(e.day, (kcal.get(e.day) ?? 0) + e.kcal);
  const complete = new Map<ISODate, boolean>();
  for (const s of statuses) if (s.day >= from && s.day <= endDay) complete.set(s.day, s.complete === true);
  const all = new Set<ISODate>([...kcal.keys(), ...complete.keys()]);
  return [...all].sort().map((day) => ({ day, kcal: kcal.get(day) ?? 0, complete: complete.get(day) ?? false }));
}

function garminPrior(garmin: readonly GarminDay[], endLocal: ISODate): number | null {
  const vals = garmin
    .filter((g) => g.date < endLocal && g.date >= addDays(endLocal, -14) && g.totalKcal != null && g.totalKcal > 800)
    .map((g) => g.totalKcal as number);
  return vals.length >= 7 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length / 10) * 10 : null;
}

export async function loadEnergyModel(settings: Settings): Promise<EnergyModel> {
  const day = today(settings);
  const [intake, weights, garmin, checkIn] = await Promise.all([
    intakeDays(day),
    listWeights(),
    listGarminDays(),
    get<EnergyCheckIn>("meta", "energyCheckIn"),
  ]);
  const points = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const trend = trendSamplesByDay(points, TZ, settings.dayBoundaryHour);
  const weightKg = points.at(-1)?.trend ?? null;
  const gPrior = garminPrior(garmin, localTime(Date.now(), TZ).date);
  const prior = gPrior ?? priorTdee(weightKg ?? 80, settings.heightCm, ageOf(settings), settings.sex);
  const series = intake.length || trend.length ? expenditureSeries(intake, trend, day, { priorKcal: prior }) : [];
  const current = series.at(-1) ?? null;
  const weighInDays = weights.map((w) => localTime(w.t, TZ).date);
  const counts = last7Counts(intake, weighInDays, day);
  const checkInState = weeklyCheckIn(checkIn?.day ?? null, day, counts.completeDays, counts.weighIns);
  const tdee = current?.kcal ?? prior;
  const proposal =
    weightKg !== null
      ? calorieTargets(tdee, {
          phase: settings.phase,
          ratePctPerWeek: settings.goalRatePct ?? undefined,
          weightKg,
          sex: settings.sex,
          proteinG: settings.proteinTarget,
        })
      : null;
  let targets: ActiveTargets;
  if (settings.autoTargets && checkIn) {
    targets = { kcal: checkIn.kcal, proteinG: checkIn.proteinG, carbG: checkIn.carbG, fatG: checkIn.fatG, source: "AUTO" };
  } else if (settings.kcalTarget || settings.proteinTarget) {
    targets = { kcal: settings.kcalTarget, proteinG: settings.proteinTarget, carbG: settings.carbTarget, fatG: settings.fatTarget, source: "MANUAL" };
  } else targets = { kcal: null, proteinG: null, carbG: null, fatG: null, source: "NONE" };
  return {
    day,
    intake,
    series,
    current,
    prior,
    priorSource: gPrior !== null ? "GARMIN" : "FORMULA",
    weightKg,
    checkIn: checkIn ?? null,
    checkInState,
    counts,
    proposal,
    targets,
  };
}

/**
 * Weekly check-in (MacroFactor-style). Runs automatically: the first targets are set as soon as there is a
 * weigh-in, then updated once a week when the week has ≥ 4 complete food days and ≥ 1 weigh-in.
 * Returns the new check-in, or null when nothing changed.
 */
export async function runWeeklyCheckIn(settings: Settings, force = false): Promise<EnergyCheckIn | null> {
  if (!settings.autoTargets) return null;
  const m = await loadEnergyModel(settings);
  if (!m.proposal) return null;
  const goalSig = `${settings.phase}|${settings.goalRatePct}|${settings.proteinTarget}`;
  const first = !m.checkIn;
  const goalChanged = !!m.checkIn && m.checkIn.goalSig !== undefined && m.checkIn.goalSig !== goalSig;
  if (!force && !first && !goalChanged && !(m.checkInState.due && m.checkInState.ready)) return null;
  const tdee = Math.round(m.current?.kcal ?? m.prior);
  const rec: EnergyCheckIn = {
    key: "energyCheckIn",
    day: m.day,
    tdee,
    kcal: m.proposal.kcal,
    proteinG: m.proposal.proteinG,
    carbG: m.proposal.carbG,
    fatG: m.proposal.fatG,
    confidence: m.current?.confidence ?? "prior",
    goalSig,
    history: [...(m.checkIn?.history ?? []), { day: m.day, tdee, kcal: m.proposal.kcal }].slice(-52),
  };
  await put("meta", rec);
  return rec;
}

// ---- training load ------------------------------------------------------------------------------

export interface LoadModel {
  series: LoadDay[];
  today: LoadDay | null;
  items: LoadItem[];
  band: RatioBand;
  focus28: IntensityFocus;
  hasData: boolean;
  restHR: number | null;
  maxHR: number;
}

export function loadTargetFor(model: LoadModel, recovery: "Good" | "Normal" | "Reduced" | "Not enough data"): LoadTarget {
  const r: LoadRecovery = recovery === "Good" ? "good" : recovery === "Reduced" ? "reduced" : recovery === "Normal" ? "normal" : "unknown";
  return dailyLoadTarget(model.today?.ctl ?? 0, r);
}

const localDay = (ms: number) => localTime(ms, TZ).date;

export async function loadLoadModel(settings: Settings): Promise<LoadModel> {
  const [acts, garmin, workouts, sets, cardio] = await Promise.all([
    listGarminActivities(),
    listGarminDays(),
    listWorkouts(),
    getAll<StrengthSet>("sets"),
    listCardio(),
  ]);
  const endDay = localDay(Date.now());
  const rhrs = garmin.filter((g) => g.date >= addDays(endDay, -28) && g.restingHR != null).map((g) => g.restingHR as number);
  const restHR = rhrs.length >= 3 ? median(rhrs) : null;
  const maxHR = estimatedMaxHR(ageOf(settings));
  const items: LoadItem[] = [];

  for (const a of acts) {
    const load = a.trainingLoad ?? cardioLoadEstimate({ minutes: a.minutes, avgHR: a.avgHR, restHR, maxHR, sex: settings.sex });
    items.push({ day: localDay(a.start), load, estimated: a.trainingLoad == null });
  }
  const strengthActs = acts.filter((a: GarminActivityRecord) => STRENGTH.test(a.type ?? ""));
  const setsBy = new Map<string, StrengthSet[]>();
  for (const s of sets) setsBy.set(s.workoutId, [...(setsBy.get(s.workoutId) ?? []), s]);
  for (const w of workouts) {
    if (!w.end) continue;
    // A watch-recorded strength session already carries Garmin's own load.
    const covered = strengthActs.some((a) => a.start < w.end! + 30 * 60000 && a.start + a.minutes * 60000 > w.start - 30 * 60000);
    if (covered) continue;
    const ws = (setsBy.get(w.id) ?? []).filter((s) => s.kind === "working" && s.rir !== null);
    const avgRIR = ws.length ? ws.reduce((a, s) => a + (s.rir as number), 0) / ws.length : null;
    items.push({ day: localDay(w.start), load: strengthSessionLoad((w.end - w.start) / 60000, w.sessionRPE ?? null, avgRIR), estimated: true });
  }
  for (const c of cardio) {
    if (c.source === "garmin") continue;
    items.push({
      day: localDay(c.start),
      load: cardioLoadEstimate({ minutes: c.minutes, avgHR: c.avgHR, restHR, maxHR, sex: settings.sex, rpe: c.rpe }),
      estimated: true,
    });
  }
  const series = items.length ? loadSeries(items, endDay) : [];
  const todayRow = series.at(-1) ?? null;
  const from28 = Date.now() - 28 * 86400000;
  return {
    series,
    today: todayRow,
    items,
    band: ratioBand(todayRow?.ratio ?? null),
    focus28: intensityFocus(acts.filter((a) => a.start >= from28).map((a) => a.zonesSec)),
    hasData: items.length > 0,
    restHR,
    maxHR,
  };
}

// ---- HRV ----------------------------------------------------------------------------------------

export function hrvFromGarmin(garmin: readonly GarminDay[], endDay: ISODate): HrvStatus {
  return hrvStatus(
    garmin.filter((g) => g.hrv.lastNight != null).map((g) => ({ day: g.date, rmssd: g.hrv.lastNight as number })),
    endDay,
  );
}

// ---- formatting helpers -------------------------------------------------------------------------

export const pad = (n: number, w = 2) => String(Math.max(0, Math.round(n))).padStart(w, "0");
export const signed = (v: number, d = 0) => `${v > 0 ? "+" : v < 0 ? "-" : "±"}${Math.abs(v).toFixed(d)}`;
export const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
export const clockOf = (ms: number) => {
  const t = localTime(ms, TZ);
  return `${pad(t.hour)}:${pad(t.minute)}`;
};
export const hm = (hours: number) => {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
};
