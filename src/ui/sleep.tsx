// Sleep tab: check-ins, sleep debt, 14-night history, caffeine.

import { useMemo } from "react";
import { useLive } from "../db/db";
import { listGarminDays } from "../db/garmin";
import { listCaffeine, listCheckIns, today, TZ } from "../db/repo";
import type { CaffeineEntry, CheckIn, GarminDay, Settings } from "../db/types";
import { addDays, parseISODate, type ISODate } from "../engine/dates";
import { caffeineRemaining, defaultSleepDebtParams, sleepDebt, type SleepNight } from "../engine/sleep";
import { bedtimePlan, caffeineCurve, caffeineCutoff, sleepRegularityIndex, timingSpread } from "../engine/sleepplan";
import { dayLabel } from "./format";
import { Card, PageTitle, Stat, useUI } from "./kit";
import { clock, clockOf, hm, pad } from "./models";
import { BarsPanel, PlotPanel, Seg7Panel } from "./raster";
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
  const need = settings.sleepNeedHours;
  const now = Date.now();
  const bed = bedtimeMs(settings, now);
  const half = settings.caffeineHalfLifeHours;
  const dosesLite = doses.map((d) => ({ mg: d.mg, t: d.t }));
  const caffeineAtBed = caffeineRemaining(dosesLite, bed, half);
  const caffeineNow = caffeineRemaining(dosesLite, now, half);
  const cutoff = caffeineCutoff({ doses: dosesLite, bedtimeMs: bed, halfLifeH: half, nowMs: now });

  // Regularity and timing from the last 14 Garmin main-sleep intervals.
  const intervals = useMemo(
    () =>
      garmin
        .filter((d) => d.date > addDays(todayISO, -15) && d.sleep.start && d.sleep.end && d.sleep.end > d.sleep.start)
        .map((d) => ({ start: d.sleep.start as number, end: d.sleep.end as number })),
    [garmin, todayISO],
  );
  const sri = useMemo(() => sleepRegularityIndex(intervals, Date.parse(`${todayISO}T12:00:00`), 14, TZ), [intervals, todayISO]);
  const spread = useMemo(() => timingSpread(intervals, TZ), [intervals]);
  const [bh, bm] = settings.bedtime.split(":").map(Number);
  const wakeTarget = spread.wakeMedianMin ?? ((bh * 60 + bm + need * 60) % 1440);
  const plan = bedtimePlan({ wakeTargetMin: wakeTarget, needHours: need, debtHours: debt.debtHours });

  // Caffeine curve: from the earlier of today 05:00 / the first recent dose, to an hour after bedtime.
  const dayStart = new Date(now);
  dayStart.setHours(5, 0, 0, 0);
  const firstDose = doses.length ? Math.min(...doses.map((d) => d.t)) : dayStart.getTime();
  const curveFrom = Math.max(Math.min(dayStart.getTime(), firstDose), now - 20 * 3600000);
  const curve = caffeineCurve(dosesLite, curveFrom, bed + 3600000, 10, half).map((p) => ({ x: p.t, y: p.mg }));

  const lastNightH = g?.sleep.totalSec ? g.sleep.totalSec / 3600 : todays?.sleepHours ?? null;
  const short = lastNightH !== null ? need - lastNightH : null;

  return (
    <div className="page">
      <PageTitle sys="SLEEP" status={`NEED ${hm(need)} H`} />

      {lastNightH !== null ? (
        <Card
          title={
            <>
              JANOS-SYS/LAST-NIGHT · <span className="blu">{g?.sleep.totalSec ? "GARMIN" : "MANUAL"}</span>
            </>
          }
          status={g?.sleep.score ? `SCORE ${pad(g.sleep.score, 3)}` : undefined}
          flush
        >
          <Seg7Panel
            id="sleep-last"
            heat
            rev="SOMNO MOD 1.03"
            caption="SLEEP LAST NIGHT:"
            value={hm(lastNightH).padStart(5, "0")}
            unit="H"
            tone={short !== null && short <= 0 ? "grn" : "am"}
            state={short !== null && short <= 0 ? { text: "● NEED MET", tone: "grn" } : { text: `▼ ${hm(short ?? 0)} SHORT`, tone: "am" }}
            sub={
              g?.sleep.start && g?.sleep.end
                ? `${clockOf(g.sleep.start)} → ${clockOf(g.sleep.end)}${g.sleep.respiration ? ` · RESP ${g.sleep.respiration.toFixed(1)}` : ""}`
                : "MANUAL ENTRY"
            }
            side={g?.sleep.score ? { big: String(g.sleep.score), small: "SCORE" } : undefined}
            srText={`Slept ${hm(lastNightH)} hours${g?.sleep.score ? `, score ${g.sleep.score}` : ""}.`}
          />
          {g?.sleep.totalSec ? (
            <div className="card-body">
              <div className="grid-3">
                <Stat label="DEEP" value={g.sleep.deepSec != null ? hm(g.sleep.deepSec / 3600) : "—"} />
                <Stat label="REM" value={g.sleep.remSec != null ? hm(g.sleep.remSec / 3600) : "—"} />
                <Stat label="AWAKE" value={g.sleep.awakeSec != null ? hm(g.sleep.awakeSec / 3600) : "—"} />
              </div>
              <div className="desc">WRIST-SENSOR STAGES ARE ESTIMATES; CALCULATIONS USE TOTAL SLEEP ONLY.</div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card title="JANOS-SYS/LAST-NIGHT" aside="NO DATA">
          <div className="empty" style={{ padding: "0 0 10px" }}>
            NO GARMIN SLEEP FOR LAST NIGHT YET. IT ARRIVES AUTOMATICALLY ONCE THE GARMIN LINK IS SET UP (CONFIG → 1. GARMIN LINK), OR ENTER IT BY HAND.
          </div>
          <button className="btn plain block" onClick={() => open({ kind: "checkin" })}>ENTER MANUALLY</button>
        </Card>
      )}

      <Card title="JANOS-SYS/DEBT" aside={debt.debtHours === null ? "NO DATA" : debtBand(debt.debtHours)}>
        {debt.debtHours === null ? (
          <div className="desc">WARN 031 INSUFFICIENT DATA · {logged}/14 NIGHTS LOGGED · NEEDS 11. FILLS IN BY ITSELF WITH THE GARMIN LINK ON.</div>
        ) : (
          <>
            <div className="grid-2">
              <Stat label="SLEEP DEBT" value={`${hm(debt.debtHours)} H`} sub="14 NIGHTS · RECENT COUNT MORE" />
              <Stat label="TONIGHT · IN BED BY" value={clock(plan.bedtimeMin)} sub={`WAKE ${clock(wakeTarget)} · NEED ${hm(need)}${plan.paybackH > 0 ? ` + ${hm(plan.paybackH)} PAYBACK` : ""}`} />
            </div>
            <div className="desc">
              {debt.estimatedNights ? `${debt.estimatedNights} MISSING NIGHT${debt.estimatedNights > 1 ? "S" : ""} ESTIMATED · ` : ""}
              {debt.debtHours < 1
                ? "LOW · KEEP THE USUAL SCHEDULE."
                : "REPAY GRADUALLY: UP TO 1 H EXTRA PER NIGHT, SAME WAKE TIME. INCLUDES 15 MIN TO FALL ASLEEP."}
            </div>
          </>
        )}
      </Card>

      <Card title="JANOS-SYS/14-NIGHTS" aside="STAGES · HOURS" flush>
        <BarsPanel
          id="sleep-14"
          rev="SOMNO MOD 1.03"
          bars={nights.map((n) => {
            const gd = gByDay.get(n.day);
            const h = n.night.mainSleepHours ?? 0;
            const seg =
              gd?.sleep.totalSec && gd.sleep.deepSec != null && gd.sleep.remSec != null && gd.sleep.lightSec != null
                ? [
                    { value: gd.sleep.deepSec / 3600, tone: "dbl" as const },
                    { value: gd.sleep.lightSec / 3600, tone: "cya" as const },
                    { value: gd.sleep.remSec / 3600, tone: "blu" as const },
                  ]
                : undefined;
            return { label: String(parseISODate(n.day).day), value: h, segments: seg, tone: h && h < need - 1 ? ("am" as const) : undefined };
          })}
          format={(v) => v.toFixed(1)}
          target={{ value: need, label: `NEED ${hm(need)}` }}
          legend="■ DEEP ■ LIGHT ■ REM"
          empty="NO NIGHTS YET"
        />
      </Card>

      <Card title="JANOS-SYS/REGULARITY" aside={sri.sri !== null ? `SRI ${sri.sri.toFixed(0)}` : "NO DATA"}>
        {spread.n >= 3 ? (
          <>
            <div className="grid-3">
              <Stat label="SRI (−100…100)" value={sri.sri !== null ? pad(sri.sri, 2) : "---"} sub={sri.sri !== null ? regularityWord(sri.sri) : `${sri.nights}/5 NIGHTS`} />
              <Stat label="BEDTIME" value={spread.bedtimeMedianMin !== null ? clock(spread.bedtimeMedianMin) : "—"} sub={spread.bedtimeSdMin !== null ? `±${Math.round(spread.bedtimeSdMin)} MIN` : ""} />
              <Stat label="WAKE" value={spread.wakeMedianMin !== null ? clock(spread.wakeMedianMin) : "—"} sub={spread.wakeSdMin !== null ? `±${Math.round(spread.wakeSdMin)} MIN` : ""} />
            </div>
            <div className="desc">
              SLEEP REGULARITY INDEX: CHANCE OF BEING IN THE SAME STATE (ASLEEP/AWAKE) 24 H APART, LAST 14 DAYS. STEADY BED AND WAKE TIMES MATTER AS MUCH AS DURATION.
            </div>
          </>
        ) : (
          <div className="desc">WARN 031 INSUFFICIENT DATA · {spread.n}/5 GARMIN NIGHTS WITH BED AND WAKE TIMES.</div>
        )}
      </Card>

      <Card title="JANOS-SYS/CAFFEINE" aside={<button className="link" onClick={() => open({ kind: "caffeine" })}>LOG</button>} flush>
        <PlotPanel
          id="sleep-caffeine"
          rev="CAF CURVE R02"
          lines={[{ pts: curve, tone: "am", width: 2 }]}
          hlines={[{ y: 25, label: "25 MG LIMIT", tone: "grn", dashed: true }]}
          vlines={[
            { x: bed, label: `BED ${settings.bedtime}`, tone: "blu" },
            ...(cutoff.cutoffMs !== null && cutoff.cutoffMs > curveFrom ? [{ x: cutoff.cutoffMs, label: `CUTOFF ${clockOf(cutoff.cutoffMs)}`, tone: "red" as const }] : []),
          ]}
          marker={{ x: now, y: caffeineNow, label: `NOW ${Math.round(caffeineNow)} MG` }}
          yFormat={(v) => `${Math.round(v)}`}
          xFormat={(v) => clockOf(v)}
          yPad={0}
          legend="MG IN SYSTEM · HALF-LIFE MODEL"
          empty="NO CAFFEINE LOGGED"
          srText={`Caffeine now ${Math.round(caffeineNow)} mg, at bedtime ${Math.round(caffeineAtBed)} mg.`}
        />
        <div className="card-body">
          <div className="grid-3">
            <Stat label="NOW" value={`${pad(caffeineNow, 3)} MG`} />
            <Stat label={`AT BED ${settings.bedtime}`} value={`${pad(caffeineAtBed, 3)} MG`} />
            <Stat
              label="LAST COFFEE BY"
              value={cutoff.status === "CLOSED" ? "CLOSED" : cutoff.cutoffMs !== null ? clockOf(cutoff.cutoffMs) : "—"}
              sub={cutoff.status === "PAST" ? "PAST CUTOFF" : cutoff.status === "CLOSED" ? "LIMIT REACHED" : "95 MG DOSE"}
            />
          </div>
          <div className="desc">
            CUTOFF = LATEST TIME A 95 MG COFFEE STILL DECAYS TO ≤25 MG BY BEDTIME ({half} H HALF-LIFE; CHANGE IN CONFIG). BASED ON A 2023 META-ANALYSIS OF CAFFEINE TIMING AND SLEEP.
          </div>
        </div>
      </Card>

      <Card title="JANOS-SYS/SLEEP-LOG" aside="30 D" flush>
        {history.every((h) => h.night.mainSleepHours === null) ? <div className="empty">NO RECORDS YET.</div> : null}
        {history
          .filter((h) => h.night.mainSleepHours !== null || byDay.has(h.day))
          .map((h) => {
            const gd = gByDay.get(h.day);
            const c = byDay.get(h.day);
            const hrv = gd?.hrv.lastNight ?? c?.hrv;
            const rhr = gd?.restingHR ?? c?.restingHR;
            const details = [
              gd?.sleep.score ? `SCORE ${gd.sleep.score}` : null,
              hrv ? `HRV ${hrv}` : null,
              rhr ? `RHR ${rhr}` : null,
              gd?.bodyBatteryWake ? `BB ${gd.bodyBatteryWake}` : null,
              c?.energy ? `ENERGY ${c.energy}` : null,
              c?.ill ? "ILL" : null,
            ].filter(Boolean);
            return (
              <button className="row" key={h.day} onClick={() => open({ kind: "checkin", day: h.day })}>
                <div className="grow">
                  <div>{dayLabel(h.day, todayISO, addDays(todayISO, -1))}</div>
                  <div className="muted small">{details.join(" · ")}</div>
                </div>
                <div className="num">{h.night.mainSleepHours !== null ? hm(h.night.mainSleepHours) : "—"}</div>
              </button>
            );
          })}
      </Card>
    </div>
  );
}

/** Oura-style debt bands: none < 0.5 h, low < 2 h, moderate 2–5 h, high > 5 h. */
function debtBand(h: number): string {
  return h < 0.5 ? "NONE" : h < 2 ? "LOW" : h <= 5 ? "MODERATE" : "HIGH";
}

function regularityWord(sri: number): string {
  return sri >= 80 ? "REGULAR" : sri >= 60 ? "MODERATE" : "IRREGULAR";
}
