// Progress tab: trend instruments (weight, expenditure, strength, HRV, resting HR, sleep), the weekly
// report printout and behaviour insights (Whoop-journal style, from automatically derived tags).

import { useMemo, useState } from "react";
import { getAll, useLive } from "../db/db";
import { listGarminActivities, listGarminDays } from "../db/garmin";
import { entriesBetween, exerciseHistory, listCaffeine, listCheckIns, listExercises, listWeights, listWorkouts, today, TZ, workingSets, type ExerciseSession } from "../db/repo";
import type { CheckIn, Exercise, GarminDay, Settings, StrengthSet, WeightEntry } from "../db/types";
import { addDays, dayNumber, localTime } from "../engine/dates";
import { AUTO_TAGS, autoTags, tagImpact, type TagImpact, type TagObservation } from "../engine/insights";
import { sessionRecords } from "../engine/records";
import { caffeineRemaining } from "../engine/sleep";
import { sleepRegularityIndex } from "../engine/sleepplan";
import { e1RM } from "../engine/strength";
import { fmt } from "../engine/units";
import { MUSCLES, weeklySetsPerMuscle } from "../engine/volume";
import { defaultTrendParams, weightTrend } from "../engine/weight";
import { weightToDisplay } from "./format";
import { Card, Chips, PageTitle, Segmented, Stat, useUI } from "./kit";
import { hm, hrvFromGarmin, loadEnergyModel, loadLoadModel, pad, signed, type EnergyModel } from "./models";
import { PlotPanel, useFrame } from "./raster";
import { computeDebt, sleepNights } from "./sleep";
import { GLIB } from "../magi/glib";

type Range = "30" | "90" | "365" | "all";

/** Exercise ids ordered by when they were last trained (most recent first). */
async function trainedOrder(): Promise<string[]> {
  const last = new Map<string, number>();
  for (const s of await getAll<StrengthSet>("sets")) last.set(s.exerciseId, Math.max(last.get(s.exerciseId) ?? 0, s.completedAt));
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const noon = (d: string) => Date.parse(`${d}T12:00:00`);

type Section = "report" | "body" | "lifts" | "health";
const SECTIONS: { value: Section; label: string }[] = [
  { value: "report", label: "REPORT" },
  { value: "body", label: "BODY" },
  { value: "lifts", label: "LIFTS" },
  { value: "health", label: "HEALTH" },
];

export function ProgressScreen() {
  const { settings } = useUI();
  const [range, setRange] = useState<Range>("90");
  const [section, setSection] = useState<Section>("report");
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const exercises = useLive(() => listExercises(), [], [] as Exercise[]);
  const checkins = useLive(listCheckIns, [], [] as CheckIn[]);
  const garmin = useLive(listGarminDays, [], [] as GarminDay[]);
  const trained = useLive(trainedOrder, [], [] as string[]);
  const energy = useLive(() => loadEnergyModel(settings), [settings], null as EnergyModel | null);
  const [picked, setPicked] = useState<string>("");
  const exId = picked || trained[0] || "";
  const history = useLive(() => (exId ? exerciseHistory(exId) : Promise.resolve([] as ExerciseSession[])), [exId], [] as ExerciseSession[]);

  const rank = (id: string) => {
    const i = trained.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const pickList = [...exercises].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));

  const since = range === "all" ? 0 : Date.now() - Number(range) * 86400000;
  const trend = useMemo(() => weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg }))), [weights]);
  const shown = trend.filter((p) => p.t >= since);
  const d = (kg: number) => weightToDisplay(kg, settings);
  // 80 % range for a single weigh-in: trend uncertainty plus day-to-day scale noise.
  const band = shown.map((p) => {
    const sd = Math.sqrt(p.trendSD ** 2 + defaultTrendParams.observationSD ** 2);
    return { x: p.t, lo: d(p.trend - 1.2816 * sd), hi: d(p.trend + 1.2816 * sd) };
  });
  const last = trend.at(-1);
  const first = shown[0];
  const lowest = shown.length > 5 && last && shown.every((p) => p.trend >= last.trend - 1e-9);
  const highest = shown.length > 5 && last && shown.every((p) => p.trend <= last.trend + 1e-9);
  const massStamp =
    settings.phase === "cut" && lowest ? { text: "NEW LOW", tone: "grn" as const } : settings.phase === "bulk" && highest ? { text: "NEW HIGH", tone: "grn" as const } : undefined;

  const strengthPoints = history
    .map((h) => {
      const ws = workingSets(h.sets);
      if (!ws.length) return null;
      return { x: h.workout.start, y: Math.max(...ws.map((s) => e1RM(s.load, s.reps, s.rir ?? 0))) };
    })
    .filter((p): p is { x: number; y: number } => p !== null && p.x >= since);
  const bestSet = history.flatMap((h) => workingSets(h.sets)).sort((a, b) => b.load - a.load)[0];
  const bestE1 = strengthPoints.length ? Math.max(...strengthPoints.map((p) => p.y)) : null;

  // Sleep: Garmin nights first, manual entries fill gaps.
  const todayISO = today(settings);
  const firstDay = [...garmin.map((g) => g.date), ...checkins.map((c) => c.day)].sort()[0];
  const available = firstDay ? dayNumber(todayISO) - dayNumber(firstDay) + 1 : 0;
  const spanDays = Math.max(0, Math.min(available, range === "all" ? 3650 : Number(range)));
  const sleepPts = sleepNights(checkins, garmin, todayISO, spanDays)
    .filter((n) => n.night.mainSleepHours !== null)
    .map((n) => ({ x: noon(n.day), y: n.night.mainSleepHours as number }));

  // HRV and resting HR: nightly dots + 7-day line (geometric mean for HRV).
  const inRange = garmin.filter((g) => noon(g.date) >= since);
  const hrvDots = inRange.filter((g) => g.hrv.lastNight != null).map((g) => ({ x: noon(g.date), y: g.hrv.lastNight as number }));
  const hrvLine = inRange
    .map((g) => ({ x: noon(g.date), s: hrvFromGarmin(garmin, g.date) }))
    .filter((p) => p.s.avg7 !== null)
    .map((p) => ({ x: p.x, y: p.s.avg7 as number }));
  const hrvNow = hrvFromGarmin(garmin, localTime(Date.now(), TZ).date);
  const rhrDots = inRange.filter((g) => g.restingHR != null).map((g) => ({ x: noon(g.date), y: g.restingHR as number }));
  const rhrLine = rhrDots.map((p, i) => {
    const win = rhrDots.slice(Math.max(0, i - 6), i + 1);
    return { x: p.x, y: win.reduce((a, b) => a + b.y, 0) / win.length };
  });

  // Expenditure history.
  const ex = (energy?.series ?? []).filter((e) => noon(e.day) >= since && e.confidence !== "prior");
  const intakeDots = (energy?.intake ?? []).filter((i) => i.complete && noon(i.day) >= since).map((i) => ({ x: noon(i.day), y: i.kcal }));

  return (
    <div className="page">
      <PageTitle sys="PROGRESS" status={section === "report" ? "WEEKLY" : range === "all" ? "RANGE ALL" : `RANGE ${range} D`} />
      <Segmented options={SECTIONS} value={section} onChange={setSection} />
      {section !== "report" ? (
        <>
          <div style={{ height: 6 }} />
          <Chips
            options={[
              { value: "30", label: "30 D" },
              { value: "90", label: "90 D" },
              { value: "365", label: "1 YR" },
              { value: "all", label: "ALL" },
            ]}
            value={range}
            onChange={(v) => v && setRange(v)}
          />
        </>
      ) : null}
      <div style={{ height: 12 }} />

      {section === "report" ? (
        <>
          <WeeklyReport settings={settings} />
          <InsightsCard settings={settings} />
        </>
      ) : null}

      {section === "body" ? (
      <>
      <Card
        title="JANOS-SYS/BODYMASS"
        status={weights.length ? `${pad(weights.length, 3)} WEIGH-INS` : "NO DATA"}
        flush
        help="DOTS = WEIGH-INS · LINE = TREND · BAND = WHERE 8 IN 10 WEIGH-INS SHOULD LAND. RED DOTS WERE UNUSUAL AND DOWN-WEIGHTED. THE TREND IGNORES DAY-TO-DAY WATER SWINGS."
      >
        {weights.length < 3 ? (
          <div className="desc pad">WARN 031 INSUFFICIENT DATA · {weights.length}/3 WEIGH-INS · TREND APPEARS AFTER 3</div>
        ) : (
          <>
            <PlotPanel
              id="prog-mass"
              rev="BODYMASS MOD 1.04"
              dots={shown.map((p) => ({ x: p.t, y: d(p.observed), flag: p.suspect }))}
              lines={[{ pts: shown.map((p) => ({ x: p.t, y: d(p.trend) })), tone: "wht", width: 2 }]}
              band={band}
              marker={last ? { x: last.t, y: d(last.trend), label: `${fmt(d(last.trend))} ${settings.weightUnit}` } : undefined}
              legend="■ WEIGH-IN — TREND ▒ 80% BAND"
              stamp={massStamp}
              srText={last ? `Trend weight ${fmt(d(last.trend))} ${settings.weightUnit}.` : undefined}
            />
            <div className="card-body">
              <div className="grid-3">
                <Stat label="TREND" value={`${fmt(d(last!.trend))}`} sub={settings.weightUnit} />
                <Stat label="PER WEEK" value={signed(d(last!.slopePerDay * 7) - d(0), 2)} sub={settings.weightUnit} />
                <Stat label="IN RANGE" value={first ? signed(d(last!.trend) - d(first.trend), 1) : "—"} sub={settings.weightUnit} />
              </div>
            </div>
          </>
        )}
      </Card>

      <Card
        title="JANOS-SYS/EXPENDITURE"
        status={energy?.current ? `${pad(energy.current.kcal, 4)} KCAL` : "LEARNING"}
        flush
        help="MAINTENANCE CALORIES LEARNED FROM WHAT YOU EAT (COMPLETE DAYS ONLY) AND HOW YOUR TREND WEIGHT MOVES. DOTS = DAILY INTAKE."
      >
        {ex.length < 2 ? (
          <div className="desc pad">WARN 031 LEARNING · NEEDS 7 COMPLETE FOOD DAYS AND WEIGH-INS. MARK DAYS COMPLETE IN FOOD.</div>
        ) : (
          <PlotPanel
            id="prog-tdee"
            rev="ENERGY MOD 2.07"
            dots={intakeDots}
            lines={[{ pts: ex.map((e) => ({ x: noon(e.day), y: e.kcal })), tone: "wht", width: 2 }]}
            band={ex.filter((e) => e.confidence === "medium" || e.confidence === "high").map((e) => ({ x: noon(e.day), lo: e.low, hi: e.high }))}
            hlines={energy?.targets.kcal ? [{ y: energy.targets.kcal, label: `TARGET ${energy.targets.kcal}`, tone: "grn", dashed: true }] : undefined}
            yFormat={(v) => String(Math.round(v))}
            legend="— EXPENDITURE ▒ 80% RANGE ■ INTAKE (COMPLETE DAYS)"
            srText={`Estimated expenditure ${Math.round(ex.at(-1)!.kcal)} kcal per day.`}
          />
        )}
      </Card>

      </>
      ) : null}

      {section === "lifts" ? (
      <Card
        title="JANOS-SYS/STRENGTH"
        status="EST 1RM"
        help="ESTIMATED 1-REP MAX FROM THE BEST SET EACH SESSION (REPS + REPS IN RESERVE). COMPARE SESSIONS ON THE SAME MACHINE; IT IS NOT A TRUE MAX."
      >
        <select className="input" aria-label="exercise" value={exId} onChange={(e: any) => setPicked(e.target.value)}>
          <option value="">SELECT EXERCISE…</option>
          {pickList.map((e) => (
            <option key={e.id} value={e.id}>
              {trained.includes(e.id) ? e.name : `${e.name} (not trained yet)`}
            </option>
          ))}
        </select>
        {exId ? (
          strengthPoints.length ? (
            <>
              <div className="flush-in">
                <PlotPanel
                  id="prog-e1rm"
                  rev="STRENGTH MOD 1.1"
                  dots={strengthPoints}
                  lines={[{ pts: strengthPoints, tone: "wht" }]}
                  yPad={2}
                  yFormat={(v) => fmt(v, 0)}
                  marker={bestE1 !== null ? { x: strengthPoints.at(-1)!.x, y: strengthPoints.at(-1)!.y, label: fmt(strengthPoints.at(-1)!.y, 0) } : undefined}
                  srText={`Estimated one-rep max, latest ${fmt(strengthPoints.at(-1)!.y, 0)}.`}
                />
              </div>
              <div className="grid-2">
                <Stat label="BEST EST. 1-REP MAX" value={bestE1 !== null ? fmt(bestE1, 0) : "—"} />
                <Stat label="HEAVIEST WORKING SET" value={bestSet ? `${fmt(bestSet.load)} × ${bestSet.reps}` : "—"} />
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: "10px 0 0" }}>NO WORKING SETS IN THIS RANGE.</div>
          )
        ) : null}
      </Card>

      ) : null}

      {section === "health" ? (
      <>
      <Card
        title="JANOS-SYS/HRV"
        status={hrvNow.status === "insufficient" ? "BASELINE BUILDING" : `7 D ${pad(hrvNow.avg7 ?? 0, 2)} MS · ${hrvNow.status.toUpperCase()}`}
        flush
        help={`7-DAY AVERAGE (LOG SCALE) AGAINST YOUR 60-DAY NORMAL BAND (±0.5 SD). A SUSTAINED DROP BELOW THE BAND IS THE SIGNAL; SINGLE NIGHTS ARE NOISE.${hrvNow.cv7 !== null ? ` 7-DAY VARIATION ${hrvNow.cv7.toFixed(0)} %.` : ""}`}
      >
        <PlotPanel
          id="prog-hrv"
          rev="HRV MON 2.0"
          dots={hrvDots}
          lines={[{ pts: hrvLine, tone: "wht", width: 2 }]}
          hlines={
            hrvNow.low !== null && hrvNow.high !== null
              ? [
                  { y: hrvNow.high, label: `NORMAL ${Math.round(hrvNow.low)}-${Math.round(hrvNow.high)}`, tone: "grn", dashed: true },
                  { y: hrvNow.low, label: "", tone: "grn", dashed: true },
                ]
              : undefined
          }
          yFormat={(v) => String(Math.round(v))}
          legend="■ NIGHT — 7-DAY AVG -- NORMAL BAND"
          empty="NO HRV YET"
          srText={hrvNow.avg7 !== null ? `HRV 7-day average ${Math.round(hrvNow.avg7)} ms.` : "No HRV data."}
        />
      </Card>

      <Card title="JANOS-SYS/RESTING-HR" status={rhrLine.length ? `7 D ${pad(rhrLine.at(-1)!.y, 2)} BPM` : "NO DATA"} flush>
        <PlotPanel
          id="prog-rhr"
          rev="CARDIAC MON 1.3"
          dots={rhrDots}
          lines={[{ pts: rhrLine, tone: "wht", width: 2 }]}
          yPad={2}
          yFormat={(v) => String(Math.round(v))}
          legend="■ NIGHT — 7-DAY AVG"
          empty="NO RESTING HR YET"
        />
      </Card>

      <Card title="JANOS-SYS/SLEEP" status={`NEED ${hm(settings.sleepNeedHours)}`} flush>
        {sleepPts.length < 2 ? (
          <div className="desc pad">WARN 031 INSUFFICIENT DATA · {sleepPts.length}/2 NIGHTS · APPEARS AFTER THE FIRST GARMIN SYNC OR A MANUAL ENTRY</div>
        ) : (
          <PlotPanel
            id="prog-sleep"
            rev="SOMNO MOD 1.03"
            dots={sleepPts}
            lines={[{ pts: sleepPts, tone: "am" }]}
            hlines={[{ y: settings.sleepNeedHours, label: `NEED ${hm(settings.sleepNeedHours)}`, tone: "grn", dashed: true }]}
            yPad={0.5}
            yFormat={(v) => `${fmt(v, 1)}`}
            legend="■ NIGHT (H)"
          />
        )}
      </Card>
      </>
      ) : null}
    </div>
  );
}

// ---- weekly report printout ---------------------------------------------------------------------

interface ReportData {
  lines: { t: string; c?: string }[];
}

const W = 40; // columns: fits a 393-px phone at 13 px mono
const lead = (label: string, value: string) => {
  const dots = Math.max(2, W - label.length - value.length - 2);
  return `${label} ${".".repeat(dots)} ${value}`;
};
const rule = (ch = "-") => ch.repeat(W);

async function buildReport(settings: Settings): Promise<ReportData> {
  const day = today(settings);
  const from = addDays(day, -6);
  const localToday = localTime(Date.now(), TZ).date;
  const [energy, load, garmin, weights, workouts, sets, exercises, checkins] = await Promise.all([
    loadEnergyModel(settings),
    loadLoadModel(settings),
    listGarminDays(),
    listWeights(),
    listWorkouts(),
    getAll<StrengthSet>("sets"),
    listExercises(true),
    listCheckIns(),
  ]);
  const u = settings.weightUnit;
  const dw = (kg: number) => weightToDisplay(kg, settings);
  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const weekAgo = Date.now() - 7 * 86400000;
  const tNow = trend.at(-1);
  const tThen = [...trend].reverse().find((p) => p.t <= weekAgo);
  const weighIns = weights.filter((w) => w.t >= weekAgo).length;
  const week = energy.intake.filter((i) => i.day >= from && i.day <= day);
  const complete = week.filter((i) => i.complete);
  const avgIntake = complete.length ? complete.reduce((a, i) => a + i.kcal, 0) / complete.length : null;
  const wkWorkouts = workouts.filter((w) => w.start >= weekAgo);
  const names = new Map(exercises.map((e) => [e.id, e]));
  const vol = weeklySetsPerMuscle(
    sets.filter((s) => names.has(s.exerciseId)).map((s) => ({ exerciseName: names.get(s.exerciseId)!.name, group: names.get(s.exerciseId)!.group, rir: s.rir, kind: s.kind, completedAt: s.completedAt })),
    weekAgo,
    Date.now(),
  );
  const hardSets = MUSCLES.reduce((a, m) => a + vol[m], 0);
  const before = sets.filter((s) => s.completedAt < weekAgo);
  const recs = wkWorkouts.reduce((a, w) => a + sessionRecords(before, sets.filter((s) => s.workoutId === w.id)).length, 0);
  const ldWeek = load.series.filter((l) => l.day >= addDays(localToday, -6));
  const avgLoad = ldWeek.length ? ldWeek.reduce((a, l) => a + l.load, 0) / 7 : 0;
  const nights = sleepNights(checkins, garmin, day, 7).filter((n) => n.night.mainSleepHours !== null);
  const avgSleep = nights.length ? nights.reduce((a, n) => a + (n.night.mainSleepHours as number), 0) / nights.length : null;
  const debt = computeDebt(checkins, garmin, settings, day);
  const intervals = garmin
    .filter((g) => g.date > addDays(day, -15) && g.sleep.start && g.sleep.end)
    .map((g) => ({ start: g.sleep.start as number, end: g.sleep.end as number }));
  const sri = sleepRegularityIndex(intervals, noon(day), 14, TZ);
  const hrv = hrvFromGarmin(garmin, localToday);
  const gWeek = garmin.filter((g) => g.date >= addDays(localToday, -6));
  const rhr = gWeek.filter((g) => g.restingHR != null).map((g) => g.restingHR as number);
  const steps = gWeek.filter((g) => g.steps != null).map((g) => g.steps as number);
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const now = new Date();
  const stamp = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const verdict = energy.checkInState.ready && (load.today?.ratio ?? 1) < 1.5 && (debt.debtHours ?? 0) < 5;

  const L: { t: string; c?: string }[] = [];
  const add = (t: string, c?: string) => L.push({ t, c });
  add("JANOS-SYS  WEEKLY REPORT", "h");
  add(rule("="), "r");
  add(lead("PERIOD", `${from.slice(5).replace("-", ".")}-${day.slice(5).replace("-", ".")}`));
  add(lead("ISSUED", stamp));
  add(rule(), "r");
  add("** BODYMASS", "h");
  add(lead("TREND", tNow ? `${fmt(dw(tNow.trend))} ${u}` : "NO DATA"));
  add(lead("CHANGE 7 D", tNow && tThen ? `${signed(dw(tNow.trend) - dw(tThen.trend), 2)} ${u}` : "---"));
  add(lead("WEIGH-INS", `${weighIns}/7`));
  add("** ENERGY", "h");
  add(lead("AVG INTAKE", avgIntake !== null ? `${Math.round(avgIntake)} KCAL` : "NO COMPLETE DAYS"));
  add(lead("COMPLETE DAYS", `${complete.length}/7`), complete.length < 4 ? "x" : undefined);
  add(lead("EXPENDITURE", `${Math.round(energy.current?.kcal ?? energy.prior)} KCAL`));
  add(lead("TARGET", energy.targets.kcal ? `${energy.targets.kcal} KCAL (${energy.targets.source})` : "NONE"));
  add("** TRAINING", "h");
  add(lead("WORKOUTS", String(wkWorkouts.length)));
  add(lead("HARD SETS", fmt(hardSets, 1)));
  add(lead("NEW RECORDS", String(recs)), recs ? "g" : undefined);
  add(lead("AVG DAILY LOAD", String(Math.round(avgLoad))));
  add(lead("LOAD RATIO", load.today?.ratio != null ? `${load.today.ratio.toFixed(2)} ${load.band.toUpperCase()}` : "---"), (load.today?.ratio ?? 0) >= 1.5 ? "x" : undefined);
  add("** RECOVERY", "h");
  add(lead("AVG SLEEP", avgSleep !== null ? `${hm(avgSleep)} H (${nights.length} N)` : "NO DATA"));
  add(lead("SLEEP DEBT", debt.debtHours !== null ? `${hm(debt.debtHours)} H` : "---"), (debt.debtHours ?? 0) > 5 ? "x" : undefined);
  add(lead("REGULARITY SRI", sri.sri !== null ? String(Math.round(sri.sri)) : "---"));
  add(lead("HRV 7 D", hrv.avg7 !== null ? `${Math.round(hrv.avg7)} MS ${hrv.status.toUpperCase()}` : "---"), hrv.status === "low" ? "x" : undefined);
  add(lead("RESTING HR", avg(rhr) !== null ? `${Math.round(avg(rhr)!)} BPM` : "---"));
  add(lead("AVG STEPS", avg(steps) !== null ? String(Math.round(avg(steps)!)) : "---"));
  add(rule(), "r");
  add(verdict ? "STATUS ............... NOMINAL" : "STATUS ...... ATTENTION REQUIRED", verdict ? "g" : "x");
  add(rule("="), "r");
  add("END OF RECORD", "h");
  return { lines: L };
}

function WeeklyReport(props: { settings: Settings }) {
  const { toast } = useUI();
  const data = useLive(() => buildReport(props.settings), [props.settings], null as ReportData | null);
  const [shown, setShown] = useState(0);
  const total = data?.lines.length ?? 0;
  useFrame(() => {
    if (shown < total) setShown((n) => Math.min(total, n + 3)); // teletype: 3 lines per frame
  }, shown < total && !GLIB.REDUCED);
  const visible = GLIB.REDUCED ? total : shown;
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.lines.map((l) => l.t).join("\n"));
      toast(">> 041 REPORT COPIED");
    } catch {
      toast("ERR 071 CLIPBOARD UNAVAILABLE");
    }
  };
  return (
    <Card title="JANOS-SYS/REPORT" status={<button className="link" onClick={copy}>[C] COPY</button>}>
      {data ? (
        <pre className="mg-po report" onClick={() => setShown(total)} aria-label="Weekly report">
          {data.lines.map((l, i) => (
            <span key={i} className={i < visible ? "ln on" : "ln"}>
              <span className={l.c ?? ""}>{l.t}</span>
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        <div className="desc">COMPILING REPORT…<span className="mg-cursor" /></div>
      )}
    </Card>
  );
}

// ---- insights -----------------------------------------------------------------------------------

interface InsightsData {
  hrv: (TagImpact | { tag: string; nWith: number; nWithout: number; insufficient: true })[];
  score: (TagImpact | { tag: string; nWith: number; nWithout: number; insufficient: true })[];
  nights: number;
}

async function buildInsights(settings: Settings): Promise<InsightsData> {
  const now = Date.now();
  const from = now - 91 * 86400000;
  const [garmin, load, caffeine, workouts, acts] = await Promise.all([
    listGarminDays(),
    loadLoadModel(settings),
    listCaffeine(from),
    listWorkouts(),
    listGarminActivities(),
  ]);
  const entries = await entriesBetween(addDays(today(settings), -92), today(settings));
  const loadBy = new Map(load.series.map((l) => [l.day, l]));
  const ends = [
    ...workouts.filter((w) => w.end).map((w) => w.end as number),
    ...acts.map((a) => a.start + a.minutes * 60000),
  ];
  const hrvObs: TagObservation[] = [];
  const scoreObs: TagObservation[] = [];
  for (const g of garmin) {
    const bed = g.sleep.start;
    if (!bed || bed < from) continue;
    const eve = addDays(g.date, -1);
    const lastMeal = entries.filter((e) => e.t < bed && e.t > bed - 12 * 3600000).reduce((m, e) => Math.max(m, e.t), 0);
    const lastWork = ends.filter((t) => t < bed && t > bed - 12 * 3600000).reduce((m, t) => Math.max(m, t), 0);
    const l = loadBy.get(eve);
    const tags = autoTags({
      caffeineAfterCutoff: caffeineRemaining(caffeine.filter((c) => c.t < bed).map((c) => ({ mg: c.mg, t: c.t })), bed, settings.caffeineHalfLifeHours) > 25,
      lastMealMinBeforeBed: lastMeal ? (bed - lastMeal) / 60000 : null,
      workoutEndMinBeforeBed: lastWork ? (bed - lastWork) / 60000 : null,
      dayLoad: l?.load ?? 0,
      ctl: l?.ctl ?? 0,
    });
    if (g.hrv.lastNight != null) hrvObs.push({ day: g.date, tags, outcome: g.hrv.lastNight });
    if (g.sleep.score != null) scoreObs.push({ day: g.date, tags, outcome: g.sleep.score });
  }
  const run = (obs: TagObservation[]) =>
    AUTO_TAGS.map((tag) => {
      const r = tagImpact(obs, tag);
      if (r) return r;
      const nWith = obs.filter((o) => o.tags.includes(tag)).length;
      return { tag, nWith, nWithout: obs.length - nWith, insufficient: true as const };
    });
  return { hrv: run(hrvObs), score: run(scoreObs), nights: Math.max(hrvObs.length, scoreObs.length) };
}

function InsightsCard(props: { settings: Settings }) {
  const data = useLive(() => buildInsights(props.settings), [props.settings], null as InsightsData | null);
  if (!data) return null;
  const row = (r: InsightsData["hrv"][number], unit: string) => {
    if ("insufficient" in r) {
      return (
        <div className="row static" key={r.tag + unit}>
          <div className="grow">
            <div>{r.tag}</div>
            <div className="muted small">
              WARN 031 NEEDS 5 NIGHTS EACH WAY · HAVE {r.nWith} WITH / {r.nWithout} WITHOUT
            </div>
          </div>
          <div className="num">---</div>
        </div>
      );
    }
    const cls = r.significant ? (r.diff < 0 ? "num bad" : "num ok") : "num";
    return (
      <div className="row static" key={r.tag + unit}>
        <div className="grow">
          <div>{r.tag}</div>
          <div className="muted small">
            95 % CI {signed(r.ciLow, 1)} TO {signed(r.ciHigh, 1)} · N {r.nWith}/{r.nWithout}
            {r.significant ? "" : " · NOT CLEAR YET"}
          </div>
        </div>
        <div className={cls}>
          {signed(r.diff, 1)} {unit}
        </div>
      </div>
    );
  };
  return (
    <Card title="JANOS-SYS/INSIGHTS" status={`${pad(data.nights, 3)} NIGHTS · 90 D`} flush>
      <div className="subhead">NEXT-NIGHT HRV</div>
      {data.hrv.map((r) => row(r, "MS"))}
      <div className="subhead">NEXT-NIGHT SLEEP SCORE</div>
      {data.score.map((r) => row(r, "PTS"))}
      <div className="desc pad">
        TAGS COME FROM YOUR LOGS: CAFFEINE ABOVE 25 MG AT SLEEP ONSET, FOOD LOGGED WITHIN 3 H OF SLEEP, TRAINING ENDING WITHIN 2 H OF SLEEP, DAY LOAD ABOVE 1.5 × FITNESS. ASSOCIATIONS, NOT PROOF: OTHER THINGS CHANGE ON THE SAME DAYS.
      </div>
    </Card>
  );
}
