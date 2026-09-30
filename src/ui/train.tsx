// Training tab: strength (templates, live workout logger, history, exercise editor) and cardio.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { del, get, put, uid, useLive } from "../db/db";
import {
  activeWorkout,
  deleteWorkout,
  exerciseHistory,
  exerciseLoads,
  finishWorkout,
  listCardio,
  listExercises,
  listTemplates,
  listWorkouts,
  logSet,
  setsForWorkout,
  startWorkout,
  workingSets,
  type ExerciseSession,
} from "../db/repo";
import type { CardioModality, CardioSession, CardioType, Exercise, GarminDay, StrengthSet, Template, Workout } from "../db/types";
import { detectRecords, sessionRecords, type RecordHit, type SetLite } from "../engine/records";
import { adviseProgression, e1RM, type ProgressionAdvice } from "../engine/strength";
import { MUSCLE_LABEL, MUSCLES, musclesFor, weeklySetsPerMuscle } from "../engine/volume";
import { buildHay, rank } from "../engine/foodsearch";
import { FATIGUE_TAU_H, muscleFatigue, rankFatigue, type FatigueSet } from "../engine/fatigue";
import { BodyMapPanel, type Vitals } from "./bodymap";
import { listGarminDays } from "../db/garmin";
import { fmt, formatMinSec } from "../engine/units";
import { distFromDisplay, distToDisplay, shortDateTime, toLocalInputValue } from "./format";
import { Card, Chips, confirmScreen, Field, NumInput, PageTitle, ProgressBar, Segmented, Sheet, Stat, Stepper, useUI } from "./kit";
import { loadLoadModel, pad, signed, type LoadModel } from "./models";
import { BarsPanel, MeterPanel, PlotPanel, Seg7Panel } from "./raster";
import { getAll } from "../db/db";

type TrainMode = "strength" | "body" | "cardio";
const TRAIN_MODES: { value: TrainMode; label: string }[] = [
  { value: "strength", label: "STRENGTH" },
  { value: "body", label: "BODY" },
  { value: "cardio", label: "CARDIO" },
];

export function TrainScreen() {
  const [mode, setMode] = useState<TrainMode>("strength");
  const active = useLive(activeWorkout, [], null as Workout | null);
  if (active && mode === "strength") return <WorkoutView workout={active} />;
  return (
    <div className="page">
      <PageTitle sys="TRAIN" status={TRAIN_MODES.find((m) => m.value === mode)!.label} />
      <Segmented options={TRAIN_MODES} value={mode} onChange={setMode} />
      <div style={{ height: 8 }} />
      {mode === "strength" ? <StrengthHome /> : mode === "body" ? <BodyHome /> : <CardioHome />}
    </div>
  );
}

// ---- body: fatigue map, weekly volume, records ------------------------------------

/** Logged sets in the shape the fatigue and volume models take. */
function useFatigueSets(exercises: Exercise[]): FatigueSet[] {
  const sets = useLive(() => getAll<StrengthSet>("sets"), [], [] as StrengthSet[]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return sets
    .filter((x) => byId.has(x.exerciseId))
    .map((x) => ({ exerciseName: byId.get(x.exerciseId)!.name, group: byId.get(x.exerciseId)!.group, rir: x.rir, kind: x.kind, completedAt: x.completedAt }));
}

function BodyHome() {
  const exercises = useLive(() => listExercises(true), [], [] as Exercise[]);
  const workouts = useLive(listWorkouts, [], [] as Workout[]);
  const sets = useFatigueSets(exercises);
  return (
    <>
      <FatigueCard sets={sets} />
      <VolumeCard sets={sets} />
      <RecordsCard exercises={exercises} workouts={workouts} />
    </>
  );
}

/** Latest Garmin vitals for the body map (each value from the most recent day that has it). */
export function latestVitals(days: readonly GarminDay[]): Vitals {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
  const pick = (get: (d: GarminDay) => number | null | undefined) => {
    for (const d of sorted) {
      const x = get(d);
      if (x != null && Number.isFinite(x) && x >= 0) return { v: x, date: d.date };
    }
    return null;
  };
  const hr = pick((d) => (d.restingHR && d.restingHR > 0 ? d.restingHR : null));
  const hrv = pick((d) => (d.hrv?.lastNight && d.hrv.lastNight > 0 ? d.hrv.lastNight : null));
  const resp = pick((d) => (d.sleep?.respiration && d.sleep.respiration > 0 ? d.sleep.respiration : null));
  const stress = pick((d) => d.stressAvg);
  const bb = pick((d) => d.bodyBatteryWake);
  return { hr: hr?.v ?? null, hrv: hrv?.v ?? null, resp: resp?.v ?? null, stress: stress?.v ?? null, bb: bb?.v ?? null, date: hr?.date ?? hrv?.date ?? resp?.date ?? null };
}

/** Muscle fatigue now, on the front/back body map, with the Garmin vitals layer (heart, lungs, ECG). */
export function FatigueCard(props: { sets: FatigueSet[] }) {
  const garmin = useLive(listGarminDays, [], [] as GarminDay[]);
  const vitals = latestVitals(garmin);
  const f = muscleFatigue(props.sets, Date.now());
  const ranked = rankFatigue(f);
  const ready = MUSCLES.filter((m) => f[m].lastTrainedMs !== null && f[m].readyInH === 0).length;
  return (
    <Card
      title="JANOS-SYS/BODY"
      status={`${vitals.hr ? `HR ${vitals.hr} · ` : ""}${ranked.length ? `${ranked.length} RECOVERING` : "ALL FRESH"}`}
      flush
      help={`MUSCLES: RED = TRAINING STRESS A MUSCLE IS STILL RECOVERING FROM. DEEP RED = LOW, BRIGHT RED = MAX, HOLLOW = FRESH. EVERY HARD SET ADDS STRESS (MORE WHEN TAKEN CLOSER TO FAILURE; SECONDARY MUSCLES COUNT HALF) AND IT FADES OVER ${FATIGUE_TAU_H.biceps}–${FATIGUE_TAU_H.chest} H DEPENDING ON MUSCLE SIZE. "READY" = BELOW MOD, FINE TO TRAIN HARD AGAIN.${ready ? ` ${ready} TRAINED GROUP${ready > 1 ? "S" : ""} READY NOW.` : ""} VITALS: THE HEART BEATS AT YOUR GARMIN RESTING HEART RATE, THE LUNGS BREATHE AT YOUR SLEEP BREATHING RATE, AND THE ECG SPACING WOBBLES WITH LAST NIGHT'S HRV. THE TRACE IS A SIMULATION FROM THOSE NUMBERS, NOT A MEDICAL ECG. IT TURNS AMBER WHEN AVERAGE STRESS IS 50+.`}
    >
      <BodyMapPanel id="train-myomap" muscles={f} vitals={vitals} rev="MYOMAP R02" />
    </Card>
  );
}

// ---- strength home ------------------------------------------------------------

function StrengthHome() {
  const templates = useLive(listTemplates, [], [] as Template[]);
  const exercises = useLive(() => listExercises(true), [], [] as Exercise[]);
  const workouts = useLive(listWorkouts, [], [] as Workout[]);
  const [editTpl, setEditTpl] = useState<Template | null>(null);
  const [editEx, setEditEx] = useState<Exercise | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [detail, setDetail] = useState<Workout | null>(null);
  const names = new Map(exercises.map((e) => [e.id, e.name]));

  return (
    <>
      <h2>START A WORKOUT</h2>
      {templates.map((t) => (
        <Card key={t.id} title={<span className="uc">{t.name}</span>} aside={<button className="link" onClick={() => setEditTpl(t)}>EDIT</button>}>
          <div className="small uc" style={{ marginBottom: 10 }}>
            {t.exerciseIds.map((id) => names.get(id) ?? "?").join(" · ")}
          </div>
          <button className="btn block" onClick={() => startWorkout(t)}>
            ► START <span className="uc">{t.name}</span>
          </button>
        </Card>
      ))}
      <div className="grid-2">
        <button className="btn plain" onClick={() => startWorkout()}>EMPTY WORKOUT</button>
        <button className="btn plain" onClick={() => setEditTpl({ id: uid(), name: "New template", exerciseIds: [], setsPerExercise: 3 })}>[+] NEW TEMPLATE</button>
      </div>
      <div style={{ height: 8 }} />
      <button className="btn plain block" onClick={() => setShowLibrary(true)}>EXERCISES + MACHINES</button>


      <h2>HISTORY</h2>
      <Card title="WORKOUT LOG" aside={workouts.length ? `${workouts.length} FILED` : null} flush>
        {workouts.length === 0 ? <div className="empty">NO RECORDS YET. EVERY FINISHED WORKOUT IS FILED HERE AUTOMATICALLY.</div> : null}
        {workouts.slice(0, 20).map((w) => (
          <button className="row" key={w.id} onClick={() => setDetail(w)}>
            <div className="grow">
              <div className="name uc">{w.name}</div>
              <div className="muted small">
                {shortDateTime(w.start)}
                {w.end ? ` · ${Math.round((w.end - w.start) / 60000)} MIN` : ""}
                {w.sessionRPE ? ` · EFFORT ${w.sessionRPE}/10` : ""}
              </div>
            </div>
            <span className="go">►</span>
          </button>
        ))}
      </Card>

      {editTpl ? <TemplateEditor template={editTpl} exercises={exercises} onClose={() => setEditTpl(null)} /> : null}
      {showLibrary ? (
        <ExerciseLibrary
          exercises={exercises}
          onClose={() => setShowLibrary(false)}
          onEdit={(e) => {
            setShowLibrary(false);
            setEditEx(e);
          }}
        />
      ) : null}
      {editEx ? <ExerciseEditor exercise={editEx} onClose={() => setEditEx(null)} /> : null}
      {detail ? <WorkoutDetail workout={detail} names={names} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

/** Hard sets per muscle over the last 7 days (working sets at ≤ 4 RIR; secondary muscles count half). */
function VolumeCard(props: { sets: FatigueSet[] }) {
  const to = Date.now();
  const vol = weeklySetsPerMuscle(props.sets, to - 7 * 86400000, to);
  const total = MUSCLES.reduce((a, m) => a + vol[m], 0);
  return (
    <Card
      title="JANOS-SYS/VOLUME"
      status={`${fmt(total, 1)} HARD SETS / 7 D`}
      help="HARD SET = WORKING SET AT ≤4 REPS IN RESERVE. 10–20 PER MUSCLE PER WEEK IS THE USUAL GROWTH RANGE (GREEN AT 10+); SECONDARY MUSCLES COUNT HALF."
    >
      {total === 0 ? <div className="empty" style={{ padding: 0 }}>NO HARD SETS IN THE LAST 7 DAYS.</div> : null}
      {total > 0
        ? MUSCLES.map((m) => (
            <div className="vol-row" key={m}>
              <span className="lab">{MUSCLE_LABEL[m]}</span>
              <ProgressBar value={Math.min(vol[m], 20)} max={20} cells={20} />
              <span className={vol[m] >= 10 ? "num ok" : "num"}>{vol[m].toFixed(1).padStart(4, "0")}</span>
            </div>
          ))
        : null}
    </Card>
  );
}

/** Personal records set in the last 30 days, replayed workout by workout against everything before it. */
function RecordsCard(props: { exercises: Exercise[]; workouts: Workout[] }) {
  const sets = useLive(() => getAll<StrengthSet>("sets"), [], [] as StrengthSet[]);
  const names = new Map(props.exercises.map((e) => [e.id, e]));
  const since = Date.now() - 30 * 86400000;
  const hits: { t: number; ex: string; r: RecordHit }[] = [];
  const byWorkout = new Map<string, StrengthSet[]>();
  for (const x of sets) byWorkout.set(x.workoutId, [...(byWorkout.get(x.workoutId) ?? []), x]);
  const ordered = [...props.workouts].filter((w) => w.end).sort((a, b) => a.start - b.start);
  const seen: StrengthSet[] = [];
  for (const w of ordered) {
    const ws = byWorkout.get(w.id) ?? [];
    if (w.start >= since) {
      for (const h of sessionRecords(seen, ws)) {
        const e = names.get(h.exerciseId);
        if (e && !assisted(e)) hits.push({ t: w.start, ex: e.name, r: h });
      }
    }
    seen.push(...ws);
  }
  // One line per exercise per workout; the most meaningful record first.
  const RANK: RecordHit["kind"][] = ["e1rm", "heaviest", "repsAtLoad", "setVolume", "sessionVolume"];
  const grouped = new Map<string, { t: number; ex: string; rs: RecordHit[] }>();
  for (const h of hits) {
    const k = `${h.t}|${h.ex}`;
    const g = grouped.get(k) ?? { t: h.t, ex: h.ex, rs: [] };
    g.rs.push(h.r);
    grouped.set(k, g);
  }
  const lines = [...grouped.values()].sort((a, b) => b.t - a.t);
  const shown = lines.slice(0, 10);
  return (
    <Card title="JANOS-SYS/RECORDS" status={`${pad(lines.length)} · 30 D`} flush>
      {shown.length === 0 ? <div className="empty">NO RECORDS IN 30 DAYS. RECORDS NEED AT LEAST ONE EARLIER SESSION ON THE SAME MACHINE.</div> : null}
      {shown.map((g, i) => {
        const rs = [...g.rs].sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind));
        return (
          <div className="row static rec-row" key={i}>
            <div className="grow">
              <div className="name uc">{g.ex}</div>
              <div className="muted small">
                {shortDateTime(g.t)} · <span className="rec">▲ {recordText(rs[0])}</span>
                {rs.length > 1 ? ` · +${rs.length - 1} MORE` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function WorkoutDetail(props: { workout: Workout; names: Map<string, string>; onClose: () => void }) {
  const { toast } = useUI();
  const sets = useLive(() => setsForWorkout(props.workout.id), [props.workout.id], [] as StrengthSet[]);
  const byEx = new Map<string, StrengthSet[]>();
  for (const s of sets) byEx.set(s.exerciseId, [...(byEx.get(s.exerciseId) ?? []), s]);
  return (
    <Sheet
      title="WORKOUT LOG"
      onClose={props.onClose}
      enterLabel="DELETE"
      footer={
        <button
          className="btn danger block"
          onClick={async () => {
            const ok = await confirmScreen({ title: "DELETE WORKOUT", message: "DELETE THIS WORKOUT AND ALL ITS SETS?", confirmLabel: "DELETE", danger: true, alarm: false });
            if (!ok) return;
            await deleteWorkout(props.workout.id);
            toast("WORKOUT DELETED");
            props.onClose();
          }}
        >
          DELETE WORKOUT
        </button>
      }
    >
      <div className="wk-status" style={{ margin: "0 0 12px" }}>
        <div className="grow">
          <div className="name uc">{props.workout.name}</div>
          <div className="sub">{shortDateTime(props.workout.start)}</div>
        </div>
      </div>
      {[...byEx.entries()].map(([exId, list]) => (
        <Card key={exId} title={<span className="uc">{props.names.get(exId) ?? "Exercise"}</span>} aside={`${list.length} SETS`}>
          {list.map((s) => (
            <div className="set-line" key={s.id}>
              <span className="idx">{s.kind === "warmup" ? "W" : s.index}</span>
              <span>{fmt(s.load)} × {s.reps}{s.rir !== null ? ` @ ${s.rir} RIR` : ""}</span>
              <span className="muted small">E1RM {fmt(e1RM(s.load, s.reps, s.rir ?? 0), 0)}</span>
            </div>
          ))}
        </Card>
      ))}
    </Sheet>
  );
}

// ---- live workout ---------------------------------------------------------------

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let lock: any = null;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request("screen");
      } catch {
        /* not supported */
      }
    };
    void request();
    const onVis = () => document.visibilityState === "visible" && void request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.();
    };
  }, [active]);
}

function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.25);
    }
    (navigator as any).vibrate?.(300);
  } catch {
    /* no audio */
  }
}

function WorkoutView(props: { workout: Workout }) {
  const { settings, toast } = useUI();
  const w = props.workout;
  const exercises = useLive(() => listExercises(true), [], [] as Exercise[]);
  const sets = useLive(() => setsForWorkout(w.id), [w.id], [] as StrengthSet[]);
  const [current, setCurrent] = useState<string | null>(w.exerciseIds[0] ?? null);
  const [restEnd, setRestEnd] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  useWakeLock(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (restEnd !== null && now >= restEnd) {
      setRestEnd(null);
      beep();
    }
  }, [now, restEnd]);
  useEffect(() => {
    if (current === null && w.exerciseIds.length) setCurrent(w.exerciseIds[0]);
  }, [w.exerciseIds, current]);

  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const ex = current ? exMap.get(current) : undefined;
  const elapsed = Math.floor((now - w.start) / 1000);

  const addExercise = async (e: Exercise) => {
    const updated = { ...w, exerciseIds: w.exerciseIds.includes(e.id) ? w.exerciseIds : [...w.exerciseIds, e.id] };
    await put("workouts", updated);
    setCurrent(e.id);
    setPicking(false);
  };

  return (
    <div className="page">
      <PageTitle sys="TRAIN/ACTIVE" status={<span className="act mg-bl2">● ACTIVE</span>} />
      <div className="wk-status">
        <div className="grow">
          <div className="name uc">{w.name}</div>
          <div className="sub">{formatMinSec(elapsed)} ELAPSED · {sets.length} {sets.length === 1 ? "SET" : "SETS"}</div>
        </div>
        <button className="btn sm" onClick={() => setFinishing(true)}>■ FINISH</button>
      </div>

      <Card title="JANOS-SYS/CHRONO" status={restEnd !== null ? "REST" : "SET READY"} flush>
        <Seg7Panel
          id="workout-chrono"
          heat
          rev="CHRONO MOD 2.07"
          caption={restEnd !== null ? "REST REMAINING:" : "ELAPSED WORKOUT TIME:"}
          value={restEnd !== null ? formatMinSec(Math.max(0, (restEnd - now) / 1000)).padStart(5, "0") : elapsedText(elapsed)}
          state={restEnd !== null ? { text: "● ACTIVE", tone: "red", blink: 2 } : { text: "○ STANDBY", tone: "or" }}
          tone={restEnd !== null && restEnd - now < 10000 ? "red" : "am"}
          sub={`${restEnd !== null ? `ELAPSED ${elapsedText(elapsed)} · ` : ""}SETS ${pad(sets.filter((x) => x.kind === "working").length)} · REST ${pad(settings.restSeconds, 3)} S`}
          srText={restEnd !== null ? `Rest ${Math.max(0, Math.round((restEnd - now) / 1000))} seconds left.` : `Workout time ${elapsedText(elapsed)}.`}
        />
        {restEnd !== null ? (
          <div className="rowbar" role="timer">
            <button className="btn sm plain" onClick={() => setRestEnd(restEnd + 30000)}>+30 S</button>
            <div className="grow" />
            <button className="btn sm plain" onClick={() => setRestEnd(null)}>SKIP REST</button>
          </div>
        ) : null}
      </Card>

      <div className="ex-nav">
        {w.exerciseIds.map((id) => {
          const done = sets.some((s) => s.exerciseId === id);
          return (
            <button key={id} className={[id === current ? "on" : "", done ? "done" : ""].join(" ")} aria-pressed={id === current} onClick={() => setCurrent(id)}>
              {done ? "■ " : "□ "}
              <span className="uc">{exMap.get(id)?.name ?? "…"}</span>
            </button>
          );
        })}
        <button onClick={() => setPicking(true)}>[+] EXERCISE</button>
      </div>

      {ex ? (
        <ExerciseCard
          key={ex.id}
          exercise={ex}
          workoutId={w.id}
          sets={sets.filter((s) => s.exerciseId === ex.id)}
          onSetDone={() => setRestEnd(Date.now() + settings.restSeconds * 1000)}
        />
      ) : (
        <div className="empty">
          <button className="btn" onClick={() => setPicking(true)}>[+] ADD AN EXERCISE</button>
        </div>
      )}

      {picking ? <ExercisePicker exercises={exercises.filter((e) => !e.archived)} onPick={addExercise} onClose={() => setPicking(false)} /> : null}
      {finishing ? (
        <FinishSheet
          workout={w}
          setCount={sets.length}
          onClose={() => setFinishing(false)}
          onDone={(msg) => {
            setFinishing(false);
            toast(msg);
          }}
        />
      ) : null}
    </div>
  );
}

function elapsedText(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const x = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
}

const RECORD_LABEL: Record<RecordHit["kind"], string> = {
  heaviest: "HEAVIEST",
  e1rm: "EST 1RM",
  setVolume: "SET VOLUME",
  repsAtLoad: "REPS AT LOAD",
  sessionVolume: "SESSION VOLUME",
};
const recordText = (r: RecordHit) => `${RECORD_LABEL[r.kind]} ${fmt(r.value)}${r.previous !== null ? ` (WAS ${fmt(r.previous)})` : ""}`;
const assisted = (e: Exercise) => /assist/i.test(e.name);

function adviceText(a: ProgressionAdvice): string {
  switch (a.kind) {
    case "increaseLoad":
      return `▲ GO UP · ${fmt(a.load)} × ${a.repMin}–${a.repMax}`;
    case "addReps":
      return `SAME WEIGHT · AIM FOR ${a.targetReps} REPS AT ${fmt(a.load)}`;
    case "repeatLoad":
      return `REPEAT ${fmt(a.load)}`;
    case "reduceLoad":
      return `▼ DROP TO ${fmt(a.load)}`;
    default:
      return "FIRST SESSION · PICK A WEIGHT FOR 10–12 REPS WITH 1–2 IN RESERVE";
  }
}

function ExerciseCard(props: { exercise: Exercise; workoutId: string; sets: StrengthSet[]; onSetDone: () => void }) {
  const { toast } = useUI();
  const ex = props.exercise;
  const history = useLive(() => exerciseHistory(ex.id, props.workoutId), [ex.id, props.workoutId], [] as ExerciseSession[]);
  const loads = useMemo(() => exerciseLoads(ex), [ex]);
  const sessions = history.map((h) => workingSets(h.sets)).filter((s) => s.length);
  const { advice, why } = adviseProgression(sessions, loads, { repMin: ex.repMin, repMax: ex.repMax, targetRIR: ex.targetRIR, maxJumpFraction: 0.1 });
  const last = history.at(-1);
  const [showWhy, setShowWhy] = useState(false);

  const firstTarget = (): { load: number; reps: number } => {
    switch (advice.kind) {
      case "increaseLoad":
        return { load: advice.load, reps: advice.repMin };
      case "addReps":
        return { load: advice.load, reps: Math.min(advice.targetReps, ex.repMax + 2) };
      case "repeatLoad":
      case "reduceLoad": {
        const reps = last ? Math.max(...workingSets(last.sets).map((s) => s.reps)) : ex.repMin;
        return { load: advice.load, reps: advice.kind === "reduceLoad" ? ex.repMin : reps };
      }
      default:
        return { load: loads[Math.min(2, loads.length - 1)] ?? 10, reps: ex.repMin };
    }
  };

  const lastSet = props.sets.at(-1);
  const [load, setLoad] = useState<number>(() => (lastSet ? lastSet.load : firstTarget().load));
  const [reps, setReps] = useState<number>(() => (lastSet ? lastSet.reps : firstTarget().reps));
  const [rir, setRir] = useState<number | null>(ex.targetRIR);
  const [warmup, setWarmup] = useState(false);
  const [initialised, setInitialised] = useState(!!lastSet || history.length > 0);

  // History loads asynchronously: once it arrives, pre-fill the first set with the suggestion.
  useEffect(() => {
    if (!initialised && !props.sets.length && history.length) {
      const t = firstTarget();
      setLoad(t.load);
      setReps(t.reps);
      setInitialised(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length]);

  const workingCount = props.sets.filter((s) => s.kind === "working").length;

  const [records, setRecords] = useState<Record<string, RecordHit[]>>({});
  const done = async () => {
    const saved = await logSet({
      workoutId: props.workoutId,
      exerciseId: ex.id,
      index: warmup ? 0 : workingCount + 1,
      kind: warmup ? "warmup" : "working",
      load,
      reps,
      rir: warmup ? null : rir,
    });
    setWarmup(false);
    props.onSetDone();
    if (!warmup && !assisted(ex)) {
      const hits = detectRecords(history.flatMap((h) => h.sets as SetLite[]), saved, [...props.sets, saved]);
      if (hits.length) {
        setRecords((r) => ({ ...r, [saved.id]: hits }));
        toast(`>> 092 NEW RECORD · ${hits.map(recordText).join(" · ")}`);
      }
    }
  };

  return (
    <>
      <Card title="EXERCISE" aside={`TARGET ${ex.repMin}–${ex.repMax} · ${ex.targetRIR} RIR`}>
        <div className="ex-title uc">{ex.name}</div>
        {ex.machineLabel ? <div className="muted small uc">{ex.machineLabel}</div> : null}
        {ex.setupNote ? <div className="muted small uc">{ex.setupNote}</div> : null}
        <div style={{ marginTop: 8 }} className="small">
          <span className="muted">LAST SESSION </span>
          <span className="num">{last ? workingSets(last.sets).map((s) => `${fmt(s.load)}×${s.reps}`).join(", ") : "—"}</span>
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pill accent">{adviceText(advice)}</span>
          <button className="link small" onClick={() => setShowWhy(!showWhy)}>{showWhy ? "HIDE" : "WHY?"}</button>
        </div>
        {showWhy ? <div className="desc">{why}</div> : null}
      </Card>

      {Object.keys(records).length ? (
        <div className="notice ok" role="status">
          <span className="msg">092 NEW RECORD</span>
          <span className="act">{Object.values(records).flat().map(recordText).join(" · ")}</span>
        </div>
      ) : null}
      {props.sets.length ? (
        <Card title="SETS" aside={`${props.sets.length} LOGGED`}>
          {props.sets.map((s) => (
            <div className="set-line" key={s.id}>
              <span className="idx">{s.kind === "warmup" ? "W" : s.index}</span>
              <span>
                {fmt(s.load)} × {s.reps}
                <span className="muted small">{s.rir !== null ? `  ${s.rir} RIR` : ""}</span>
                {records[s.id] ? <span className="rec"> ▲ RECORD</span> : null}
              </span>
              <button
                className="link danger"
                onClick={async () => {
                  await del("sets", s.id);
                  toast("PROC 093 ENTRY DELETED", () => void put("sets", s));
                }}
              >
                DEL
              </button>
            </div>
          ))}
        </Card>
      ) : null}

      <Card title={warmup ? "WARM-UP SET" : `SET ${String(workingCount + 1).padStart(2, "0")}`} aside="INPUT">
        <div className="field" style={{ marginBottom: 4 }}>
          <span>WEIGHT ({ex.equipment === "dumbbell" ? "PER DUMBBELL" : "LB"})</span>
        </div>
        <Stepper value={load} onChange={setLoad} values={loads} label="weight" />
        <div className="field" style={{ margin: "12px 0 4px" }}>
          <span>REPS · TARGET {ex.repMin}–{ex.repMax}</span>
        </div>
        <Stepper value={reps} onChange={setReps} step={1} min={0} label="reps" />
        <div className="field" style={{ margin: "12px 0 4px" }}>
          <span>REPS IN RESERVE</span>
        </div>
        <Chips
          options={[0, 1, 2, 3, 4].map((v) => ({ value: v, label: v === 4 ? "4+" : String(v) }))}
          value={rir}
          onChange={setRir}
          allowNone
        />
        <div style={{ height: 14 }} />
        <button className="btn block xl" onClick={done}>■ DONE SET</button>
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button className="link small" onClick={() => setWarmup(!warmup)}>{warmup ? "LOG AS A WORKING SET INSTEAD" : "THIS IS A WARM-UP SET"}</button>
        </div>
      </Card>
    </>
  );
}

function FinishSheet(props: { workout: Workout; setCount: number; onClose: () => void; onDone: (msg: string) => void }) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  return (
    <Sheet
      title="FINISH WORKOUT"
      onClose={props.onClose}
      footer={
        <div className="grid-2">
          <button
            className="btn danger"
            onClick={async () => {
              const ok = await confirmScreen({
                title: "DISCARD WORKOUT",
                message: "DISCARD THIS WORKOUT AND ITS SETS? THIS CANNOT BE UNDONE.",
                confirmLabel: "DISCARD",
                danger: true,
              });
              if (!ok) return;
              await deleteWorkout(props.workout.id);
              props.onDone("PROC 090 WORKOUT DISCARDED");
            }}
          >
            DISCARD
          </button>
          <button
            className="btn"
            onClick={async () => {
              await finishWorkout(props.workout, rpe, notes.trim() || undefined);
              props.onDone(props.setCount ? ">> 091 WORKOUT SAVED" : "EMPTY WORKOUT REMOVED");
            }}
          >
            SAVE
          </button>
        </div>
      }
    >
      <Field label="SESSION EFFORT · 1 VERY EASY · 10 MAXIMAL">
        <Chips options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: String(v) }))} value={rpe} onChange={setRpe} allowNone />
      </Field>
      <Field label="NOTES (OPTIONAL)">
        <textarea className="input" rows={3} value={notes} onChange={(e: any) => setNotes(e.target.value)} />
      </Field>
      <div className="desc">
        <b>{props.setCount}</b> SETS LOGGED.
      </div>
    </Sheet>
  );
}

const GROUP_ORDER: Exercise["group"][] = ["push", "pull", "legs", "arms", "core", "other"];
const GROUP_LABEL: Record<Exercise["group"], string> = {
  push: "PUSH · CHEST, SHOULDERS",
  pull: "PULL · BACK, REAR DELTS",
  legs: "LEGS · GLUTES, CALVES",
  arms: "ARMS",
  core: "CORE",
  other: "OTHER",
};

/** Search index for an exercise: its name, machine label, group, equipment and the muscles it works. */
const exerciseHay = (e: Exercise) => {
  const m = musclesFor(e.name, e.group);
  return buildHay({ name: e.name, brand: e.machineLabel, category: `${e.group} ${e.equipment}`, aliases: [...m.primary, ...m.secondary] });
};

/** Exercise list: ranked matches while searching, otherwise grouped by body area. */
function ExerciseRows(props: { exercises: Exercise[]; query: string; onPick: (e: Exercise) => void; detail?: (e: Exercise) => ReactNode }) {
  const q = props.query.trim();
  const row = (e: Exercise) => (
    <button className="row" key={e.id} onClick={() => props.onPick(e)}>
      <div className="grow">
        <div className="name uc" style={e.archived ? { color: "var(--gry)" } : undefined}>{e.name}</div>
        {props.detail ? <div className="muted small">{props.detail(e)}</div> : e.machineLabel ? <div className="muted small uc">{e.machineLabel}</div> : null}
      </div>
      <span className="go">►</span>
    </button>
  );
  if (q) {
    const hits = rank(props.exercises, exerciseHay, q, 80);
    return hits.length ? <>{hits.map(row)}</> : <div className="empty">NO MATCH · TRY A MUSCLE (TRICEPS) OR A MACHINE (CABLE).</div>;
  }
  return (
    <>
      {GROUP_ORDER.flatMap((g) => {
        const list = props.exercises.filter((e) => e.group === g);
        return list.length ? [<div className="subhead" key={`h-${g}`}>{GROUP_LABEL[g]} · {list.length}</div>, ...list.map(row)] : [];
      })}
    </>
  );
}

function ExercisePicker(props: { exercises: Exercise[]; onPick: (e: Exercise) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<Exercise | null>(null);
  if (creating) return <ExerciseEditor exercise={creating} onClose={() => setCreating(null)} onSaved={props.onPick} />;
  return (
    <Sheet title="ADD EXERCISE" onClose={props.onClose}>
      <input className="input" placeholder="SEARCH · E.G. REVERSE CURL, TRICEPS, CABLE" aria-label="search exercises" autoComplete="off" value={q} onChange={(e: any) => setQ(e.target.value)} />
      <div style={{ height: 12 }} />
      <Card title="LIBRARY" aside={`${props.exercises.length}`} flush>
        <ExerciseRows exercises={props.exercises} query={q} onPick={props.onPick} />
      </Card>
      <div style={{ height: 10 }} />
      <button className="btn secondary block" onClick={() => setCreating(newExercise(q))}>[+] NEW EXERCISE</button>
    </Sheet>
  );
}

const newExercise = (name = ""): Exercise => ({
  id: uid(),
  name,
  equipment: "machine",
  group: "other",
  loads: { min: 10, max: 300, step: 10 },
  repMin: 8,
  repMax: 12,
  targetRIR: 1,
});

function ExerciseLibrary(props: { exercises: Exercise[]; onClose: () => void; onEdit: (e: Exercise) => void }) {
  const [q, setQ] = useState("");
  return (
    <Sheet title="EXERCISES" onClose={props.onClose} right={<button className="link" onClick={() => props.onEdit(newExercise())}>[+] NEW</button>}>
      <input className="input" placeholder="SEARCH EXERCISES" aria-label="search exercises" autoComplete="off" value={q} onChange={(e: any) => setQ(e.target.value)} />
      <div className="desc" style={{ margin: "8px 0 12px" }}>EACH MACHINE KEEPS ITS OWN HISTORY: TWO DIFFERENT CHEST PRESS MACHINES = TWO EXERCISES.</div>
      <Card title="LIBRARY" aside={`${props.exercises.length}`} flush>
        <ExerciseRows
          exercises={props.exercises}
          query={q}
          onPick={props.onEdit}
          detail={(e) => (
            <>
              {e.machineLabel ? <span className="uc">{e.machineLabel} · </span> : null}
              {e.loads.min}–{e.loads.max} BY {e.loads.step} · {e.repMin}–{e.repMax} REPS
              {e.archived ? " · HIDDEN" : ""}
            </>
          )}
        />
      </Card>
    </Sheet>
  );
}

function ExerciseEditor(props: { exercise: Exercise; onClose: () => void; onSaved?: (e: Exercise) => void }) {
  const [e, setE] = useState<Exercise>(props.exercise);
  const setL = (k: "min" | "max" | "step", v: number | null) => v !== null && setE({ ...e, loads: { ...e.loads, [k]: v } });
  return (
    <Sheet
      title={props.exercise.name ? "EDIT EXERCISE" : "NEW EXERCISE"}
      onClose={props.onClose}
      footer={
        <button
          className="btn block xl"
          disabled={!e.name.trim() || e.loads.step <= 0 || e.repMin > e.repMax}
          onClick={async () => {
            const saved = { ...e, name: e.name.trim() };
            await put("exercises", saved);
            props.onSaved?.(saved);
            props.onClose();
          }}
        >
          SAVE
        </button>
      }
    >
      <Field label="NAME"><input className="input" value={e.name} onChange={(ev: any) => setE({ ...e, name: ev.target.value })} /></Field>
      <Field label="WHICH MACHINE (OPTIONAL · E.G. MATRIX, BY THE WINDOW)">
        <input className="input" value={e.machineLabel ?? ""} onChange={(ev: any) => setE({ ...e, machineLabel: ev.target.value || undefined })} />
      </Field>
      <Field label="EQUIPMENT">
        <Chips
          options={(["machine", "cable", "dumbbell", "smith", "barbell", "bodyweight", "other"] as const).map((v) => ({ value: v, label: v }))}
          value={e.equipment}
          onChange={(v) => v && setE({ ...e, equipment: v })}
        />
      </Field>
      <h2>WEIGHTS ON THIS MACHINE</h2>
      <div className="grid-3">
        <Field label="LIGHTEST"><NumInput value={e.loads.min} onChange={(v) => setL("min", v)} /></Field>
        <Field label="HEAVIEST"><NumInput value={e.loads.max} onChange={(v) => setL("max", v)} /></Field>
        <Field label="STEP"><NumInput value={e.loads.step} onChange={(v) => setL("step", v)} /></Field>
      </div>
      <h2>TARGETS</h2>
      <div className="grid-3">
        <Field label="MIN REPS"><NumInput value={e.repMin} onChange={(v) => v && setE({ ...e, repMin: v })} decimals={false} /></Field>
        <Field label="MAX REPS"><NumInput value={e.repMax} onChange={(v) => v && setE({ ...e, repMax: v })} decimals={false} /></Field>
        <Field label="RIR"><NumInput value={e.targetRIR} onChange={(v) => v !== null && setE({ ...e, targetRIR: v })} decimals={false} /></Field>
      </div>
      <Field label="SETUP NOTE (SEAT HEIGHT, GRIP…)">
        <input className="input" value={e.setupNote ?? ""} onChange={(ev: any) => setE({ ...e, setupNote: ev.target.value || undefined })} />
      </Field>
      <button className="btn plain block" onClick={() => setE({ ...e, archived: !e.archived })}>
        {e.archived ? "SHOW IN LISTS AGAIN" : "HIDE FROM LISTS"}
      </button>
    </Sheet>
  );
}

function TemplateEditor(props: { template: Template; exercises: Exercise[]; onClose: () => void }) {
  const [t, setT] = useState<Template>(props.template);
  const [adding, setAdding] = useState(false);
  const names = new Map(props.exercises.map((e) => [e.id, e.name]));
  const move = (i: number, d: -1 | 1) => {
    const ids = [...t.exerciseIds];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setT({ ...t, exerciseIds: ids });
  };
  if (adding) {
    return (
      <ExercisePicker
        exercises={props.exercises.filter((e) => !e.archived)}
        onClose={() => setAdding(false)}
        onPick={(e) => {
          setT({ ...t, exerciseIds: t.exerciseIds.includes(e.id) ? t.exerciseIds : [...t.exerciseIds, e.id] });
          setAdding(false);
        }}
      />
    );
  }
  return (
    <Sheet
      title="TEMPLATE"
      onClose={props.onClose}
      footer={
        <div className="grid-2">
          <button
            className="btn danger"
            onClick={async () => {
              const ok = await confirmScreen({
                title: "DELETE TEMPLATE",
                message: `DELETE TEMPLATE "${t.name}"? PAST WORKOUTS ARE KEPT.`,
                confirmLabel: "DELETE",
                danger: true,
                alarm: false,
              });
              if (!ok) return;
              await del("templates", t.id);
              props.onClose();
            }}
          >
            DELETE
          </button>
          <button
            className="btn"
            disabled={!t.name.trim()}
            onClick={async () => {
              await put("templates", { ...t, name: t.name.trim() });
              props.onClose();
            }}
          >
            SAVE
          </button>
        </div>
      }
    >
      <Field label="NAME"><input className="input" value={t.name} onChange={(e: any) => setT({ ...t, name: e.target.value })} /></Field>
      <Card title="SEQUENCE" aside={`${t.exerciseIds.length} EXERCISES`} flush>
        {t.exerciseIds.length === 0 ? <div className="empty">NO EXERCISES YET.</div> : null}
        {t.exerciseIds.map((id, i) => (
          <div className="row" key={id}>
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <div className="grow name uc">{names.get(id) ?? "?"}</div>
            <button className="icon-btn" aria-label="move up" onClick={() => move(i, -1)}>▲</button>
            <button className="icon-btn" aria-label="move down" onClick={() => move(i, 1)}>▼</button>
            <button className="icon-btn" aria-label="remove" onClick={() => setT({ ...t, exerciseIds: t.exerciseIds.filter((x) => x !== id) })}>X</button>
          </div>
        ))}
      </Card>
      <button className="btn secondary block" onClick={() => setAdding(true)}>[+] ADD EXERCISE</button>
    </Sheet>
  );
}

// ---- cardio -----------------------------------------------------------------------

export const MODALITIES: { value: CardioModality; label: string }[] = [
  { value: "treadmill-run", label: "Treadmill run" },
  { value: "incline-walk", label: "Incline walk" },
  { value: "outdoor-run", label: "Outdoor run" },
  { value: "walk", label: "Walk" },
  { value: "stationary-bike", label: "Stationary bike" },
  { value: "outdoor-bike", label: "Outdoor ride" },
  { value: "elliptical", label: "Elliptical" },
  { value: "stair-climber", label: "Stair climber" },
  { value: "rower", label: "Rower" },
  { value: "hike", label: "Hike" },
  { value: "other", label: "Other" },
];

export const SESSION_TYPES: { value: CardioType; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "zone2", label: "Zone 2" },
  { value: "recovery", label: "Recovery" },
  { value: "long", label: "Long" },
  { value: "tempo", label: "Tempo" },
  { value: "threshold", label: "Threshold" },
  { value: "intervals", label: "Intervals" },
  { value: "vo2", label: "VO2 max" },
  { value: "sprints", label: "Sprints" },
  { value: "hills", label: "Hills" },
  { value: "mixed", label: "Mixed" },
  { value: "test", label: "Test" },
  { value: "recreational", label: "Just for fun" },
];

const modalityLabel = (m: CardioModality) => MODALITIES.find((x) => x.value === m)?.label ?? m;
const typeLabel = (t: CardioType) => SESSION_TYPES.find((x) => x.value === t)?.label ?? t;

function startOfIsoWeek(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d.getTime();
}

/** Fitness (CTL 42 d), fatigue (ATL 7 d), form (TSB) and the acute:chronic load ratio. */
function LoadCard() {
  const { settings } = useUI();
  const m = useLive(() => loadLoadModel(settings), [settings], null as LoadModel | null);
  if (!m) return null;
  const t = m.today;
  const series = m.series.slice(-90);
  const x = (d: string) => Date.parse(`${d}T12:00:00`);
  const f = m.focus28;
  const tot = f.lowMin + f.highMin + f.anaerobicMin;
  return (
    <>
      <Card
        title="JANOS-SYS/LOAD"
        status={t?.ratio != null ? `RATIO ${t.ratio.toFixed(2)} ${m.band.toUpperCase().replace("-", " ")}` : "NO RATIO YET"}
        flush
        help="LOAD = GARMIN TRAINING LOAD (EPOC) FOR WATCH-RECORDED ACTIVITIES; SESSIONS WITHOUT THE WATCH ARE ESTIMATED FROM HEART RATE OR EFFORT × MINUTES (RED DOTS). RATIO = 7-DAY ÷ 28-DAY LOAD: 0.8–1.4 IS THE USUAL SAFE BUILD ZONE, ≥1.5 IS A SPIKE. FORM BELOW −30 MEANS DEEP FATIGUE."
      >
        <PlotPanel
          id="cardio-load"
          rev="LOAD MON 1.2"
          lines={[
            { pts: series.map((d) => ({ x: x(d.day), y: d.ctl })), tone: "wht", width: 2 },
            { pts: series.map((d) => ({ x: x(d.day), y: d.atl })), tone: "am" },
          ]}
          dots={series.filter((d) => d.load > 0).map((d) => ({ x: x(d.day), y: d.load, flag: d.estimated }))}
          yFormat={(v) => String(Math.round(v))}
          legend="— FITNESS 42 D  — FATIGUE 7 D  ■ DAY LOAD"
          empty="NO LOAD DATA"
          stamp={t?.ratio != null && t.ratio >= 1.5 ? { text: "LOAD SPIKE", tone: "red", blink: true } : undefined}
          srText={t ? `Fitness ${Math.round(t.ctl)}, fatigue ${Math.round(t.atl)}, form ${Math.round(t.tsb)}.` : "No load data."}
        />
        {t ? (
          <div className="card-body">
            <div className="grid-3">
              <Stat label="FITNESS" value={pad(t.ctl, 3)} />
              <Stat label="FATIGUE" value={pad(t.atl, 3)} />
              <Stat label="FORM" value={signed(t.tsb)} sub={t.tsb < -30 ? "HEAVY FATIGUE" : t.tsb < -10 ? "PRODUCTIVE" : t.tsb > 15 ? "FRESH" : "NEUTRAL"} />
            </div>
          </div>
        ) : null}
      </Card>
      {tot > 0 ? (
        <Card title="JANOS-SYS/INTENSITY" status="HR ZONES · 28 D" flush help="MOST ENDURANCE PLANS KEEP ROUGHLY 75–80 % OF TIME IN ZONES 1–2.">
          <MeterPanel
            id="cardio-focus"
            rev="ZONE MOD 1.0"
            scale={[
              { f: 0, label: "0" },
              { f: 0.5, label: "50%" },
              { f: 1, label: "100%" },
            ]}
            rows={[
              { id2: "01", name: "LOW", value: f.lowMin, max: tot, line: `LOW AEROBIC Z1-2 · ${pad(f.lowMin, 3)} MIN`, right: `${pad((f.lowMin / tot) * 100, 3)}%`, tone: "bands" },
              { id2: "02", name: "HIGH", value: f.highMin, max: tot, line: `HIGH AEROBIC Z3-4 · ${pad(f.highMin, 3)} MIN`, right: `${pad((f.highMin / tot) * 100, 3)}%`, tone: "bands" },
              { id2: "03", name: "ANAER", value: f.anaerobicMin, max: tot, line: `ANAEROBIC Z5 · ${pad(f.anaerobicMin, 3)} MIN`, right: `${pad((f.anaerobicMin / tot) * 100, 3)}%`, tone: "bands" },
            ]}
            srText={`Last 28 days: ${Math.round(f.lowMin)} min low aerobic, ${Math.round(f.highMin)} min high aerobic, ${Math.round(f.anaerobicMin)} min anaerobic.`}
          />
        </Card>
      ) : null}
    </>
  );
}

function CardioHome() {
  const { settings, open } = useUI();
  const sessions = useLive(listCardio, [], [] as CardioSession[]);
  const weekStart = startOfIsoWeek(Date.now());
  const bars = Array.from({ length: 8 }, (_, i) => {
    const start = weekStart - (7 - i) * 7 * 86400000;
    const end = start + 7 * 86400000;
    const min = sessions.filter((s) => s.start >= start && s.start < end).reduce((a, s) => a + s.minutes, 0);
    const d = new Date(start);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: min };
  });
  return (
    <>
      <div style={{ height: 8 }} />
      <button className="btn block xl" onClick={() => open({ kind: "cardio" })}>[+] LOG CARDIO</button>
      <div style={{ height: 12 }} />
      <Card title="JANOS-SYS/CARDIO" status="MIN / WEEK · 8 WK" flush>
        <BarsPanel id="cardio-weeks" rev="CARDIO MOD 1.4" bars={bars.map((b, i) => ({ ...b, tone: i === bars.length - 1 ? "wht" : undefined }))} target={{ value: 150, label: "150 MIN" }} empty="NO CARDIO YET" />
      </Card>
      <LoadCard />
      <Card title="SESSIONS" aside={sessions.length ? `${sessions.length} FILED` : null} flush>
        {sessions.length === 0 ? <div className="empty">NO RECORDS YET. GARMIN CARDIO IS FILED HERE AUTOMATICALLY.</div> : null}
        {sessions.slice(0, 30).map((s) => (
          <button className="row" key={s.id} onClick={() => open({ kind: "cardio", id: s.id })}>
            <div className="grow">
              <div className="name">
                {modalityLabel(s.modality)} · {typeLabel(s.sessionType)}
              </div>
              <div className="muted small">
                {shortDateTime(s.start)} · {s.minutes} MIN
                {s.distanceKm ? ` · ${fmt(distToDisplay(s.distanceKm, settings), 2)} ${settings.distanceUnit}` : ""}
                {s.avgHR ? ` · ${s.avgHR} BPM` : ""}
                {s.rpe ? ` · EFFORT ${s.rpe}/10` : ""}
                {s.source === "garmin" ? <span className="blu"> · GARMIN</span> : null}
              </div>
            </div>
            <span className="go">►</span>
          </button>
        ))}
      </Card>
    </>
  );
}

export function CardioSheet(props: { id?: string }) {
  const { settings, close, toast } = useUI();
  const [s, setS] = useState<CardioSession>({
    id: uid(),
    start: Date.now(),
    minutes: 30,
    modality: "treadmill-run",
    sessionType: "easy",
    rpe: null,
  });
  const [minutes, setMinutes] = useState<number | null>(30);
  const [dist, setDist] = useState<number | null>(null);
  useEffect(() => {
    if (!props.id) return;
    get<CardioSession>("cardio", props.id).then((x) => {
      if (!x) return;
      setS(x);
      setMinutes(x.minutes);
      setDist(x.distanceKm ? Math.round(distToDisplay(x.distanceKm, settings) * 100) / 100 : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);
  const save = async () => {
    await put("cardio", {
      ...s,
      minutes: minutes ?? 0,
      distanceKm: dist === null ? null : distFromDisplay(dist, settings),
      source: s.source ?? "manual",
      editedByUser: s.source === "garmin" ? true : s.editedByUser,
    });
    toast("CARDIO SAVED");
    close();
  };
  const remove = async () => {
    if (s.source === "garmin") await put("cardio", { ...s, hidden: true, editedByUser: true });
    else await del("cardio", s.id);
    toast("PROC 093 ENTRY DELETED", () => void put("cardio", s));
    close();
  };
  return (
    <Sheet
      title={props.id ? "EDIT CARDIO" : "LOG CARDIO"}
      status={s.source === "garmin" ? <span className="blu">GARMIN</span> : null}
      onClose={close}
      footer={
        props.id ? (
          <div className="grid-2">
            <button className="btn danger" onClick={remove}>
              DELETE
            </button>
            <button className="btn" disabled={!minutes} onClick={save}>SAVE</button>
          </div>
        ) : (
          <button className="btn block xl" disabled={!minutes} onClick={save}>SAVE</button>
        )
      }
    >
      <Field label="WHAT">
        <Chips options={MODALITIES} value={s.modality} onChange={(v) => v && setS({ ...s, modality: v })} />
      </Field>
      <Field label="KIND OF SESSION">
        <Chips options={SESSION_TYPES} value={s.sessionType} onChange={(v) => v && setS({ ...s, sessionType: v })} />
      </Field>
      <div className="grid-2">
        <Field label="MINUTES"><NumInput value={minutes} onChange={setMinutes} decimals={false} ariaLabel="minutes" /></Field>
        <Field label={`DISTANCE (${settings.distanceUnit} · OPT)`}><NumInput value={dist} onChange={setDist} /></Field>
        <Field label="AVERAGE HR (OPT)"><NumInput value={s.avgHR ?? null} onChange={(v) => setS({ ...s, avgHR: v })} decimals={false} /></Field>
        <Field label="MAX HR (OPT)"><NumInput value={s.maxHR ?? null} onChange={(v) => setS({ ...s, maxHR: v })} decimals={false} /></Field>
      </div>
      <Field label="EFFORT · 1 VERY EASY · 10 MAXIMAL">
        <Chips options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: String(v) }))} value={s.rpe ?? null} onChange={(v) => setS({ ...s, rpe: v })} allowNone />
      </Field>
      <Field label="STARTED">
        <input className="input" type="datetime-local" value={toLocalInputValue(s.start)} onChange={(e: any) => e.target.value && setS({ ...s, start: new Date(e.target.value).getTime() })} />
      </Field>
      <Field label="MACHINE OR ROUTE (OPTIONAL)">
        <input className="input" value={s.machine ?? ""} onChange={(e: any) => setS({ ...s, machine: e.target.value || undefined })} />
      </Field>
      <Field label="NOTES (OPTIONAL)">
        <input className="input" value={s.notes ?? ""} onChange={(e: any) => setS({ ...s, notes: e.target.value || undefined })} />
      </Field>
    </Sheet>
  );
}
