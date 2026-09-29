// Today: recovery, energy balance, training load and activity at a glance.

import { useEffect } from "react";
import { getAll, useLive } from "../db/db";
import { getGarminKey, getGarminStatus, listGarminDays, type GarminStatus } from "../db/garmin";
import { activeWorkout, entriesForDay, listCheckIns, listExercises, listTemplates, listWeights, listWorkouts, startWorkout, sumNutrients, today, TZ } from "../db/repo";
import type { CheckIn, Exercise, FoodEntry, GarminDay, StrengthSet, Template, WeightEntry, Workout } from "../db/types";
import { BAND_LABEL, muscleFatigue, rankFatigue } from "../engine/fatigue";
import { MUSCLE_LABEL } from "../engine/volume";
import { addDays, localTime } from "../engine/dates";
import { fmt } from "../engine/units";
import { DEFAULT_RATE_PCT } from "../engine/energy";
import { weightTrend } from "../engine/weight";
import { longDate, weightToDisplay } from "./format";
import { Card, garminMessageCode, PageTitle, Stat, useUI } from "./kit";
import { hrvFromGarmin, loadEnergyModel, loadLoadModel, loadTargetFor, pad, signed, type EnergyModel, type LoadModel } from "./models";
import { alertBand, MeterPanel, PlatesPanel, Seg7Panel, type PlateSpec } from "./raster";
import { assessRecovery, type Contributor } from "./recovery";
import { computeDebt } from "./sleep";

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${min} MIN AGO`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} H AGO` : `${Math.round(h / 24)} D AGO`;
}

const FACE = { good: "ok", normal: "ok", watch: "warn", unknown: "dim" } as const;
const STATE = { good: "GOOD", normal: "NORMAL", watch: "WATCH", unknown: "NO BASE" } as const;

function plateFor(tag: string, c: Contributor | undefined, gauge?: { lit: number; text: string }): PlateSpec {
  if (!c) return { tag, name: "— —", state: "NO DATA", detail: "AWAITING GARMIN", face: "off" };
  const detail = c.note
    .replace(/\.$/, "")
    .replace(/^Your usual range is /i, "RANGE ")
    .replace(/^Your usual is about /i, "BASE ")
    .replace(/^Weighted over 14 nights/i, "14-NIGHT WEIGHTED")
    .replace(/ min under your need/i, " MIN SHORT")
    .replace(/^At or above your need/i, "NEED MET");
  return { tag, name: c.value, state: STATE[c.level], detail, face: FACE[c.level], gauge };
}

export function TodayScreen() {
  const { settings, open, goTab, tab } = useUI();
  const day = today(settings);
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const entries = useLive(() => entriesForDay(day), [day], [] as FoodEntry[]);
  const checkins = useLive(listCheckIns, [], [] as CheckIn[]);
  const garmin = useLive(listGarminDays, [], [] as GarminDay[]);
  const garminKey = useLive(getGarminKey, [], null as string | null);
  const status = useLive(getGarminStatus, [], null as GarminStatus | null);
  const active = useLive(activeWorkout, [], null as Workout | null);
  const templates = useLive(listTemplates, [], [] as Template[]);
  const workouts = useLive(listWorkouts, [], [] as Workout[]);
  const energy = useLive(() => loadEnergyModel(settings), [settings], null as EnergyModel | null);
  const load = useLive(() => loadLoadModel(settings), [settings], null as LoadModel | null);
  const exercises = useLive(() => listExercises(true), [], [] as Exercise[]);
  const sets = useLive(() => getAll<StrengthSet>("sets"), [], [] as StrengthSet[]);

  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const last = trend.at(-1);
  const todayLocal = localTime(Date.now(), TZ).date;
  const todayWeighed = weights.some((w) => localTime(w.t, TZ).date === todayLocal);
  const totals = sumNutrients(entries);
  const g = garmin.find((d) => d.date === todayLocal);
  const debt = computeDebt(checkins, garmin, settings, day);
  const hrv = hrvFromGarmin(garmin, todayLocal);
  const recovery = assessRecovery(todayLocal, garmin, checkins, settings.sleepNeedHours, debt.debtHours, hrv);
  const byLabel = (re: RegExp) => recovery.contributors.find((c) => re.test(c.label));
  const weekAgo = Date.now() - 7 * 86400000;
  const liftsThisWeek = workouts.filter((w) => w.start >= weekAgo).length;
  const lastWorkout = workouts[0];
  const nextTemplate = lastWorkout && templates.length > 1 ? templates.find((t) => t.id !== lastWorkout.templateId) ?? templates[0] : templates[0];
  const hasData = weights.length + entries.length + checkins.length + workouts.length + garmin.length > 0;
  const backupDue = hasData && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > 7 * 86400000);
  const u = settings.weightUnit;
  const code = garminMessageCode(status?.message);
  const goalRate = settings.goalRatePct ?? DEFAULT_RATE_PCT[settings.phase];

  // ---- recovery plates
  const sleepC = byLabel(/^Sleep$/);
  const sleepH = g?.sleep.totalSec ? g.sleep.totalSec / 3600 : null;
  const sleepPct = sleepH !== null ? Math.round((sleepH / settings.sleepNeedHours) * 100) : null;
  const debtC = byLabel(/debt/i);
  const plates: PlateSpec[] = [
    plateFor("HRV", byLabel(/HRV/)),
    plateFor("RHR", byLabel(/Resting/)),
    plateFor("SLEEP", sleepC, sleepPct !== null ? { lit: Math.min(10, Math.round(sleepPct / 10)), text: `${pad(sleepPct, 3)}%` } : undefined),
    plateFor("DEBT", debtC, debt.debtHours !== null ? { lit: Math.min(10, Math.round(debt.debtHours)), text: `${fmt(debt.debtHours, 1)} H` } : undefined),
  ];
  const verdictWord = { Good: "GOOD", Normal: "NORMAL", Reduced: "REDUCED", "Not enough data": "NO DATA" }[recovery.summary];
  const verdictTone = recovery.summary === "Good" ? "grn" : recovery.summary === "Reduced" ? "red" : recovery.summary === "Normal" ? "am" : "or";
  const verdictLine = [
    g?.readiness != null ? `GARMIN READINESS ${pad(g.readiness, 3)}` : null,
    g?.bodyBatteryWake != null ? `BODY BATTERY ${pad(g.bodyBatteryWake, 3)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const scored = recovery.contributors.filter((c) => c.level !== "unknown");
  const nominal = scored.filter((c) => c.level !== "watch").length;

  // ---- energy
  const t = energy?.targets;
  const target = t?.kcal ?? null;
  const remaining = target !== null ? Math.round(target - totals.kcal) : null;
  const over = remaining !== null && remaining < 0;
  const burn = energy?.current ? Math.round(energy.current.kcal) : energy ? Math.round(energy.prior) : null;
  const proteinLeft = t?.proteinG ? Math.max(0, Math.round(t.proteinG - totals.protein)) : null;

  // ---- load
  const ld = load?.today ?? null;
  const tgt = load ? loadTargetFor(load, recovery.summary) : null;
  const ratio = ld?.ratio ?? null;
  const spike = ratio !== null && ratio >= 1.5;
  useEffect(() => {
    if (!spike || tab !== "today") return;
    try {
      if (localStorage.getItem("janos.spike") === todayLocal) return;
      localStorage.setItem("janos.spike", todayLocal);
    } catch {
      /* storage unavailable: still show it */
    }
    alertBand(`WARN 095 LOAD SPIKE · RATIO ${ratio!.toFixed(2)} · TAKE AN EASY DAY`);
  }, [spike, todayLocal, tab, ratio]);

  // ---- muscle fatigue (most fatigued groups; the body map lives in Train → Body)
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const fatigue = muscleFatigue(
    sets.filter((x) => exById.has(x.exerciseId)).map((x) => ({ exerciseName: exById.get(x.exerciseId)!.name, group: exById.get(x.exerciseId)!.group, rir: x.rir, kind: x.kind, completedAt: x.completedAt })),
    Date.now(),
  );
  const tired = rankFatigue(fatigue);

  // ---- activity (Garmin)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(todayLocal, -i));
  const intensity = garmin
    .filter((d) => weekDays.includes(d.date))
    .reduce((a, d) => a + (d.moderateMin ?? 0) + 2 * (d.vigorousMin ?? 0), 0);

  return (
    <div className="page">
      <PageTitle sys="TODAY" status={longDate(Date.now())} />

      {!garminKey ? (
        <button type="button" className="notice warn" onClick={() => open({ kind: "settings" })}>
          <span className="msg">!! GARMIN LINK NOT CONFIGURED</span>
          <span className="act">[TAP] SET UP AUTOMATIC SLEEP, HRV AND WORKOUT IMPORT</span>
        </button>
      ) : status?.message ? (
        <button type="button" className={code?.startsWith("ERR") ? "notice err" : "notice warn"} onClick={() => open({ kind: "settings" })}>
          <span className="msg">{code}</span>
          <span className="act">[TAP] OPEN CONFIG</span>
        </button>
      ) : null}
      {backupDue ? (
        <button type="button" className="notice warn" onClick={() => open({ kind: "settings" })}>
          <span className="msg">WARN 073 BACKUP OVERDUE</span>
          <span className="act">DATA LIVES ONLY ON THIS PHONE · [TAP] EXPORT A BACKUP</span>
        </button>
      ) : null}
      {energy && settings.autoTargets && energy.checkInState.due && !energy.checkInState.ready ? (
        <button type="button" className="notice warn" onClick={() => goTab("food")}>
          <span className="msg">WARN 031 WEEKLY CHECK-IN WAITING · {energy.checkInState.missing}</span>
          <span className="act">[TAP] MARK FOOD DAYS COMPLETE AND WEIGH IN</span>
        </button>
      ) : null}

      <Card title="JANOS-SYS/RECOVERY" status={status?.lastSuccess ? `GARMIN ${ago(status.lastSuccess)}` : "NO LINK"} flush>
        <PlatesPanel
          id="today-recovery"
          rev="RECOVERY MOD 3.1"
          plates={plates}
          verdict={{ word: verdictWord, tone: verdictTone, line: verdictLine || `${nominal} OF ${scored.length} NOMINAL` }}
          srText={`Recovery ${verdictWord}. ${recovery.contributors.map((c) => `${c.label} ${c.value} ${c.level}`).join(". ")}`}
        />
        {recovery.summary === "Reduced" ? (
          <div className="desc pad">SEVERAL SIGNALS OFF · GO EASIER TODAY IF YOU FEEL IT</div>
        ) : recovery.summary === "Not enough data" ? (
          <div className="desc pad">WARN 031 WAITING FOR GARMIN SLEEP AND HEART-RATE DATA</div>
        ) : null}
      </Card>

      <Card title="JANOS-SYS/ENERGY" status={t?.source === "AUTO" ? "AUTO TARGETS" : t?.source === "MANUAL" ? "MANUAL TARGETS" : "NO TARGET"} flush onClick={() => goTab("food")}>
        <Seg7Panel
          id="today-energy"
          heat
          rev="ENERGY MOD 2.07"
          value={remaining !== null ? String(Math.abs(remaining)) : String(Math.round(totals.kcal))}
          caption={remaining === null ? "KCAL EATEN:" : over ? "KCAL OVER TARGET:" : "KCAL REMAINING:"}
          unit="KCAL"
          tone={over ? "red" : "am"}
          state={over ? { text: "■ OVER", tone: "red", blink: 2 } : remaining !== null ? { text: "● ON TRACK", tone: "grn" } : undefined}
          sub={[
            target !== null ? `TARGET ${pad(target, 4)}` : null,
            `EATEN ${pad(totals.kcal, 4)}`,
            burn !== null ? `BURN ≈${pad(burn, 4)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          side={proteinLeft !== null ? { big: String(proteinLeft), small: "G PROTEIN" } : undefined}
          srText={`Energy: ${remaining !== null ? `${remaining} kcal remaining of ${target}` : `${Math.round(totals.kcal)} kcal eaten`}. Estimated burn ${burn ?? "unknown"} kcal.`}
        />
      </Card>

      <Card
        title="JANOS-SYS/TRAINING"
        status={tgt ? `TODAY ${tgt.label}` : `${liftsThisWeek} ${liftsThisWeek === 1 ? "LIFT" : "LIFTS"} / 7 D`}
        flush
        help="LOAD = TODAY'S TRAINING LOAD AGAINST A TARGET SET BY YOUR RECOVERY. RATIO = LAST 7 DAYS ÷ LAST 28 DAYS: 0.8–1.4 IS A SAFE BUILD, 1.5+ IS A SPIKE. MUSCLES = THE MOST FATIGUED GROUPS FROM YOUR LOGGED SETS (FULL BODY MAP IN TRAIN → BODY)."
      >
        {load && load.hasData && ld && tgt ? (
          <MeterPanel
            id="today-load"
            rev="LOAD MON 1.2"
            stamp={spike ? { text: "LOAD SPIKE", tone: "red", blink: true } : undefined}
            rows={[
              {
                id2: "01",
                name: "LOAD",
                value: Math.round(ld.load),
                max: Math.max(tgt.high * 1.25, ld.load, 1),
                peak: Math.round(tgt.high),
                line: `LOAD ${pad(ld.load, 3)} · TARGET ${pad(tgt.low, 3)}-${pad(tgt.high, 3)}`,
                right: ld.load >= tgt.low && ld.load <= tgt.high ? "IN BAND" : ld.load > tgt.high ? "OVER" : "UNDER",
                tone: ld.load > tgt.high * 1.1 ? "red" : ld.load >= tgt.low ? "grn" : "bands",
              },
              {
                id2: "02",
                name: "RATIO",
                value: ratio ?? 0,
                max: 2,
                line: ratio !== null ? `7 D : 28 D ${ratio.toFixed(2)} · ${load.band.toUpperCase().replace("-", " ")}` : `RATIO NEEDS 14 DAYS · HAVE ${pad(ld.historyDays)}`,
                right: ratio !== null ? ratio.toFixed(2) : "---",
                tone: ratio === null ? "dim" : ratio >= 1.5 ? "red" : ratio >= 0.8 ? "grn" : "bands",
              },
            ]}
            srText={`Training load today ${Math.round(ld.load)}, target ${tgt.low} to ${tgt.high}. Load ratio ${ratio?.toFixed(2) ?? "not available"}.`}
          />
        ) : null}
        <div className="card-body">
          <div className="fatigue-line">
            <span className="lab">MUSCLES</span>
            {tired.length ? (
              tired.slice(0, 3).map((m) => (
                <span key={m} className={`fat b${fatigue[m].band}`}>
                  {MUSCLE_LABEL[m]} {BAND_LABEL[fatigue[m].band]}
                  {fatigue[m].readyInH ? ` ${fatigue[m].readyInH}H` : ""}
                </span>
              ))
            ) : (
              <span className="fat b0">ALL FRESH</span>
            )}
          </div>
          {active ? (
            <button className="btn block" onClick={() => goTab("train")}>
              ► CONTINUE <span className="uc">{active.name}</span>
            </button>
          ) : nextTemplate ? (
            <button
              className="btn block"
              onClick={async () => {
                await startWorkout(nextTemplate);
                goTab("train");
              }}
            >
              ► START <span className="uc">{nextTemplate.name}</span>
            </button>
          ) : (
            <button className="btn block" onClick={() => goTab("train")}>OPEN TRAIN</button>
          )}
        </div>
      </Card>

      {g ? (
        <Card
          title={
            <>
              JANOS-SYS/ACTIVITY · <span className="blu">GARMIN</span>
            </>
          }
          status={g.stressAvg != null && g.stressAvg >= 0 ? `STRESS ${pad(g.stressAvg, 3)}` : undefined}
          flush
        >
          <MeterPanel
            id="today-activity"
            rev="ACTIVITY MOD 1.1"
            rows={[
              {
                id2: "01",
                name: "STEPS",
                value: Math.min(g.steps ?? 0, 10000),
                max: 10000,
                line: `STEPS ${(g.steps ?? 0).toLocaleString("en-CA")} / 10,000`,
                right: `${pad(((g.steps ?? 0) / 10000) * 100, 3)}%`,
                tone: (g.steps ?? 0) >= 10000 ? "grn" : "bands",
              },
              {
                id2: "02",
                name: "INTENS",
                value: Math.min(intensity, 150),
                max: 150,
                line: `INTENSITY MIN 7 D ${pad(intensity, 3)} / 150 (VIGOROUS × 2)`,
                right: `${pad((intensity / 150) * 100, 3)}%`,
                tone: intensity >= 150 ? "grn" : "bands",
              },
            ]}
            srText={`Steps ${g.steps ?? 0} of 10000. Intensity minutes this week ${intensity} of 150.`}
          />
        </Card>
      ) : null}

      <Card
        title="JANOS-SYS/BODYMASS"
        aside={todayWeighed ? "WEIGHED TODAY" : <button className="link" onClick={() => open({ kind: "weight" })}>WEIGH IN</button>}
      >
        {last && weights.length >= 3 ? (
          <div className="grid-2">
            <Stat label="TREND WEIGHT" value={`${fmt(weightToDisplay(last.trend, settings))} ${u}`} />
            <Stat
              label="PER WEEK"
              value={`${last.slopePerDay >= 0 ? "+" : ""}${fmt(weightToDisplay(last.slopePerDay * 7, settings) - weightToDisplay(0, settings), 2)} ${u}`}
              sub={`PHASE: ${settings.phase.toUpperCase()}${
                settings.autoTargets && energy?.weightKg
                  ? ` · GOAL ${signed(weightToDisplay((goalRate / 100) * energy.weightKg, settings) - weightToDisplay(0, settings), 2)} ${u}/WK`
                  : ""
              }`}
            />
          </div>
        ) : (
          <div className="empty" style={{ padding: 0 }}>
            {weights.length
              ? `WARN 031 INSUFFICIENT DATA · ${weights.length}/3 WEIGH-INS · TREND APPEARS AFTER 3`
              : "NO WEIGH-INS YET · WEIGH IN AFTER WAKING, BEFORE FOOD"}
          </div>
        )}
      </Card>

    </div>
  );
}
