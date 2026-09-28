// Sleep tab: check-ins, sleep debt, 14-night history, caffeine.

import { useLive } from "../db/db";
import { listGarminDays } from "../db/garmin";
import { listCaffeine, listCheckIns, today } from "../db/repo";
import type { CaffeineEntry, CheckIn, GarminDay, Settings } from "../db/types";
import { addDays, parseISODate, type ISODate } from "../engine/dates";
import { caffeineRemaining, defaultSleepDebtParams, sleepDebt, type SleepNight } from "../engine/sleep";
import { dayLabel, hoursText } from "./format";
import { BarChart, Card, useUI } from "./kit";
import { bedtimeMs } from "./sheets";

/** Nights ending on each date: Garmin sleep first, then a manual check-in as fallback. */
export function sleepNights(
  checkins: readonly CheckIn[],
  garmin: readonly GarminDay[],
  endDay: ISODate,
  count = 14,
): { day: ISODate; night: SleepNight; source: "garmin" | "manual" | null }[] {
  const byDay = new Map(checkins.map((c) => [c.day, c]));
  const gByDay = new Map(garmin.map((g) => [g.date, g]));
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(endDay, i - count + 1);
    const g = gByDay.get(day);
    const c = byDay.get(day);
    const gHours = g?.sleep.totalSec ? g.sleep.totalSec / 3600 : null;
    // Naps are credited to the day they happened (Garmin), or the day before a manual check-in.
    const napHours = g?.sleep.napSec ? g.sleep.napSec / 3600 : (byDay.get(addDays(day, 1))?.napMinutes ?? 0) / 60;
    const hours = gHours ?? c?.sleepHours ?? null;
    return { day, night: { mainSleepHours: hours, napHours }, source: gHours !== null ? "garmin" : c?.sleepHours != null ? "manual" : null };
  });
}

export function computeDebt(checkins: readonly CheckIn[], garmin: readonly GarminDay[], settings: Settings, endDay: ISODate) {
  const nights = sleepNights(checkins, garmin, endDay).map((n) => n.night);
  return sleepDebt(nights, defaultSleepDebtParams(settings.sleepNeedHours));
}

export function SleepScreen() {
  const { settings, open } = useUI();
  const checkins = useLive(listCheckIns, [], [] as CheckIn[]);
  const garmin = useLive(listGarminDays, [], [] as GarminDay[]);
  const doses = useLive(() => listCaffeine(Date.now() - 36 * 3600000), [], [] as CaffeineEntry[]);
  const todayISO = today(settings);
  const todays = checkins.find((c) => c.day === todayISO);
  const g = garmin.find((d) => d.date === todayISO);
  const debt = computeDebt(checkins, garmin, settings, todayISO);
  const nights = sleepNights(checkins, garmin, todayISO);
  const history = sleepNights(checkins, garmin, todayISO, 30).reverse();
  const byDay = new Map(checkins.map((c) => [c.day, c]));
  const gByDay = new Map(garmin.map((d) => [d.date, d]));
  const logged = nights.filter((n) => n.night.mainSleepHours !== null).length;
  const caffeineAtBed = caffeineRemaining(doses.map((d) => ({ mg: d.mg, t: d.t })), bedtimeMs(settings), settings.caffeineHalfLifeHours);
  const need = settings.sleepNeedHours;

  const debtAdvice = (h: number) => {
    if (h < 1) return "Low. Keep your usual schedule.";
    const extra = Math.min(60, Math.max(20, Math.round((h / 5) * 60 / 5) * 5));
    return `Go to bed about ${extra} minutes earlier than usual for the next few nights and keep your wake time the same. Paying it back gradually works better than one long lie-in.`;
  };

  return (
    <div className="page">
      <div className="page-title">
        <h1>Sleep</h1>
      </div>

      {g && g.sleep.totalSec ? (
        <Card title="Last night (Garmin)" aside={g.sleep.score ? `score ${g.sleep.score}` : null}>
          <div className="big-number">{hoursText(g.sleep.totalSec / 3600)}</div>
          <div className="muted small" style={{ marginBottom: 10 }}>
            {g.sleep.start && g.sleep.end
              ? `${new Date(g.sleep.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${new Date(g.sleep.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </div>
          <div className="grid-3">
            <div className="stat"><div className="label">Deep</div><div className="value">{g.sleep.deepSec != null ? hoursText(g.sleep.deepSec / 3600) : "—"}</div></div>
            <div className="stat"><div className="label">REM</div><div className="value">{g.sleep.remSec != null ? hoursText(g.sleep.remSec / 3600) : "—"}</div></div>
            <div className="stat"><div className="label">Awake</div><div className="value">{g.sleep.awakeSec != null ? hoursText(g.sleep.awakeSec / 3600) : "—"}</div></div>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>Sleep stages from a wrist sensor are estimates, so the app uses total sleep for its calculations.</div>
        </Card>
      ) : (
        <Card
          title={todays ? "This morning" : "Last night"}
          aside={todays ? <button className="link" onClick={() => open({ kind: "checkin" })}>Edit</button> : null}
        >
        {todays ? (
          <div className="grid-3">
            <div className="stat"><div className="label">Slept</div><div className="value">{todays.sleepHours != null ? hoursText(todays.sleepHours) : "—"}</div></div>
            <div className="stat"><div className="label">Energy</div><div className="value">{todays.energy ?? "—"}</div></div>
            <div className="stat"><div className="label">HRV</div><div className="value">{todays.hrv ?? "—"}</div></div>
          </div>
        ) : (
          <>
            <div className="muted small" style={{ marginBottom: 10 }}>
              No Garmin sleep for last night yet. It arrives automatically once Garmin sync is set up (Settings → Garmin sync). You can also enter it by hand.
            </div>
            <button className="btn plain block" onClick={() => open({ kind: "checkin" })}>Enter manually</button>
          </>
        )}
        </Card>
      )}

      <Card title="Sleep debt" aside={`need ${hoursText(need)}`}>
        {debt.debtHours === null ? (
          <>
            <div className="big-number" style={{ fontSize: 24 }}>Insufficient data</div>
            <div className="muted small">
              Needs at least 11 of the last 14 nights. You have {logged}. With Garmin sync on, this fills in by itself.
            </div>
          </>
        ) : (
          <>
            <div className="big-number">{hoursText(debt.debtHours)}</div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              Weighted over the last 14 nights (recent nights count more){debt.estimatedNights ? `; ${debt.estimatedNights} missing night${debt.estimatedNights > 1 ? "s" : ""} estimated` : ""}.
            </div>
            <div className="small">{debtAdvice(debt.debtHours)}</div>
          </>
        )}
      </Card>

      <h2>Last 14 nights (hours)</h2>
      <Card>
        <BarChart
          bars={nights.map((n) => ({ label: String(parseISODate(n.day).day), value: n.night.mainSleepHours ?? 0 }))}
          format={(v) => v.toFixed(1)}
        />
        <div className="muted small">Your sleep need is set to {hoursText(need)} (change it in Settings). Research on sleep extension puts most adults around 7.5–9 h.</div>
      </Card>

      <Card title="Caffeine" aside={<button className="link" onClick={() => open({ kind: "caffeine" })}>Log</button>}>
        <div className="muted small">
          ≈ {Math.round(caffeineAtBed)} mg still in your system at bedtime ({settings.bedtime}).
          {caffeineAtBed > 50 ? " That's enough to affect sleep for many people." : ""}
        </div>
      </Card>

      <h2>History</h2>
      <div className="card tight">
        {history.every((h) => h.night.mainSleepHours === null) ? <div className="empty">No sleep recorded yet.</div> : null}
        {history
          .filter((h) => h.night.mainSleepHours !== null || byDay.has(h.day))
          .map((h) => {
            const gd = gByDay.get(h.day);
            const c = byDay.get(h.day);
            const hrv = gd?.hrv.lastNight ?? c?.hrv;
            const rhr = gd?.restingHR ?? c?.restingHR;
            const details = [
              gd?.sleep.score ? `score ${gd.sleep.score}` : null,
              hrv ? `HRV ${hrv}` : null,
              rhr ? `RHR ${rhr}` : null,
              gd?.bodyBatteryWake ? `BB ${gd.bodyBatteryWake}` : null,
              c?.energy ? `energy ${c.energy}` : null,
              c?.ill ? "ill" : null,
            ].filter(Boolean);
            return (
              <button className="row" key={h.day} onClick={() => open({ kind: "checkin", day: h.day })}>
                <div className="grow">
                  <div>{dayLabel(h.day, todayISO, addDays(todayISO, -1))}</div>
                  <div className="muted small">{details.join(" · ")}</div>
                </div>
                <div className="num">{h.night.mainSleepHours !== null ? hoursText(h.night.mainSleepHours) : "—"}</div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
