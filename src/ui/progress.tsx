// Progress tab: weight trend with its expected range, strength trends, sleep and cardio history.

import { useMemo, useState } from "react";
import { getAll, useLive } from "../db/db";
import { listGarminDays } from "../db/garmin";
import { exerciseHistory, listCheckIns, listExercises, listWeights, today, workingSets, type ExerciseSession } from "../db/repo";
import type { CheckIn, Exercise, GarminDay, StrengthSet, WeightEntry } from "../db/types";
import { dayNumber } from "../engine/dates";
import { e1RM } from "../engine/strength";
import { fmt } from "../engine/units";
import { defaultTrendParams, weightTrend } from "../engine/weight";
import { weightToDisplay } from "./format";
import { Card, LineChart, Segmented, Stat, useUI } from "./kit";
import { sleepNights } from "./sleep";

type Range = "30" | "90" | "365" | "all";

/** Exercise ids ordered by when they were last trained (most recent first). */
async function trainedOrder(): Promise<string[]> {
  const last = new Map<string, number>();
  for (const s of await getAll<StrengthSet>("sets")) last.set(s.exerciseId, Math.max(last.get(s.exerciseId) ?? 0, s.completedAt));
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export function ProgressScreen() {
  const { settings } = useUI();
  const [range, setRange] = useState<Range>("90");
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const exercises = useLive(() => listExercises(), [], [] as Exercise[]);
  const checkins = useLive(listCheckIns, [], [] as CheckIn[]);
  const garmin = useLive(listGarminDays, [], [] as GarminDay[]);
  const trained = useLive(trainedOrder, [], [] as string[]);
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
  // 80% range for a single weigh-in: trend uncertainty plus day-to-day scale noise.
  const band = shown.map((p) => {
    const sd = Math.sqrt(p.trendSD ** 2 + defaultTrendParams.observationSD ** 2);
    return { x: p.t, lo: d(p.trend - 1.2816 * sd), hi: d(p.trend + 1.2816 * sd) };
  });
  const last = trend.at(-1);
  const first = shown[0];

  const strengthPoints = history
    .map((h) => {
      const ws = workingSets(h.sets);
      if (!ws.length) return null;
      return { x: h.workout.start, y: Math.max(...ws.map((s) => e1RM(s.load, s.reps, s.rir ?? 0))) };
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  const bestSet = history.flatMap((h) => workingSets(h.sets)).sort((a, b) => b.load - a.load)[0];

  // Sleep: Garmin nights first, manual entries fill gaps.
  const todayISO = today(settings);
  const firstDay = [...garmin.map((g) => g.date), ...checkins.map((c) => c.day)].sort()[0];
  const available = firstDay ? dayNumber(todayISO) - dayNumber(firstDay) + 1 : 0;
  const spanDays = Math.max(0, Math.min(available, range === "all" ? 3650 : Number(range)));
  const sleepPts = sleepNights(checkins, garmin, todayISO, spanDays)
    .filter((n) => n.night.mainSleepHours !== null)
    .map((n) => ({ x: Date.parse(`${n.day}T12:00:00`), y: n.night.mainSleepHours as number }));

  return (
    <div className="page">
      <div className="page-title">
        <h1>Progress</h1>
      </div>
      <Segmented
        options={[
          { value: "30", label: "30 d" },
          { value: "90", label: "90 d" },
          { value: "365", label: "1 yr" },
          { value: "all", label: "All" },
        ]}
        value={range}
        onChange={setRange}
      />

      <h2>Bodyweight</h2>
      <Card>
        {weights.length < 3 ? (
          <div className="muted">
            Not enough data yet: {weights.length} weigh-in{weights.length === 1 ? "" : "s"} so far. The trend appears after 3.
          </div>
        ) : (
          <>
            <div className="grid-3" style={{ marginBottom: 8 }}>
              <Stat label="Trend" value={`${fmt(d(last!.trend))}`} sub={settings.weightUnit} />
              <Stat label="Per week" value={`${last!.slopePerDay >= 0 ? "+" : ""}${fmt(d(last!.slopePerDay * 7) - d(0), 2)}`} sub={settings.weightUnit} />
              <Stat label="In range" value={first ? `${d(last!.trend) - d(first.trend) >= 0 ? "+" : ""}${fmt(d(last!.trend) - d(first.trend))}` : "—"} sub={settings.weightUnit} />
            </div>
            <LineChart
              dots={shown.map((p) => ({ x: p.t, y: d(p.observed), flag: p.suspect }))}
              lines={[shown.map((p) => ({ x: p.t, y: d(p.trend) }))]}
              band={band}
            />
            <div className="muted small">
              Dots are weigh-ins, the line is your trend weight, and the shaded band is where 8 in 10 weigh-ins are expected to land. Orange dots were unusual and down-weighted.
            </div>
          </>
        )}
      </Card>

      <h2>Strength</h2>
      <Card>
        <select className="input" value={exId} onChange={(e: any) => setPicked(e.target.value)}>
          <option value="">Choose an exercise…</option>
          {pickList.map((e) => (
            <option key={e.id} value={e.id}>
              {trained.includes(e.id) ? e.name : `${e.name} (not trained yet)`}
            </option>
          ))}
        </select>
        {exId ? (
          strengthPoints.length ? (
            <>
              <div style={{ height: 10 }} />
              <LineChart dots={strengthPoints} lines={[strengthPoints]} yPad={2} yFormat={(v) => fmt(v, 0)} />
              <div className="grid-2">
                <Stat label="Best estimated 1-rep max" value={fmt(Math.max(...strengthPoints.map((p) => p.y)), 0)} />
                <Stat label="Heaviest working set" value={bestSet ? `${fmt(bestSet.load)} × ${bestSet.reps}` : "—"} />
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                Estimated 1-rep max from your best set each session (reps + reps in reserve). Use it to compare sessions on the same machine, not as a true max.
              </div>
            </>
          ) : (
            <div className="muted" style={{ marginTop: 10 }}>No working sets logged for this exercise yet.</div>
          )
        ) : null}
      </Card>

      <h2>Sleep</h2>
      <Card>
        {sleepPts.length < 2 ? (
          <div className="muted">Sleep history appears once Garmin sync has run (or after a manual sleep entry).</div>
        ) : (
          <LineChart dots={sleepPts} lines={[sleepPts]} yPad={0.5} yFormat={(v) => `${fmt(v, 1)}h`} />
        )}
      </Card>
    </div>
  );
}
