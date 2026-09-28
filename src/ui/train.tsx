// Training tab: strength (templates, live workout logger, history, exercise editor) and cardio.

import { useEffect, useMemo, useState } from "react";
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
import type { CardioModality, CardioSession, CardioType, Exercise, StrengthSet, Template, Workout } from "../db/types";
import { adviseProgression, e1RM, type ProgressionAdvice } from "../engine/strength";
import { fmt, formatMinSec } from "../engine/units";
import { distFromDisplay, distToDisplay, shortDateTime, toLocalInputValue } from "./format";
import { BarChart, Card, Chips, Field, NumInput, Segmented, Sheet, Stepper, useUI } from "./kit";

export function TrainScreen() {
  const [mode, setMode] = useState<"strength" | "cardio">("strength");
  const active = useLive(activeWorkout, [], null as Workout | null);
  if (active && mode === "strength") return <WorkoutView workout={active} />;
  return (
    <div className="page">
      <div className="page-title">
        <h1>Train</h1>
      </div>
      <Segmented options={[{ value: "strength", label: "Strength" }, { value: "cardio", label: "Cardio" }]} value={mode} onChange={setMode} />
      <div style={{ height: 8 }} />
      {mode === "strength" ? <StrengthHome /> : <CardioHome />}
    </div>
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
      <h2>Start a workout</h2>
      {templates.map((t) => (
        <Card key={t.id}>
          <div className="card-head">
            <div className="title" style={{ fontSize: 18 }}>{t.name}</div>
            <button className="link" onClick={() => setEditTpl(t)}>Edit</button>
          </div>
          <div className="muted small" style={{ marginBottom: 10 }}>
            {t.exerciseIds.map((id) => names.get(id) ?? "?").join(" · ")}
          </div>
          <button className="btn block" onClick={() => startWorkout(t)}>Start {t.name}</button>
        </Card>
      ))}
      <div className="grid-2">
        <button className="btn plain" onClick={() => startWorkout()}>Empty workout</button>
        <button className="btn plain" onClick={() => setEditTpl({ id: uid(), name: "New template", exerciseIds: [], setsPerExercise: 3 })}>New template</button>
      </div>
      <div style={{ height: 8 }} />
      <button className="btn plain block" onClick={() => setShowLibrary(true)}>Exercises and machines</button>

      <h2>History</h2>
      <div className="card tight">
        {workouts.length === 0 ? <div className="empty">Finished workouts appear here.</div> : null}
        {workouts.slice(0, 20).map((w) => (
          <button className="row" key={w.id} onClick={() => setDetail(w)}>
            <div className="grow">
              <div className="name">{w.name}</div>
              <div className="muted small">
                {shortDateTime(w.start)}
                {w.end ? ` · ${Math.round((w.end - w.start) / 60000)} min` : ""}
                {w.sessionRPE ? ` · effort ${w.sessionRPE}/10` : ""}
              </div>
            </div>
            <span className="muted">›</span>
          </button>
        ))}
      </div>

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

function WorkoutDetail(props: { workout: Workout; names: Map<string, string>; onClose: () => void }) {
  const { toast } = useUI();
  const sets = useLive(() => setsForWorkout(props.workout.id), [props.workout.id], [] as StrengthSet[]);
  const byEx = new Map<string, StrengthSet[]>();
  for (const s of sets) byEx.set(s.exerciseId, [...(byEx.get(s.exerciseId) ?? []), s]);
  return (
    <Sheet
      title={props.workout.name}
      onClose={props.onClose}
      footer={
        <button
          className="btn danger block"
          onClick={async () => {
            if (!confirm("Delete this workout and all its sets?")) return;
            await deleteWorkout(props.workout.id);
            toast("Workout deleted");
            props.onClose();
          }}
        >
          Delete workout
        </button>
      }
    >
      <div className="muted small" style={{ marginBottom: 10 }}>{shortDateTime(props.workout.start)}</div>
      {[...byEx.entries()].map(([exId, list]) => (
        <Card key={exId} title={props.names.get(exId) ?? "Exercise"}>
          {list.map((s) => (
            <div className="set-line" key={s.id}>
              <span className="idx">{s.kind === "warmup" ? "W" : s.index}</span>
              <span>{fmt(s.load)} × {s.reps}{s.rir !== null ? ` @ ${s.rir} RIR` : ""}</span>
              <span className="muted small">e1RM {fmt(e1RM(s.load, s.reps, s.rir ?? 0), 0)}</span>
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
      <div className="page-title">
        <div>
          <h1 style={{ fontSize: 24 }}>{w.name}</h1>
          <div className="sub num">{formatMinSec(elapsed)} elapsed · {sets.length} {sets.length === 1 ? "set" : "sets"}</div>
        </div>
        <button className="btn sm" onClick={() => setFinishing(true)}>Finish</button>
      </div>

      {restEnd !== null ? (
        <div className="rest-banner">
          <span>Rest</span>
          <span className="time">{formatMinSec(Math.max(0, (restEnd - now) / 1000))}</span>
          <span>
            <button className="btn sm plain" onClick={() => setRestEnd(restEnd + 30000)}>+30 s</button>{" "}
            <button className="btn sm plain" onClick={() => setRestEnd(null)}>Skip</button>
          </span>
        </div>
      ) : null}

      <div className="ex-nav">
        {w.exerciseIds.map((id) => {
          const done = sets.some((s) => s.exerciseId === id);
          return (
            <button key={id} className={[id === current ? "on" : "", done ? "done" : ""].join(" ")} onClick={() => setCurrent(id)}>
              {done ? "✓ " : ""}
              {exMap.get(id)?.name ?? "…"}
            </button>
          );
        })}
        <button onClick={() => setPicking(true)}>+ Exercise</button>
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
          <button className="btn" onClick={() => setPicking(true)}>Add an exercise</button>
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

function adviceText(a: ProgressionAdvice): string {
  switch (a.kind) {
    case "increaseLoad":
      return `Go up: ${fmt(a.load)} × ${a.repMin}–${a.repMax}`;
    case "addReps":
      return `Same weight, aim for ${a.targetReps} reps at ${fmt(a.load)}`;
    case "repeatLoad":
      return `Repeat ${fmt(a.load)}`;
    case "reduceLoad":
      return `Drop to ${fmt(a.load)}`;
    default:
      return "First time: pick a weight you can do 10–12 times with 1–2 reps left";
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

  const done = async () => {
    await logSet({
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
  };

  return (
    <>
      <Card>
        <div style={{ fontWeight: 700, fontSize: 20 }}>{ex.name}</div>
        {ex.machineLabel ? <div className="muted small">{ex.machineLabel}</div> : null}
        {ex.setupNote ? <div className="muted small">{ex.setupNote}</div> : null}
        <div style={{ marginTop: 8 }} className="small">
          <span className="muted">Last time: </span>
          {last ? workingSets(last.sets).map((s) => `${fmt(s.load)}×${s.reps}`).join(", ") : "—"}
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pill accent">{adviceText(advice)}</span>
          <button className="link small" onClick={() => setShowWhy(!showWhy)}>{showWhy ? "Hide" : "Why?"}</button>
        </div>
        {showWhy ? <div className="muted small" style={{ marginTop: 6 }}>{why}</div> : null}
      </Card>

      {props.sets.length ? (
        <Card>
          {props.sets.map((s) => (
            <div className="set-line" key={s.id}>
              <span className="idx">{s.kind === "warmup" ? "W" : s.index}</span>
              <span style={{ fontWeight: 600 }}>
                {fmt(s.load)} × {s.reps}
                <span className="muted small" style={{ fontWeight: 400 }}>{s.rir !== null ? `  ${s.rir} in reserve` : ""}</span>
              </span>
              <button
                className="link small"
                style={{ color: "var(--danger)" }}
                onClick={async () => {
                  await del("sets", s.id);
                  toast("Set deleted", () => void put("sets", s));
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </Card>
      ) : null}

      <Card>
        <div className="small muted" style={{ marginBottom: 6 }}>
          {warmup ? "Warm-up set" : `Set ${workingCount + 1}`} · weight ({ex.equipment === "dumbbell" ? "per dumbbell" : "lb"})
        </div>
        <Stepper value={load} onChange={setLoad} values={loads} label="weight" />
        <div className="small muted" style={{ margin: "12px 0 6px" }}>Reps · target {ex.repMin}–{ex.repMax}</div>
        <Stepper value={reps} onChange={setReps} step={1} min={0} label="reps" />
        <div className="small muted" style={{ margin: "12px 0 6px" }}>Reps left in the tank</div>
        <Chips
          options={[0, 1, 2, 3, 4].map((v) => ({ value: v, label: v === 4 ? "4+" : String(v) }))}
          value={rir}
          onChange={setRir}
          allowNone
        />
        <div style={{ height: 14 }} />
        <button className="btn block xl" onClick={done}>Done set ✓</button>
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <button className="link small" onClick={() => setWarmup(!warmup)}>{warmup ? "Log as a working set instead" : "This is a warm-up set"}</button>
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
      title="Finish workout"
      onClose={props.onClose}
      footer={
        <div className="grid-2">
          <button
            className="btn plain"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              if (!confirm("Discard this workout and its sets?")) return;
              await deleteWorkout(props.workout.id);
              props.onDone("Workout discarded");
            }}
          >
            Discard
          </button>
          <button
            className="btn"
            onClick={async () => {
              await finishWorkout(props.workout, rpe, notes.trim() || undefined);
              props.onDone(props.setCount ? "Workout saved" : "Empty workout removed");
            }}
          >
            Save
          </button>
        </div>
      }
    >
      <Field label="How hard was the whole session? (1 = very easy, 10 = maximal)">
        <Chips options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: String(v) }))} value={rpe} onChange={setRpe} allowNone />
      </Field>
      <Field label="Notes (optional)">
        <textarea className="input" rows={3} value={notes} onChange={(e: any) => setNotes(e.target.value)} />
      </Field>
      <div className="muted small">{props.setCount} sets logged.</div>
    </Sheet>
  );
}

function ExercisePicker(props: { exercises: Exercise[]; onPick: (e: Exercise) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<Exercise | null>(null);
  const shown = props.exercises.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()));
  if (creating) return <ExerciseEditor exercise={creating} onClose={() => setCreating(null)} onSaved={props.onPick} />;
  return (
    <Sheet title="Add exercise" onClose={props.onClose}>
      <input className="input" placeholder="Search" value={q} onChange={(e: any) => setQ(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn secondary block" onClick={() => setCreating(newExercise(q))}>+ New exercise</button>
      <div style={{ height: 10 }} />
      <div className="card tight">
        {shown.map((e) => (
          <button className="row" key={e.id} onClick={() => props.onPick(e)}>
            <div className="grow">
              <div className="name">{e.name}</div>
              {e.machineLabel ? <div className="muted small">{e.machineLabel}</div> : null}
            </div>
          </button>
        ))}
      </div>
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
  return (
    <Sheet title="Exercises" onClose={props.onClose} right={<button className="link" onClick={() => props.onEdit(newExercise())}>New</button>}>
      <div className="muted small" style={{ marginBottom: 10 }}>
        Each machine keeps its own history. If your gym has two different chest press machines, make two exercises.
      </div>
      <div className="card tight">
        {props.exercises.map((e) => (
          <button className="row" key={e.id} onClick={() => props.onEdit(e)}>
            <div className="grow">
              <div className="name" style={e.archived ? { opacity: 0.5 } : undefined}>{e.name}</div>
              <div className="muted small">
                {e.machineLabel ? `${e.machineLabel} · ` : ""}
                {e.loads.min}–{e.loads.max} by {e.loads.step} · {e.repMin}–{e.repMax} reps
                {e.archived ? " · hidden" : ""}
              </div>
            </div>
            <span className="muted">›</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function ExerciseEditor(props: { exercise: Exercise; onClose: () => void; onSaved?: (e: Exercise) => void }) {
  const [e, setE] = useState<Exercise>(props.exercise);
  const setL = (k: "min" | "max" | "step", v: number | null) => v !== null && setE({ ...e, loads: { ...e.loads, [k]: v } });
  return (
    <Sheet
      title={props.exercise.name ? "Edit exercise" : "New exercise"}
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
          Save
        </button>
      }
    >
      <Field label="Name"><input className="input" value={e.name} onChange={(ev: any) => setE({ ...e, name: ev.target.value })} /></Field>
      <Field label="Which machine (optional, e.g. 'Matrix, by the window')">
        <input className="input" value={e.machineLabel ?? ""} onChange={(ev: any) => setE({ ...e, machineLabel: ev.target.value || undefined })} />
      </Field>
      <Field label="Equipment">
        <Chips
          options={(["machine", "cable", "dumbbell", "smith", "barbell", "bodyweight", "other"] as const).map((v) => ({ value: v, label: v }))}
          value={e.equipment}
          onChange={(v) => v && setE({ ...e, equipment: v })}
        />
      </Field>
      <h2>Weights available on this machine</h2>
      <div className="grid-3">
        <Field label="Lightest"><NumInput value={e.loads.min} onChange={(v) => setL("min", v)} /></Field>
        <Field label="Heaviest"><NumInput value={e.loads.max} onChange={(v) => setL("max", v)} /></Field>
        <Field label="Step"><NumInput value={e.loads.step} onChange={(v) => setL("step", v)} /></Field>
      </div>
      <h2>Targets</h2>
      <div className="grid-3">
        <Field label="Min reps"><NumInput value={e.repMin} onChange={(v) => v && setE({ ...e, repMin: v })} decimals={false} /></Field>
        <Field label="Max reps"><NumInput value={e.repMax} onChange={(v) => v && setE({ ...e, repMax: v })} decimals={false} /></Field>
        <Field label="Reps in reserve"><NumInput value={e.targetRIR} onChange={(v) => v !== null && setE({ ...e, targetRIR: v })} decimals={false} /></Field>
      </div>
      <Field label="Setup note (seat height, grip…)">
        <input className="input" value={e.setupNote ?? ""} onChange={(ev: any) => setE({ ...e, setupNote: ev.target.value || undefined })} />
      </Field>
      <button className="btn plain block" onClick={() => setE({ ...e, archived: !e.archived })}>
        {e.archived ? "Show in lists again" : "Hide from lists"}
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
      title="Template"
      onClose={props.onClose}
      footer={
        <div className="grid-2">
          <button
            className="btn plain"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              if (!confirm(`Delete template "${t.name}"? Past workouts are kept.`)) return;
              await del("templates", t.id);
              props.onClose();
            }}
          >
            Delete
          </button>
          <button
            className="btn"
            disabled={!t.name.trim()}
            onClick={async () => {
              await put("templates", { ...t, name: t.name.trim() });
              props.onClose();
            }}
          >
            Save
          </button>
        </div>
      }
    >
      <Field label="Name"><input className="input" value={t.name} onChange={(e: any) => setT({ ...t, name: e.target.value })} /></Field>
      <h2>Exercises, in order</h2>
      <div className="card tight">
        {t.exerciseIds.length === 0 ? <div className="empty">No exercises yet.</div> : null}
        {t.exerciseIds.map((id, i) => (
          <div className="row" key={id}>
            <div className="grow name">{names.get(id) ?? "?"}</div>
            <button className="icon-btn" aria-label="move up" onClick={() => move(i, -1)}>↑</button>
            <button className="icon-btn" aria-label="move down" onClick={() => move(i, 1)}>↓</button>
            <button className="icon-btn" aria-label="remove" onClick={() => setT({ ...t, exerciseIds: t.exerciseIds.filter((x) => x !== id) })}>✕</button>
          </div>
        ))}
      </div>
      <button className="btn secondary block" onClick={() => setAdding(true)}>+ Add exercise</button>
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
      <button className="btn block xl" onClick={() => open({ kind: "cardio" })}>Log cardio</button>
      <h2>Minutes per week</h2>
      <Card>
        <BarChart bars={bars} />
      </Card>
      <h2>Sessions</h2>
      <div className="card tight">
        {sessions.length === 0 ? <div className="empty">No cardio logged yet.</div> : null}
        {sessions.slice(0, 30).map((s) => (
          <button className="row" key={s.id} onClick={() => open({ kind: "cardio", id: s.id })}>
            <div className="grow">
              <div className="name">
                {modalityLabel(s.modality)} · {typeLabel(s.sessionType)}
              </div>
              <div className="muted small">
                {shortDateTime(s.start)} · {s.minutes} min
                {s.distanceKm ? ` · ${fmt(distToDisplay(s.distanceKm, settings), 2)} ${settings.distanceUnit}` : ""}
                {s.avgHR ? ` · ${s.avgHR} bpm` : ""}
                {s.rpe ? ` · load ${Math.round(s.rpe * s.minutes)}` : ""}
              </div>
            </div>
            <span className="muted">›</span>
          </button>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        Load = effort (1–10) × minutes. It works the same for every kind of cardio and for lifting.
      </div>
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
    toast("Cardio saved");
    close();
  };
  const remove = async () => {
    if (s.source === "garmin") await put("cardio", { ...s, hidden: true, editedByUser: true });
    else await del("cardio", s.id);
    toast("Session deleted", () => void put("cardio", s));
    close();
  };
  return (
    <Sheet
      title={props.id ? "Edit cardio" : "Log cardio"}
      onClose={close}
      footer={
        props.id ? (
          <div className="grid-2">
            <button className="btn plain" style={{ color: "var(--danger)" }} onClick={remove}>
              Delete
            </button>
            <button className="btn" disabled={!minutes} onClick={save}>Save</button>
          </div>
        ) : (
          <button className="btn block xl" disabled={!minutes} onClick={save}>Save</button>
        )
      }
    >
      <Field label="What">
        <Chips options={MODALITIES} value={s.modality} onChange={(v) => v && setS({ ...s, modality: v })} />
      </Field>
      <Field label="Kind of session">
        <Chips options={SESSION_TYPES} value={s.sessionType} onChange={(v) => v && setS({ ...s, sessionType: v })} />
      </Field>
      <div className="grid-2">
        <Field label="Minutes"><NumInput value={minutes} onChange={setMinutes} decimals={false} /></Field>
        <Field label={`Distance (${settings.distanceUnit}, optional)`}><NumInput value={dist} onChange={setDist} /></Field>
        <Field label="Average HR (optional)"><NumInput value={s.avgHR ?? null} onChange={(v) => setS({ ...s, avgHR: v })} decimals={false} /></Field>
        <Field label="Max HR (optional)"><NumInput value={s.maxHR ?? null} onChange={(v) => setS({ ...s, maxHR: v })} decimals={false} /></Field>
      </div>
      <Field label="Effort (1 = very easy, 10 = maximal)">
        <Chips options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: String(v) }))} value={s.rpe ?? null} onChange={(v) => setS({ ...s, rpe: v })} allowNone />
      </Field>
      <Field label="Started">
        <input className="input" type="datetime-local" value={toLocalInputValue(s.start)} onChange={(e: any) => e.target.value && setS({ ...s, start: new Date(e.target.value).getTime() })} />
      </Field>
      <Field label="Machine or route (optional)">
        <input className="input" value={s.machine ?? ""} onChange={(e: any) => setS({ ...s, machine: e.target.value || undefined })} />
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={s.notes ?? ""} onChange={(e: any) => setS({ ...s, notes: e.target.value || undefined })} />
      </Field>
    </Sheet>
  );
}
