import { test } from "node:test";
import assert from "node:assert/strict";
import { lbToKg, kgToLb, mphToKmh, paceSecondsPerKm, formatHoursMinutes, formatMinSec, fmt } from "../src/engine/units";
import { dayNumber, fromDayNumber, addDays, isoWeekday, nutritionDay, sleepDate, localTime } from "../src/engine/dates";
import { median, quantile, gapSummary, lowestRollingMean } from "../src/engine/stats";
import { e1RM, predictedReps, adviseProgression, loadsFromSpec, type SetResult } from "../src/engine/strength";
import { weightTrend, checkWeightEntry, type WeightObservation } from "../src/engine/weight";
import { sleepDebt, defaultSleepDebtParams, caffeineRemaining, mifflinStJeor, type SleepNight } from "../src/engine/sleep";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);
const TZ = "America/Toronto";
const at = (iso: string) => Date.parse(iso);

test("units", () => {
  close(lbToKg(185), 83.91458845, 1e-8);
  close(kgToLb(lbToKg(185)), 185);
  close(mphToKmh(3.5), 5.632704, 1e-6);
  close(paceSecondsPerKm(10)!, 360);
  assert.equal(paceSecondsPerKm(0), null);
  assert.equal(formatMinSec(385), "6:25");
  assert.equal(formatHoursMinutes(7 * 3600 + 5 * 60), "7 h 05 min");
  assert.equal(formatHoursMinutes(45 * 60), "45 min");
  assert.equal(formatHoursMinutes(-(5 * 3600 + 18 * 60)), "-5 h 18 min");
  assert.equal(fmt(182.5), "182.5");
  assert.equal(fmt(180), "180");
  assert.equal(fmt(84.2549, 2), "84.25");
});

test("day numbers", () => {
  assert.equal(dayNumber("1970-01-01"), 0);
  assert.equal(dayNumber("2000-02-29"), 11016);
  assert.equal(dayNumber("2026-09-26"), 20722);
  assert.equal(dayNumber("1969-12-31"), -1);
  assert.equal(fromDayNumber(20722), "2026-09-26");
  for (let n = -40000; n <= 60000; n += 97) assert.equal(dayNumber(fromDayNumber(n)), n);
  assert.equal(isoWeekday("1970-01-01"), 4);
  assert.equal(isoWeekday("2026-09-26"), 6);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("day attribution across Toronto DST changes", () => {
  assert.equal(nutritionDay(at("2026-03-08T06:30:00Z"), TZ), "2026-03-07"); // 01:30 EST
  assert.equal(nutritionDay(at("2026-03-08T07:30:00Z"), TZ), "2026-03-07"); // 03:30 EDT
  assert.equal(nutritionDay(at("2026-03-08T08:30:00Z"), TZ), "2026-03-08"); // 04:30 EDT
  assert.equal(nutritionDay(at("2026-11-01T05:30:00Z"), TZ), "2026-10-31"); // 01:30 EDT
  assert.equal(nutritionDay(at("2026-11-01T06:30:00Z"), TZ), "2026-10-31"); // 01:30 EST
  assert.equal(nutritionDay(at("2026-11-01T09:00:00Z"), TZ), "2026-11-01"); // 04:00 EST
  // 23:00 EDT Oct 31 -> 07:00 EST Nov 1 is 9 real hours; spring-forward night is 7.
  close((at("2026-11-01T12:00:00Z") - at("2026-11-01T03:00:00Z")) / 3600000, 9);
  close((at("2026-03-08T11:00:00Z") - at("2026-03-08T04:00:00Z")) / 3600000, 7);
  assert.equal(sleepDate(at("2026-11-01T12:00:00Z"), TZ), "2026-11-01");
  const lt = localTime(at("2026-06-15T16:00:00Z"), TZ);
  assert.equal(lt.date, "2026-06-15");
  assert.equal(lt.hour, 12);
});

test("stats", () => {
  assert.equal(median([]), null);
  close(median([3, 1, 2])!, 2);
  close(median([1, 2, 3, 4])!, 2.5);
  close(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)!, 9.1, 1e-12);
  const g = gapSummary([0, 60, 180, 300, 420].map((s) => s * 1000).reverse());
  assert.equal(g.sampleCount, 5);
  close(g.medianSeconds!, 120);
  close(g.maxSeconds!, 120);
  const hr = [60, 58, 52, 51, 53, 57, 61].map((bpm, i) => ({ t: i * 120000, bpm }));
  close(lowestRollingMean(hr)!, 52);
  assert.equal(lowestRollingMean([]), null);
});

test("e1RM and predicted reps", () => {
  close(e1RM(180, 10, 1), 246);
  close(predictedReps(246, 180, 1), 10);
  close(predictedReps(246, 180, 1, 3, 1), 8);
  assert.deepEqual(loadsFromSpec({ min: 10, max: 50, step: 10, extras: [15] }), [10, 15, 20, 30, 40, 50]);
});

test("double progression", () => {
  const stack = loadsFromSpec({ min: 10, max: 300, step: 10 });
  const s = (load: number, reps: number, rir: number | null = null): SetResult => ({ load, reps, rir });
  const up = adviseProgression([[s(180, 10, 1)], [s(180, 11, 1)], [s(180, 12, 1), s(180, 12, 1)]], stack);
  assert.deepEqual(up.advice, { kind: "increaseLoad", load: 190, repMin: 8, repMax: 10 });
  const inside = adviseProgression([[s(180, 10, 1), s(180, 9, 1), s(170, 11, 1)]], stack);
  assert.deepEqual(inside.advice, { kind: "addReps", load: 180, targetReps: 10 });
  const bigJump = adviseProgression([[s(40, 12, 2), s(40, 12, 1)]], [30, 40, 50]);
  assert.deepEqual(bigJump.advice, { kind: "addReps", load: 40, targetReps: 14 });
  assert.deepEqual(adviseProgression([[s(100, 9)], [s(100, 7)]], stack).advice, { kind: "repeatLoad", load: 100 });
  assert.deepEqual(adviseProgression([[s(100, 6)], [s(100, 7)]], stack).advice, { kind: "reduceLoad", load: 90 });
  assert.deepEqual(adviseProgression([], stack).advice, { kind: "insufficientData" });
});

test("weight trend filter", () => {
  const day = 86400000;
  const t0 = 1780000000000;
  const days = (v: [number, number][]): WeightObservation[] => v.map(([d, kg]) => ({ t: t0 + d * day, kg }));
  const linear = weightTrend(days(Array.from({ length: 61 }, (_, d) => [d, 90 - 0.06 * d] as [number, number])));
  close(linear.at(-1)!.trend, 86.4, 0.05);
  close(linear.at(-1)!.slopePerDay, -0.06, 0.002);
  const withOutlier: [number, number][] = [
    ...Array.from({ length: 30 }, (_, d) => [d, 85] as [number, number]),
    [30, 90],
    ...Array.from({ length: 4 }, (_, i) => [31 + i, 85] as [number, number]),
  ];
  const o = weightTrend(days(withOutlier));
  assert.equal(o[30].suspect, true);
  close(o[30].trend, 85, 0.3);
  close(o.at(-1)!.trend, 85, 0.3);
  const stable = weightTrend(days(Array.from({ length: 30 }, (_, d) => [d, 85] as [number, number]))).at(-1)!;
  close(stable.trend, 85, 0.01);
  close(stable.slopePerDay, 0, 0.001);
  assert.equal(stable.suspect, false);
});

test("weigh-in checks", () => {
  assert.deepEqual(checkWeightEntry(186.2, 185, true), { ok: true });
  const slip = checkWeightEntry(1850, 185, true);
  assert.ok(!slip.ok && slip.suggestion === 185);
  const kg = checkWeightEntry(84, 185, true);
  assert.ok(!kg.ok && kg.suggestion === 185.2);
  const far = checkWeightEntry(195, 185, true);
  assert.ok(!far.ok && far.suggestion === null);
  assert.deepEqual(checkWeightEntry(185, null, true), { ok: true });
});

test("sleep debt", () => {
  const p = defaultSleepDebtParams(8);
  const n = (h: number | null, nap = 0): SleepNight => ({ mainSleepHours: h, napHours: nap });
  close(sleepDebt(Array.from({ length: 14 }, () => n(7)), p).debtHours!, 9.45);
  close(sleepDebt(Array.from({ length: 14 }, () => n(8)), p).debtHours!, 0);
  close(sleepDebt([...Array.from({ length: 13 }, () => n(7)), n(12)], p).debtHours!, 6.45);
  close(sleepDebt([...Array.from({ length: 13 }, () => n(7)), n(7, 1)], p).debtHours!, 8.65);
  const nights = Array.from({ length: 14 }, () => n(7));
  for (const i of [2, 5, 9]) nights[i] = n(null);
  const three = sleepDebt(nights, p);
  close(three.debtHours!, 9.45);
  assert.equal(three.estimatedNights, 3);
  nights[11] = n(null);
  assert.equal(sleepDebt(nights, p).debtHours, null);
  assert.equal(sleepDebt(Array.from({ length: 5 }, () => n(7)), p).debtHours, null);
});

test("caffeine and resting energy", () => {
  const h = 3600000;
  close(caffeineRemaining([{ mg: 200, t: 0 }], 6 * h), 87.0550563, 1e-6);
  close(caffeineRemaining([{ mg: 200, t: 0 }, { mg: 100, t: 3 * h }], 6 * h), 153.0304519, 1e-6);
  close(caffeineRemaining([{ mg: 200, t: 0 }], -60000), 0);
  close(mifflinStJeor(83.91, 183, 22, "male"), 1877.85, 0.01);
});
