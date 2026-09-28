// Today: what you need to know today, at a glance.

import { useLive } from "../db/db";
import { getGarminKey, getGarminStatus, listGarminDays, type GarminStatus } from "../db/garmin";
import { activeWorkout, entriesForDay, listCardio, listCheckIns, listTemplates, listWeights, listWorkouts, startWorkout, sumNutrients, today, TZ } from "../db/repo";
import type { CardioSession, CheckIn, FoodEntry, GarminDay, Template, WeightEntry, Workout } from "../db/types";
import { localTime } from "../engine/dates";
import { fmt } from "../engine/units";
import { weightTrend } from "../engine/weight";
import { longDate, weightToDisplay } from "./format";
import { Card, fmtKcal, Icons, ProgressBar, Stat, useUI } from "./kit";
import { assessRecovery, type Level } from "./recovery";
import { computeDebt } from "./sleep";

const levelClass: Record<Level, string> = { good: "pill good", normal: "pill", watch: "pill warn", unknown: "pill" };
const levelText: Record<Level, string> = { good: "good", normal: "normal", watch: "watch", unknown: "info" };

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function TodayScreen() {
  const { settings, open, goTab } = useUI();
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
  const cardio = useLive(listCardio, [], [] as CardioSession[]);

  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const last = trend.at(-1);
  const todayLocal = localTime(Date.now(), TZ).date;
  const todayWeighed = weights.some((w) => localTime(w.t, TZ).date === todayLocal);
  const totals = sumNutrients(entries);
  const g = garmin.find((d) => d.date === todayLocal);
  const debt = computeDebt(checkins, garmin, settings, day);
  const recovery = assessRecovery(todayLocal, garmin, checkins, settings.sleepNeedHours, debt.debtHours);
  const weekAgo = Date.now() - 7 * 86400000;
  const cardioMin = cardio.filter((c) => c.start >= weekAgo).reduce((a, c) => a + c.minutes, 0);
  const liftsThisWeek = workouts.filter((w) => w.start >= weekAgo).length;
  const lastWorkout = workouts[0];
  const nextTemplate = lastWorkout && templates.length > 1 ? templates.find((t) => t.id !== lastWorkout.templateId) ?? templates[0] : templates[0];
  const hasData = weights.length + entries.length + checkins.length + workouts.length + garmin.length > 0;
  const backupDue = hasData && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > 7 * 86400000);
  const u = settings.weightUnit;

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>Today</h1>
          <div className="sub">{longDate(Date.now())}</div>
        </div>
        <button className="icon-btn" aria-label="settings" onClick={() => open({ kind: "settings" })}>
          {Icons.gear}
        </button>
      </div>

      {!garminKey ? (
        <div className="notice" onClick={() => open({ kind: "settings" })} style={{ cursor: "pointer" }}>
          <b>Set up Garmin sync</b> so sleep, HRV, resting heart rate, steps and workouts arrive automatically. Tap to start.
        </div>
      ) : status?.message ? (
        <div className="notice warn" onClick={() => open({ kind: "settings" })} style={{ cursor: "pointer" }}>
          Garmin: {status.message}
        </div>
      ) : null}
      {backupDue ? (
        <div className="notice warn" onClick={() => open({ kind: "settings" })} style={{ cursor: "pointer" }}>
          Your data lives only on this phone. Tap to export a backup to Files or iCloud Drive (weekly is plenty).
        </div>
      ) : null}

      <Card title="Recovery" aside={status?.lastSuccess ? `Garmin updated ${ago(status.lastSuccess)}` : null}>
        <div className="big-number" style={{ fontSize: 26, marginBottom: 6 }}>{recovery.summary}</div>
        {recovery.contributors.length === 0 ? (
          <div className="muted small">Appears once Garmin sleep and heart-rate data arrive.</div>
        ) : (
          recovery.contributors.map((c) => (
            <div className="set-line" key={c.label} style={{ gridTemplateColumns: "1fr auto auto" }}>
              <span>
                {c.label}
                <div className="muted small">{c.note}</div>
              </span>
              <span className="num" style={{ fontWeight: 600 }}>{c.value}</span>
              <span className={levelClass[c.level]}>{levelText[c.level]}</span>
            </div>
          ))
        )}
        {recovery.summary === "Reduced" ? (
          <div className="small" style={{ marginTop: 8 }}>Several signals are off today. Train as planned if you feel fine; consider an easier session if you don't.</div>
        ) : null}
      </Card>

      {g ? (
        <Card title="Activity (Garmin)">
          <div className="grid-3">
            <Stat label="Steps" value={g.steps != null ? g.steps.toLocaleString("en-CA") : "—"} />
            <Stat label="Garmin kcal" value={g.totalKcal != null ? fmtKcal(g.totalKcal) : "—"} />
            <Stat label="Stress avg" value={g.stressAvg != null && g.stressAvg >= 0 ? String(g.stressAvg) : "—"} />
          </div>
        </Card>
      ) : null}

      <Card title="Bodyweight" aside={todayWeighed ? "weighed today" : <button className="link" onClick={() => open({ kind: "weight" })}>Weigh in</button>}>
        {last && weights.length >= 3 ? (
          <div className="grid-2">
            <Stat label="Trend weight" value={`${fmt(weightToDisplay(last.trend, settings))} ${u}`} />
            <Stat
              label="Per week"
              value={`${last.slopePerDay >= 0 ? "+" : ""}${fmt(weightToDisplay(last.slopePerDay * 7, settings) - weightToDisplay(0, settings), 2)} ${u}`}
              sub={settings.phase === "cut" ? "cutting" : settings.phase === "bulk" ? "bulking" : "maintaining"}
            />
          </div>
        ) : (
          <div className="muted small">
            {weights.length ? `${weights.length} weigh-in${weights.length > 1 ? "s" : ""} so far. The trend appears after 3.` : "No weigh-ins yet. Weigh yourself in the morning after the bathroom, before food."}
          </div>
        )}
      </Card>

      <Card title="Food" aside={<button className="link" onClick={() => goTab("food")}>Open</button>}>
        <div className="card-head">
          <div>
            <span className="big-number" style={{ fontSize: 28 }}>{fmtKcal(totals.kcal)}</span>
            <span className="muted small"> kcal{settings.kcalTarget ? ` / ${fmtKcal(settings.kcalTarget)}` : ""}</span>
          </div>
          <div className="small num">
            {Math.round(totals.protein)}
            {settings.proteinTarget ? ` / ${settings.proteinTarget}` : ""} g protein
          </div>
        </div>
        {settings.kcalTarget ? <ProgressBar value={totals.kcal} max={settings.kcalTarget} /> : null}
        {settings.proteinTarget ? (
          <div style={{ marginTop: 8 }}>
            <ProgressBar value={totals.protein} max={settings.proteinTarget} />
          </div>
        ) : null}
      </Card>

      <Card title="Training" aside={`${liftsThisWeek} ${liftsThisWeek === 1 ? "lift" : "lifts"} · ${cardioMin} min cardio this week`}>
        {active ? (
          <button className="btn block" onClick={() => goTab("train")}>Continue {active.name}</button>
        ) : nextTemplate ? (
          <button
            className="btn block"
            onClick={async () => {
              await startWorkout(nextTemplate);
              goTab("train");
            }}
          >
            Start {nextTemplate.name}
          </button>
        ) : (
          <button className="btn block" onClick={() => goTab("train")}>Open Train</button>
        )}
        <div className="muted small" style={{ marginTop: 8 }}>Cardio from your Garmin appears in Train → Cardio automatically.</div>
      </Card>
    </div>
  );
}
