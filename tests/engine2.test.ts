import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, localTime } from "../src/engine/dates";
import { sampleSD, sampleVariance, tQuantile975 } from "../src/engine/stats";
import { weightTrend } from "../src/engine/weight";
import {
  expenditureSeries,
  calorieTargets,
  weeklyCheckIn,
  priorTdee,
  trendSamplesByDay,
  last7Counts,
  type DayIntake,
  type TrendSample,
} from "../src/engine/energy";
import {
  loadSeries,
  ratioBand,
  strengthSessionLoad,
  cardioLoadEstimate,
  estimatedMaxHR,
  dailyLoadTarget,
  intensityFocus,
  type LoadItem,
} from "../src/engine/load";
import {
  sleepRegularityIndex,
  timingSpread,
  bedtimePlan,
  caffeineCutoff,
  caffeineCurve,
  sleepNeedBaseline,
  tzOffsetMs,
  type SleepInterval,
} from "../src/engine/sleepplan";
import { detectRecords, bestRecords, sessionRecords, type SetLite } from "../src/engine/records";
import { musclesFor, weeklySetsPerMuscle, MUSCLES, MUSCLE_LABEL, type Muscle } from "../src/engine/volume";
import { hrvStatus, type HrvNight } from "../src/engine/hrv";
import { autoTags, tagImpact, rankTagImpacts, type TagObservation } from "../src/engine/insights";
import { seedExercises } from "../src/db/seed";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);
const TZ = "America/Toronto";
const at = (iso: string) => Date.parse(iso);
const H = 3600000;
const DAY = 86400000;

// ---------- stats helpers ----------

test("stats: sample SD and Student t quantile", () => {
  close(sampleSD([2, 4, 4, 4, 5, 5, 7, 9])!, Math.sqrt(32 / 7));
  assert.equal(sampleSD([1]), null);
  assert.equal(sampleVariance([]), null);
  const scipy: [number, number][] = [
    [1, 12.7062], [1.4, 6.657], [2, 4.30265], [2.5, 3.57465], [5.5, 2.50186], [10, 2.22814], [17.3, 2.10703],
    [33, 2.03452], [45, 2.0141], [70, 1.99444], [150, 1.97591], [500, 1.96472],
  ];
  for (const [df, t] of scipy) assert.ok(Math.abs(tQuantile975(df) / t - 1) < 0.002, `df ${df}: ${tQuantile975(df)} vs ${t}`);
  close(tQuantile975(0.3), 12.7062);
  close(tQuantile975(Infinity), 1.959963984540054);
  // Monotone decreasing in df.
  let prev = Infinity;
  for (let df = 1; df < 400; df += 0.37) {
    const t = tQuantile975(df);
    assert.ok(t <= prev + 1e-12);
    prev = t;
  }
});

// ---------- energy ----------

const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

test("expenditure: recovers a true TDEE of 2700 from 28 days at 2200 kcal and a linear loss", () => {
  const start = "2026-01-05";
  const intake: DayIntake[] = days(start, 28).map((day) => ({ day, kcal: 2200, complete: true }));
  const trend: TrendSample[] = days(start, 28).map((day, i) => ({ day, kg: 85 - (500 / 7700) * i, sd: 0.15 }));
  const s = expenditureSeries(intake, trend, addDays(start, 27), { priorKcal: 2400 });
  assert.equal(s.length, 28);
  assert.equal(s[0].day, start);
  // Before 7 complete days: the prior, untouched.
  for (const d of s.slice(0, 6)) {
    assert.equal(d.confidence, "prior");
    assert.equal(d.raw, null);
    close(d.kcal, 2400);
    close(d.high - d.kcal, 1.2816 * 0.15 * 2400, 1e-6);
  }
  // Day 8 is the first with a ≥ 7-day weight gap; its raw value is exact for linear data.
  close(s[7].raw!, 2700, 1e-6);
  const last = s.at(-1)!;
  close(last.kcal, 2700, 120);
  assert.equal(last.completeDays, 21);
  assert.equal(last.confidence, "high");
  assert.equal(last.paused, false);
  assert.ok(last.low < last.kcal && last.kcal < last.high);
  assert.ok(last.high - last.low < 2 * 1.2816 * 250);
  // Monotone approach from the prior towards the truth.
  for (let i = 1; i < s.length; i++) assert.ok(s[i].kcal >= s[i - 1].kcal - 1e-9);
});

test("expenditure: surplus, pause/hold, gaps and noisy weigh-ins through weightTrend", () => {
  const start = "2026-02-02";
  // Surplus: 3000 kcal with a gain of 300 kcal/day → TDEE 2700.
  const gain = expenditureSeries(
    days(start, 35).map((day) => ({ day, kcal: 3000, complete: true })),
    days(start, 35).map((day, i) => ({ day, kg: 70 + (300 / 7700) * i, sd: 0.1 })),
    addDays(start, 34),
    { priorKcal: 2500 },
  );
  close(gain.at(-1)!.kcal, 2700, 60);

  // 28 logged days, then 7 unlogged days: paused from the 4th missing day and the estimate is held.
  const intake: DayIntake[] = days(start, 28).map((day) => ({ day, kcal: 2200, complete: true }));
  const trend: TrendSample[] = days(start, 35).map((day, i) => ({ day, kg: 85 - (500 / 7700) * i, sd: 0.15 }));
  const s = expenditureSeries(intake, trend, addDays(start, 34), { priorKcal: 2400 });
  assert.equal(s.length, 35);
  assert.equal(s[30].paused, false);
  assert.equal(s[31].paused, true);
  assert.equal(s[34].paused, true);
  close(s[34].kcal, s[30].kcal);
  close(s[34].high, s[30].high);
  // An incomplete day does not count.
  const withIncomplete = intake.map((d, i) => (i === 27 ? { ...d, complete: false } : d));
  assert.equal(expenditureSeries(withIncomplete, trend, addDays(start, 27), { priorKcal: 2400 }).at(-1)!.completeDays, 20);

  // 10 complete days but weigh-ins only 3 days apart: no raw value, the prior holds.
  const sparse = expenditureSeries(
    days(start, 10).map((day) => ({ day, kcal: 2200, complete: true })),
    [{ day: start, kg: 85, sd: 0.3 }, { day: addDays(start, 3), kg: 84.8, sd: 0.3 }],
    addDays(start, 9),
    { priorKcal: 2400 },
  );
  assert.ok(sparse.every((d) => d.raw === null && d.kcal === 2400 && d.confidence === "prior"));

  assert.deepEqual(expenditureSeries([], [], "2026-01-01", { priorKcal: 2400 }), []);

  // Noisy daily weigh-ins (±0.4 kg), trend from the Kalman filter, 49 days → within ±200 kcal.
  const t0 = at("2026-03-02T12:00:00Z"); // 07:00 local
  const obs = Array.from({ length: 49 }, (_, i) => ({ t: t0 + i * DAY, kg: 88 - (500 / 7700) * i + 0.4 * Math.sin(i * 2.3) }));
  const tr = trendSamplesByDay(weightTrend(obs), TZ);
  assert.equal(tr.length, 49);
  const noisy = expenditureSeries(
    tr.map((x) => ({ day: x.day, kcal: 2200 + 150 * Math.cos(dayIndex(x.day)), complete: true })),
    tr,
    tr.at(-1)!.day,
    { priorKcal: 2500 },
  );
  close(noisy.at(-1)!.kcal, 2700, 200);
});

const dayIndex = (d: string) => Number(d.slice(8, 10));

test("energy: calorie targets, check-in rule and helpers", () => {
  const cut = calorieTargets(2700, { phase: "cut", weightKg: 80, sex: "male" });
  close(cut.dailyDeltaKcal, -440, 1e-9);
  close(cut.weeklyChangeKg, -0.4, 1e-12);
  assert.equal(cut.kcal, 2260);
  assert.equal(cut.proteinG, 144);
  assert.equal(cut.fatG, 63); // 25 % of 2260 kcal beats 0.7 g/kg
  assert.equal(cut.carbG, 279);
  assert.equal(cut.floored, false);

  const bulk = calorieTargets(2700, { phase: "bulk", weightKg: 80, sex: "male", proteinG: 160 });
  close(bulk.dailyDeltaKcal, 220, 1e-9);
  assert.equal(bulk.kcal, 2920);
  assert.equal(bulk.proteinG, 160);
  const maintain = calorieTargets(2703, { phase: "maintain", weightKg: 80, sex: "female" });
  assert.equal(maintain.kcal, 2700);
  assert.equal(maintain.dailyDeltaKcal, 0);
  const lowFat = calorieTargets(1500, { phase: "maintain", weightKg: 100, sex: "male" });
  assert.equal(lowFat.fatG, 70); // 0.7 g/kg beats 25 % of 1500 kcal

  const floored = calorieTargets(1600, { phase: "cut", ratePctPerWeek: -1, weightKg: 80, sex: "male" });
  assert.equal(floored.kcal, 1500);
  assert.equal(floored.floored, true);
  close(floored.dailyDeltaKcal, -100);
  assert.equal(calorieTargets(1300, { phase: "cut", weightKg: 60, sex: "female" }).kcal, 1200);
  assert.ok(calorieTargets(1200, { phase: "cut", weightKg: 60, sex: "male", proteinG: 400 }).carbG === 0);

  assert.deepEqual(weeklyCheckIn(null, "2026-09-28", 5, 2), { due: true, ready: true, missing: null });
  assert.equal(weeklyCheckIn("2026-09-22", "2026-09-28", 5, 2).due, false);
  assert.equal(weeklyCheckIn("2026-09-21", "2026-09-28", 5, 2).due, true);
  assert.deepEqual(weeklyCheckIn("2026-09-21", "2026-09-28", 2, 1), { due: true, ready: false, missing: "2/4 LOGGED DAYS" });
  assert.equal(weeklyCheckIn(null, "2026-09-28", 4, 0).missing, "NO WEIGH-IN");
  assert.equal(weeklyCheckIn(null, "2026-09-28", 0, 0).missing, "0/4 LOGGED DAYS · NO WEIGH-IN");

  assert.equal(priorTdee(83.91, 183, 22, "male"), 2630);
  const counts = last7Counts(
    [
      { day: "2026-09-21", kcal: 1, complete: true }, // 8 days ago
      { day: "2026-09-22", kcal: 1, complete: true },
      { day: "2026-09-25", kcal: 1, complete: false },
      { day: "2026-09-28", kcal: 1, complete: true },
    ],
    ["2026-09-20", "2026-09-27", "2026-09-27"],
    "2026-09-28",
  );
  assert.deepEqual(counts, { completeDays: 2, weighIns: 1 });

  // End-of-day trend; a 02:00 weigh-in belongs to the previous nutrition day.
  const pts = [
    { t: at("2026-06-10T11:00:00Z"), trend: 80, trendSD: 0.5 }, // 07:00
    { t: at("2026-06-10T20:00:00Z"), trend: 80.4, trendSD: 0.4 }, // 16:00
    { t: at("2026-06-12T06:00:00Z"), trend: 79.9, trendSD: 0.3 }, // 02:00 on the 12th → 11th
  ];
  assert.deepEqual(trendSamplesByDay(pts, TZ), [
    { day: "2026-06-10", kg: 80.4, sd: 0.4 },
    { day: "2026-06-11", kg: 79.9, sd: 0.3 },
  ]);
});

// ---------- load ----------

test("load: CTL/ATL/TSB and the acute:chronic ratio", () => {
  const start = "2026-01-01";
  const constant: LoadItem[] = days(start, 60).map((day) => ({ day, load: 50 }));
  const s = loadSeries(constant, addDays(start, 59));
  assert.equal(s.length, 60);
  assert.equal(s[0].tsb, 0);
  close(s[0].ctl, 50 / 42);
  close(s[0].atl, 50 / 7);
  close(s[1].tsb, 50 / 42 - 50 / 7);
  for (const d of s.slice(0, 13)) assert.equal(d.ratio, null);
  assert.equal(s[13].historyDays, 14);
  close(s[13].ratio!, 1, 1e-9);
  close(s.at(-1)!.ratio!, 1, 1e-9);
  assert.equal(ratioBand(s.at(-1)!.ratio), "optimal");
  close(s.at(-1)!.ctl, 50 * (1 - (41 / 42) ** 60), 1e-9);
  assert.ok(s.at(-1)!.tsb < 0);

  // Three 100-unit sessions a week: the ratio swings with the week (≈ 0.7 after the weekend, ≈ 1.25 on
  // Friday, as Garmin's acute load does) but averages 1 over whole weeks.
  const weekly: LoadItem[] = days(start, 70).flatMap((day, i) => (i % 7 === 0 || i % 7 === 2 || i % 7 === 4 ? [{ day, load: 100 }] : []));
  const w = loadSeries(weekly, addDays(start, 69));
  assert.equal(w.length, 70);
  const steady = w.slice(28);
  for (const d of steady) assert.ok(d.ratio! > 0.6 && d.ratio! < 1.4, `ratio ${d.ratio}`);
  close(steady.reduce((a, d) => a + d.ratio!, 0) / steady.length, 1, 0.05);

  // A spike week after six steady weeks.
  const spike: LoadItem[] = [
    ...days(start, 42).map((day) => ({ day, load: 40 })),
    ...days(addDays(start, 42), 7).map((day) => ({ day, load: 160, estimated: true })),
  ];
  const sp = loadSeries(spike, addDays(start, 48));
  const top = sp.at(-1)!;
  assert.ok(top.ratio! > 1.5, `ratio ${top.ratio}`);
  assert.ok(["high", "very-high"].includes(ratioBand(top.ratio)));
  assert.ok(top.tsb < 0);
  assert.equal(top.estimated, true);
  assert.equal(sp[0].estimated, false);

  // Same-day items add up; rest days are zero; startDay before the first item pads with zeros.
  const padded = loadSeries([{ day: "2026-01-05", load: 30 }, { day: "2026-01-05", load: 20 }], "2026-01-07", "2026-01-03");
  assert.deepEqual(padded.map((d) => d.load), [0, 0, 50, 0, 0]);
  assert.equal(padded[0].historyDays, 1);
  // startDay after the first item: EWMAs warm up on the earlier days, output starts at startDay.
  const later = loadSeries(constant, addDays(start, 59), addDays(start, 30));
  assert.equal(later.length, 30);
  assert.equal(later[0].historyDays, 31);
  close(later.at(-1)!.ctl, s.at(-1)!.ctl);
  assert.deepEqual(loadSeries([], "2026-01-01"), []);
  assert.deepEqual(loadSeries([{ day: "2026-02-01", load: 10 }], "2026-01-01"), []);
});

test("load: bands, session estimates, targets and intensity focus", () => {
  assert.equal(ratioBand(null), "none");
  assert.equal(ratioBand(0.79), "low");
  assert.equal(ratioBand(0.8), "optimal");
  assert.equal(ratioBand(1.49), "optimal");
  assert.equal(ratioBand(1.5), "high");
  assert.equal(ratioBand(1.99), "high");
  assert.equal(ratioBand(2), "very-high");

  close(strengthSessionLoad(60, 7, null), 100.8);
  close(strengthSessionLoad(60, null, 2), 115.2);
  close(strengthSessionLoad(60, null, null), 86.4);
  close(strengthSessionLoad(60, null, 12), 14.4); // RPE clamped to 1

  const hrr = 90 / 130;
  close(cardioLoadEstimate({ minutes: 60, avgHR: 150, restHR: 60, maxHR: 190, sex: "male" }), 60 * hrr * 0.64 * Math.exp(1.92 * hrr));
  assert.ok(cardioLoadEstimate({ minutes: 60, avgHR: 150, restHR: 60, maxHR: 190, sex: "female" }) < 100.5);
  close(cardioLoadEstimate({ minutes: 60, avgHR: 150, restHR: 60, maxHR: 190, sex: "male" }), 100.44, 0.05);
  close(cardioLoadEstimate({ minutes: 60, avgHR: 50, restHR: 60, maxHR: 190, sex: "male" }), 0); // HRr clamped to 0
  close(cardioLoadEstimate({ minutes: 60, avgHR: 150, restHR: null, maxHR: 190, sex: "male" }), 72);
  close(cardioLoadEstimate({ minutes: 30, sex: "male", rpe: 8 }), 57.6);
  assert.equal(estimatedMaxHR(22), 193);

  assert.deepEqual(dailyLoadTarget(10, "good"), { low: 20, high: 60, label: "BUILD" });
  assert.deepEqual(dailyLoadTarget(60, "reduced"), { low: 45, high: 54, label: "EASY" });
  assert.deepEqual(dailyLoadTarget(60, "normal"), { low: 60, high: 75, label: "MODERATE" });
  assert.deepEqual(dailyLoadTarget(60, "unknown"), { low: 60, high: 75, label: "MODERATE" });
  assert.deepEqual(dailyLoadTarget(61, "good"), { low: 92, high: 122, label: "HARD" });

  const f = intensityFocus([[600, 1200, 300, 300, 60], null, [60, null, 0, 0, 120]]);
  close(f.lowMin, 31);
  close(f.highMin, 10);
  close(f.anaerobicMin, 3);
  assert.deepEqual(intensityFocus([[10, 5, 3, 2, 1]], "min"), { lowMin: 15, highMin: 5, anaerobicMin: 1 });
  assert.deepEqual(intensityFocus([]), { lowMin: 0, highMin: 0, anaerobicMin: 0 });
});

// ---------- sleep plan ----------

/** Toronto wall clock → ms, for dates in 2026 (EST before 2026-03-08 02:00 and from 2026-11-01 02:00, else EDT). */
function toronto(date: string, hh: number, mm = 0): number {
  const edt = (date > "2026-03-08" || (date === "2026-03-08" && hh >= 2)) && (date < "2026-11-01" || (date === "2026-11-01" && hh < 1));
  return at(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${edt ? "-04:00" : "-05:00"}`);
}

const nightsFrom = (firstBedDate: string, n: number, bed: [number, number], wake: [number, number]): SleepInterval[] =>
  days(firstBedDate, n).map((d) => ({
    start: bed[0] >= 12 ? toronto(d, bed[0], bed[1]) : toronto(addDays(d, 1), bed[0], bed[1]),
    end: toronto(addDays(d, 1), wake[0], wake[1]),
  }));

test("sleep regularity index", () => {
  const end = toronto("2026-06-15", 12);
  const same = nightsFrom("2026-06-01", 14, [23, 0], [7, 0]);
  assert.deepEqual(sleepRegularityIndex(same, end), { sri: 100, nights: 14 });
  assert.deepEqual(sleepRegularityIndex(same, end, 14, TZ), { sri: 100, nights: 14 });

  // Alternating 23–07 and 03–11: a third of each day pair disagrees → SRI 33.3.
  const alt = days("2026-06-01", 14).map((d, i) =>
    i % 2 === 0 ? { start: toronto(d, 23), end: toronto(addDays(d, 1), 7) } : { start: toronto(addDays(d, 1), 3), end: toronto(addDays(d, 1), 11) },
  );
  close(sleepRegularityIndex(alt, end).sri!, 100 / 3, 1e-9);

  // Missing nights: only pairs of recorded days count, so the rest still agree perfectly.
  const gappy = same.filter((_, i) => i % 3 !== 1);
  const g = sleepRegularityIndex(gappy, end);
  assert.equal(g.nights, 9);
  assert.equal(g.sri, 100);
  assert.deepEqual(sleepRegularityIndex(same.slice(0, 4), toronto("2026-06-05", 12)), { sri: null, nights: 4 });

  // DST spring-forward: a clock-regular sleeper stays at 100 with the time zone, and loses a little without it.
  const dst = nightsFrom("2026-03-01", 14, [23, 0], [7, 0]);
  const dEnd = toronto("2026-03-15", 12);
  close(dst[6].end - dst[6].start, 7 * H); // the short night
  assert.equal(sleepRegularityIndex(dst, dEnd, 14, TZ).sri, 100);
  const raw = sleepRegularityIndex(dst, dEnd).sri!;
  assert.ok(raw > 97 && raw < 100, `raw ${raw}`);
  close(tzOffsetMs(toronto("2026-03-07", 12), TZ), -5 * H);
  close(tzOffsetMs(toronto("2026-03-09", 12), TZ), -4 * H);
});

test("timing spread, bedtime plan and sleep baseline", () => {
  const two: SleepInterval[] = [
    { start: toronto("2026-06-01", 23, 50), end: toronto("2026-06-02", 7) },
    { start: toronto("2026-06-03", 0, 20), end: toronto("2026-06-03", 7, 30) },
  ];
  const t = timingSpread(two, TZ);
  assert.equal(t.n, 2);
  assert.equal(t.bedtimeMedianMin, 5);
  close(t.bedtimeSdMin!, Math.SQRT2 * 15);
  assert.equal(t.wakeMedianMin, 435);
  close(t.wakeSdMin!, Math.SQRT2 * 15);
  assert.equal(t.midpointMin, 220); // 03:25 and 03:55
  assert.deepEqual(timingSpread([], TZ), { n: 0, bedtimeMedianMin: null, wakeMedianMin: null, bedtimeSdMin: null, wakeSdMin: null, midpointMin: null });

  // Across the fall-back change, clock-regular nights show zero spread even though one night is 9 h long.
  const fall = nightsFrom("2026-10-28", 7, [23, 0], [7, 0]);
  close(fall[3].end - fall[3].start, 9 * H);
  const f = timingSpread(fall, TZ);
  assert.equal(f.bedtimeMedianMin, 1380);
  assert.equal(f.wakeMedianMin, 420);
  close(f.bedtimeSdMin!, 0);
  close(f.wakeSdMin!, 0);
  assert.equal(f.midpointMin, 180);

  assert.deepEqual(bedtimePlan({ wakeTargetMin: 420, needHours: 8, debtHours: 3.5 }), { bedtimeMin: 1335, sleepOpportunityH: 8.75, paybackH: 0.5 });
  assert.deepEqual(bedtimePlan({ wakeTargetMin: 420, needHours: 8, debtHours: 0 }), { bedtimeMin: 1365, sleepOpportunityH: 8.25, paybackH: 0 });
  assert.equal(bedtimePlan({ wakeTargetMin: 420, needHours: 8, debtHours: 20 }).paybackH, 1);
  assert.equal(bedtimePlan({ wakeTargetMin: 600, needHours: 8, debtHours: null, latencyMin: 0 }).bedtimeMin, 120);

  assert.deepEqual(sleepNeedBaseline(Array(13).fill(8)), { medianH: null, n: 13 });
  const hours = [3, 12, ...Array.from({ length: 20 }, (_, i) => 6.5 + i * 0.1)];
  const b = sleepNeedBaseline(hours);
  assert.equal(b.n, 20);
  close(b.medianH!, 7.45, 1e-9);
});

test("caffeine cutoff and curve", () => {
  const bed = toronto("2026-06-10", 23);
  const open = caffeineCutoff({ doses: [], bedtimeMs: bed, halfLifeH: 5, nowMs: toronto("2026-06-10", 10) });
  assert.equal(open.status, "OPEN");
  assert.equal(open.residualAtBedMg, 0);
  const lt = localTime(open.cutoffMs!, TZ);
  assert.deepEqual([lt.hour, lt.minute], [13, 22]);
  close((bed - open.cutoffMs!) / H, 5 * Math.log2(95 / 25), 1e-9);
  assert.equal(caffeineCutoff({ doses: [], bedtimeMs: bed, halfLifeH: 5, nowMs: toronto("2026-06-10", 15) }).status, "PAST");

  const closed = caffeineCutoff({ doses: [{ t: toronto("2026-06-10", 8), mg: 200 }], bedtimeMs: bed, halfLifeH: 5, nowMs: bed - 12 * H });
  close(closed.residualAtBedMg, 25, 1e-9);
  assert.deepEqual([closed.status, closed.cutoffMs], ["CLOSED", null]);

  const partial = caffeineCutoff({ doses: [{ t: toronto("2026-06-10", 8), mg: 100 }], bedtimeMs: bed, halfLifeH: 5, nowMs: toronto("2026-06-10", 10) });
  close(partial.residualAtBedMg, 12.5, 1e-9);
  close((bed - partial.cutoffMs!) / H, 5 * Math.log2(95 / 12.5), 1e-9);
  assert.equal(partial.status, "PAST");
  // A dose after bedtime does not count toward the bedtime residual; a tiny next dose is fine until bedtime.
  const after = caffeineCutoff({ doses: [{ t: bed + H, mg: 300 }], bedtimeMs: bed, halfLifeH: 5, nextDoseMg: 10, nowMs: bed - H });
  assert.deepEqual([after.residualAtBedMg, after.cutoffMs, after.status], [0, bed, "OPEN"]);

  const t0 = toronto("2026-06-10", 8);
  const curve = caffeineCurve([{ t: t0, mg: 100 }], t0 - H, t0 + 10 * H, 60, 5);
  assert.equal(curve.length, 12);
  assert.equal(curve[0].mg, 0);
  assert.equal(curve[1].mg, 100);
  close(curve[6].mg, 50, 1e-9);
  close(curve[11].mg, 25, 1e-9);
  assert.equal(caffeineCurve([], 0, -1, 5, 5).length, 0);
});

// ---------- records ----------

const set = (workoutId: string, load: number, reps: number, rir: number | null = null, t = 0, kind: SetLite["kind"] = "working", exerciseId = "ex-a"): SetLite => ({
  exerciseId,
  workoutId,
  load,
  reps,
  rir,
  kind,
  completedAt: t,
});

test("records: detection and edge cases", () => {
  const history: SetLite[] = [
    set("w1", 100, 10, 2, 1),
    set("w1", 100, 9, null, 2),
    set("w1", 60, 20, 0, 3, "warmup"),
    set("w2", 110, 8, null, 10),
    set("w2", 300, 5, null, 11, "working", "ex-other"),
  ];
  const kinds = (h: { kind: string }[]) => h.map((x) => x.kind).sort();

  const s = set("w3", 105, 12, 1, 20);
  const hits = detectRecords(history, s, [s]);
  assert.deepEqual(kinds(hits), ["e1rm", "repsAtLoad", "setVolume"]);
  const e = hits.find((h) => h.kind === "e1rm")!;
  close(e.value, 105 * (1 + 13 / 30));
  close(e.previous!, 140);
  assert.deepEqual(hits.find((h) => h.kind === "repsAtLoad"), { kind: "repsAtLoad", value: 12, previous: 8 });
  assert.deepEqual(hits.find((h) => h.kind === "setVolume"), { kind: "setVolume", value: 1260, previous: 1000 });

  // Heaviest: no repsAtLoad because nothing was lifted at ≥ this load.
  assert.deepEqual(kinds(detectRecords(history, set("w3", 120, 6, 0, 20), [])), ["e1rm", "heaviest"]);
  assert.deepEqual(kinds(detectRecords(history, set("w3", 120, 5, 0, 20), [])), ["heaviest"]); // e1RM 140 only ties
  // Warm-ups, first-ever exercise, and sets only from this workout give nothing.
  assert.deepEqual(detectRecords(history, set("w3", 200, 20, 0, 20, "warmup"), []), []);
  assert.deepEqual(detectRecords(history, set("w3", 50, 5, 0, 20, "working", "ex-new"), []), []);
  assert.deepEqual(detectRecords([set("w3", 50, 5, 0, 1)], set("w3", 60, 5, 0, 2), []), []);
  // e1RM is skipped above 15 reps-to-failure; reps at a lighter load compare against heavier sets too.
  // (The 20-rep set at 60 was a warm-up, so the best working reps at ≥ 60 is 10.)
  assert.deepEqual(detectRecords(history, set("w3", 60, 16, 0, 20), []), [{ kind: "repsAtLoad", value: 16, previous: 10 }]);
  assert.deepEqual(detectRecords(history, set("w3", 60, 11, 3, 20), []), [{ kind: "repsAtLoad", value: 11, previous: 10 }]);
  // Equal is not a record.
  assert.deepEqual(detectRecords(history, set("w3", 100, 10, 2, 20), []), []);

  // Session volume: fires once, on the set that crosses the best previous session (1900).
  const a = set("w3", 100, 10, 2, 21);
  const b = set("w3", 100, 10, 2, 22);
  const c = set("w3", 100, 10, 2, 23);
  assert.deepEqual(detectRecords(history, a, [a]), []);
  assert.deepEqual(detectRecords(history, b, [a, b]), [{ kind: "sessionVolume", value: 2000, previous: 1900 }]);
  assert.deepEqual(detectRecords(history, b, [a]), [{ kind: "sessionVolume", value: 2000, previous: 1900 }]); // newSet not in sessionSets
  assert.deepEqual(detectRecords(history, c, [a, b, c]), []);
  // A record set earlier in this workout is the bar for the next set.
  const first = set("w3", 115, 8, 1, 30);
  const second = set("w3", 115, 8, 1, 31);
  assert.ok(detectRecords(history, first, [first]).some((h) => h.kind === "heaviest"));
  assert.deepEqual(detectRecords(history, second, [first, second]), []);

  const all = sessionRecords(history, [c, a, b]);
  assert.deepEqual(all, [{ kind: "sessionVolume", value: 2000, previous: 1900, exerciseId: "ex-a" }]);

  assert.deepEqual(bestRecords(history, "ex-a"), { heaviest: 110, bestE1rm: 140, bestSetVolume: 1000, bestSessionVolume: 1900 });
  assert.deepEqual(bestRecords([]), { heaviest: null, bestE1rm: null, bestSetVolume: null, bestSessionVolume: null });
  assert.equal(bestRecords([set("w1", 50, 20, 0)]).bestE1rm, null);
});

// ---------- volume ----------

test("volume: every seed exercise maps to sensible muscles", () => {
  const expected: Record<string, Muscle> = {
    "ex-chest-press": "chest",
    "ex-pec-deck": "chest",
    "ex-shoulder-press": "shoulders",
    "ex-smith-bench": "chest",
    "ex-db-bench": "chest",
    "ex-db-shoulder": "shoulders",
    "ex-lateral-raise": "shoulders",
    "ex-cable-fly": "chest",
    "ex-triceps-pressdown": "triceps",
    "ex-lat-pulldown": "back",
    "ex-seated-row": "back",
    "ex-cable-row": "back",
    "ex-db-row": "back",
    "ex-assisted-pullup": "back",
    "ex-face-pull": "shoulders",
    "ex-preacher-curl": "biceps",
    "ex-db-curl": "biceps",
    "ex-leg-press": "quads",
    "ex-smith-squat": "quads",
    "ex-leg-extension": "quads",
    "ex-seated-leg-curl": "hamstrings",
    "ex-lying-leg-curl": "hamstrings",
    "ex-calf-raise": "calves",
    "ex-hip-abduction": "glutes",
    "ex-hip-adduction": "adductors",
    "ex-ab-crunch": "abs",
    "ex-back-extension": "back",
  };
  assert.equal(seedExercises.length, Object.keys(expected).length);
  for (const ex of seedExercises) {
    const m = musclesFor(ex.name, ex.group);
    assert.ok(m.primary.length >= 1, ex.name);
    assert.deepEqual(m.primary, [expected[ex.id]], ex.name);
    for (const x of m.secondary) assert.ok(!m.primary.includes(x));
  }
  assert.deepEqual(musclesFor("Chest press (machine)"), { primary: ["chest"], secondary: ["triceps", "shoulders"] });
  assert.deepEqual(musclesFor("Lat pulldown").secondary, ["biceps"]);
  assert.deepEqual(musclesFor("Shoulder press (machine)").secondary, ["triceps"]);
  assert.deepEqual(musclesFor("Romanian deadlift"), { primary: ["hamstrings"], secondary: ["glutes", "back"] });
  assert.deepEqual(musclesFor("Overhead triceps extension").primary, ["triceps"]);
  assert.deepEqual(musclesFor("Cable glute kickback").primary, ["glutes"]);
  assert.deepEqual(musclesFor("Upright row").primary, ["shoulders"]);
  assert.deepEqual(musclesFor("Hanging leg raise").primary, ["abs"]);
  assert.deepEqual(musclesFor("Hack squat").primary, ["quads"]);
  assert.deepEqual(musclesFor("Assisted dip").primary, ["triceps"]);
  assert.deepEqual(musclesFor("Reverse pec deck").primary, ["shoulders"]);
  assert.deepEqual(musclesFor("Incline press").primary, ["chest"]);
  assert.deepEqual(musclesFor("Mystery machine", "pull"), { primary: ["back"], secondary: ["biceps"] });
  assert.deepEqual(musclesFor("Mystery machine", "arms"), { primary: [], secondary: ["biceps", "triceps"] });
  assert.deepEqual(musclesFor("Mystery machine"), { primary: [], secondary: [] });
  assert.equal(MUSCLES.length, Object.keys(MUSCLE_LABEL).length);
  for (const m of MUSCLES) assert.equal(MUSCLE_LABEL[m], MUSCLE_LABEL[m].toUpperCase());
});

test("volume: weekly hard sets", () => {
  const w = (exerciseName: string, rir: number | null, completedAt: number, kind: "warmup" | "working" = "working") => ({ exerciseName, rir, completedAt, kind });
  const v = weeklySetsPerMuscle(
    [
      w("Chest press (machine)", 2, 10),
      w("Chest press (machine)", 1, 11),
      w("Chest press (machine)", null, 12),
      w("Chest press (machine)", 1, 13, "warmup"),
      w("Chest press (machine)", 5, 14), // not hard
      w("Lat pulldown", 0, 15),
      w("Lat pulldown", 0, 99), // outside the window
    ],
    0,
    99,
  );
  assert.equal(v.chest, 3);
  assert.equal(v.triceps, 1.5);
  assert.equal(v.shoulders, 1.5);
  assert.equal(v.back, 1);
  assert.equal(v.biceps, 0.5);
  assert.equal(v.quads, 0);
  assert.deepEqual(Object.keys(v).sort(), [...MUSCLES].sort());
});

// ---------- HRV ----------

test("hrv status", () => {
  const end = "2026-09-28";
  // Baseline: 60 nights alternating e^(4 ± 0.2).
  const base: HrvNight[] = Array.from({ length: 60 }, (_, i) => ({ day: addDays(end, -66 + i), rmssd: Math.exp(4 + (i % 2 ? 0.2 : -0.2)) }));
  const week = (ln: number, n = 7): HrvNight[] => Array.from({ length: n }, (_, i) => ({ day: addDays(end, -i), rmssd: Math.exp(ln) }));
  const sdLn = 0.2 * Math.sqrt(60 / 59);

  const normal = hrvStatus([...base, ...week(4)], end);
  assert.equal(normal.status, "normal");
  close(normal.baseline!, Math.exp(4), 1e-9);
  close(normal.low!, Math.exp(4 - 0.5 * sdLn), 1e-9);
  close(normal.high!, Math.exp(4 + 0.5 * sdLn), 1e-9);
  close(normal.avg7!, Math.exp(4), 1e-9);
  assert.equal(normal.n60, 60);
  assert.equal(normal.n7, 7);
  close(normal.cv7!, 0);
  assert.equal(hrvStatus([...base, ...week(3.8)], end).status, "low");
  assert.equal(hrvStatus([...base, ...week(4.2)], end).status, "high");

  // Too few nights this week, or too short a baseline.
  const few = hrvStatus([...base, ...week(4, 2)], end);
  assert.deepEqual([few.status, few.avg7, few.n7], ["insufficient", null, 2]);
  const short = hrvStatus([...base.slice(-13), ...week(4)], end);
  assert.deepEqual([short.status, short.baseline, short.n60], ["insufficient", null, 13]);

  const cv = hrvStatus([50, 60, 70].map((rmssd, i) => ({ day: addDays(end, -i), rmssd })), end);
  close(cv.cv7!, (100 * 10) / 60, 1e-9);
  close(cv.avg7!, Math.cbrt(50 * 60 * 70), 1e-9);
  // Invalid values are ignored.
  assert.equal(hrvStatus([{ day: end, rmssd: 0 }, { day: end, rmssd: NaN }], end).n7, 0);
});

// ---------- insights ----------

test("insights: auto tags and tag impact", () => {
  assert.deepEqual(autoTags({ caffeineAfterCutoff: false, lastMealMinBeforeBed: null, workoutEndMinBeforeBed: null, dayLoad: 0, ctl: 0 }), []);
  assert.deepEqual(autoTags({ caffeineAfterCutoff: true, lastMealMinBeforeBed: 90, workoutEndMinBeforeBed: 60, dayLoad: 151, ctl: 100 }), [
    "LATE CAFFEINE",
    "LATE MEAL",
    "LATE WORKOUT",
    "HIGH LOAD",
  ]);
  assert.deepEqual(autoTags({ caffeineAfterCutoff: false, lastMealMinBeforeBed: 180, workoutEndMinBeforeBed: 120, dayLoad: 150, ctl: 100 }), []);
  assert.deepEqual(autoTags({ caffeineAfterCutoff: false, lastMealMinBeforeBed: null, workoutEndMinBeforeBed: null, dayLoad: 50, ctl: 0 }), []);

  const obs = (withVals: number[], withoutVals: number[], tag = "LATE CAFFEINE"): TagObservation[] => [
    ...withVals.map((outcome, i) => ({ day: addDays("2026-06-01", i), tags: [tag, "OTHER"], outcome })),
    ...withoutVals.map((outcome, i) => ({ day: addDays("2026-07-01", i), tags: ["OTHER"], outcome })),
  ];
  // Reference values from scipy (Welch, 95 %).
  const sep = tagImpact(obs([6.1, 6.8, 5.9, 6.4, 7.0, 6.2], [7.4, 7.9, 7.1, 7.6, 8.0, 7.3, 7.7, 7.5]), "LATE CAFFEINE")!;
  assert.equal(sep.nWith, 6);
  assert.equal(sep.nWithout, 8);
  close(sep.diff, -1.1625, 1e-9);
  close(sep.ciLow, -1.62581, 0.003);
  close(sep.ciHigh, -0.69919, 0.003);
  assert.equal(sep.significant, true);

  const overlap = tagImpact(obs([7.0, 7.5, 6.5, 8.0, 6.0], [7.2, 6.4, 7.9, 6.8, 7.6, 7.1]), "LATE CAFFEINE")!;
  close(overlap.ciLow, -1.15509, 0.003);
  close(overlap.ciHigh, 0.82176, 0.003);
  assert.equal(overlap.significant, false);

  assert.equal(tagImpact(obs([6, 7, 6, 7], [8, 8, 8, 8, 8, 8]), "LATE CAFFEINE"), null);
  assert.equal(tagImpact(obs([6, 7, 6, 7, 6], [8, 8, 8, 8]), "LATE CAFFEINE"), null);
  assert.ok(tagImpact(obs([6, 7, 6, 7], [8, 8, 8, 8]), "LATE CAFFEINE", 4) !== null);
  // Zero variance in both groups: the interval collapses onto the difference.
  const flat = tagImpact(obs([5, 5, 5, 5, 5], [7, 7, 7, 7, 7]), "LATE CAFFEINE")!;
  assert.deepEqual([flat.diff, flat.ciLow, flat.ciHigh, flat.significant], [-2, -2, -2, true]);

  const ranked = rankTagImpacts([
    ...obs([6.1, 6.8, 5.9, 6.4, 7.0, 6.2], [7.4, 7.9, 7.1, 7.6, 8.0, 7.3, 7.7, 7.5]),
    ...obs([7.0, 7.5, 6.5, 8.0, 6.0], [7.2, 6.4, 7.9, 6.8, 7.6, 7.1], "LATE MEAL"),
  ]);
  assert.deepEqual(
    ranked.map((r) => r.tag),
    ["LATE CAFFEINE", "LATE MEAL"],
  ); // "OTHER" is on every observation, so it has no comparison group
});
