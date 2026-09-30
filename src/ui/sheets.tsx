// Small sheets: weigh-in, morning check-in, caffeine, quick log and settings (the config terminal).

import { useEffect, useState } from "react";
import { del, get, persistenceStatus, put, restoreAll, uid, useLive, type Backup } from "../db/db";
import { buildBackupJson, buildCsvZip, shareOrDownload } from "../db/exporters";
import { createGarminKey, getGarminKey, getGarminStatus, setGarminKey, syncGarmin, type GarminStatus } from "../db/garmin";
import { addWeight, getSettings, listCaffeine, listWeights, saveSettings, today, TZ } from "../db/repo";
import type { CaffeineEntry, CheckIn, Settings, WeightEntry } from "../db/types";
import { addDays, localTime } from "../engine/dates";
import { DEFAULT_RATE_PCT } from "../engine/energy";
import { caffeineRemaining, mifflinStJeor } from "../engine/sleep";
import { fmt } from "../engine/units";
import { checkWeightEntry, weightTrend } from "../engine/weight";
import { totalOf } from "../engine/aimeal";
import { AI_DEFAULTS, analyzeMeal, getAiConfig, maskKey, setAiConfig, type AiConfig } from "./ai";
import { dayLabel, durationFromClock, hoursText, shortDateTime, weightFromDisplay, weightText, weightToDisplay } from "./format";
import {
  Card,
  Check,
  Chips,
  confirmScreen,
  Field,
  garminLink,
  garminMessageCode,
  NumInput,
  readDisplayPrefs,
  Segmented,
  Sheet,
  Stat,
  useUI,
  writeDisplayPref,
  type Density,
} from "./kit";

// ---- weigh-in ---------------------------------------------------------------

export function WeightSheet() {
  const { settings, close, toast } = useUI();
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const last = weights.at(-1);
  const ref = trend.length ? weightToDisplay(trend.at(-1)!.trend, settings) : null;
  const [value, setValue] = useState<number | null>(null);
  const [warning, setWarning] = useState<{ reason: string; suggestion: number | null } | null>(null);
  // The last weigh-in is the placeholder: typing starts fresh, and SAVE on an empty box repeats it.
  const suggested = last ? Math.round(weightToDisplay(last.kg, settings) * 10) / 10 : null;
  const entry = value ?? suggested;

  const save = async (v: number, force = false) => {
    if (!force) {
      const verdict = checkWeightEntry(v, ref, settings.weightUnit === "lb");
      if (!verdict.ok) {
        setWarning({ reason: verdict.reason, suggestion: verdict.suggestion });
        return;
      }
    }
    const w = await addWeight(weightFromDisplay(v, settings));
    toast(`WEIGH-IN SAVED · ${fmt(v)} ${settings.weightUnit}`, () => void del("weights", w.id));
    close();
  };

  return (
    <Sheet
      title="WEIGH-IN"
      onClose={close}
      footer={
        <button className="btn block xl" disabled={entry === null} onClick={() => entry !== null && save(entry)}>
          SAVE
        </button>
      }
    >
      <Field label={`WEIGHT (${settings.weightUnit})`}>
        <NumInput big value={value} onChange={(v) => { setValue(v); setWarning(null); }} placeholder={suggested !== null ? String(suggested) : undefined} ariaLabel="weight" autoFocus />
      </Field>
      {ref !== null ? (
        <div className="desc" style={{ textAlign: "center" }}>
          TREND WEIGHT <b>{fmt(ref)} {settings.weightUnit}</b>
        </div>
      ) : null}
      {warning ? (
        <div className="notice warn" role="alert" style={{ marginTop: 12 }}>
          <span className="msg">{warning.suggestion !== null ? "WARN 052 UNIT MIX-UP SUSPECTED" : "WARN 051 WEIGHT ENTRY IMPLAUSIBLE"}</span>
          <span className="act">{warning.reason}</span>
          <div className="chips">
            {warning.suggestion !== null ? (
              <button className="btn sm" onClick={() => save(warning.suggestion!, true)}>
                USE {fmt(warning.suggestion)} {settings.weightUnit}
              </button>
            ) : null}
            <button className="btn sm plain" onClick={() => entry !== null && save(entry, true)}>
              SAVE {entry} ANYWAY
            </button>
          </div>
        </div>
      ) : null}
      <h2>RECENT</h2>
      <Card title="WEIGH-IN LOG" aside={weights.length ? `${weights.length} ENTRIES` : null} flush>
        {weights.length === 0 ? <div className="empty">NO WEIGH-INS YET · WEIGH IN AFTER WAKING, BEFORE FOOD</div> : null}
        {[...weights].reverse().slice(0, 10).map((w) => (
          <div className="row" key={w.id}>
            <div className="grow">{shortDateTime(w.t)}</div>
            <div className="num">{weightText(w.kg, settings)}</div>
            <button
              className="link danger"
              onClick={async () => {
                await del("weights", w.id);
                toast("PROC 093 ENTRY DELETED", () => void put("weights", w));
              }}
            >
              DEL
            </button>
          </div>
        ))}
      </Card>
    </Sheet>
  );
}

// ---- morning check-in -------------------------------------------------------

const scale5 = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));

export function CheckInSheet(props: { day?: string }) {
  const { settings, close, toast } = useUI();
  const day = props.day ?? today(settings);
  const [c, setC] = useState<CheckIn>({ day, updatedAt: 0 });
  const [hours, setHours] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [showGarmin, setShowGarmin] = useState(false);

  useEffect(() => {
    get<CheckIn>("checkins", day).then((existing) => {
      if (existing) {
        setC(existing);
        if (existing.sleepHours != null) {
          const total = Math.round(existing.sleepHours * 60);
          setHours(Math.floor(total / 60));
          setMinutes(total % 60);
        }
        if (existing.hrv != null || existing.restingHR != null || existing.bodyBattery != null || existing.sleepScore != null) setShowGarmin(true);
      }
    });
  }, [day]);

  const set = <K extends keyof CheckIn>(k: K, v: CheckIn[K]) => setC((prev) => ({ ...prev, [k]: v }));
  const fromClock = c.bedtime && c.wakeTime ? durationFromClock(c.bedtime, c.wakeTime) : null;
  const typed = hours !== null || minutes !== null ? (hours ?? 0) + (minutes ?? 0) / 60 : null;
  const sleepHours = typed ?? fromClock;

  const save = async () => {
    await put("checkins", { ...c, sleepHours, updatedAt: Date.now() });
    toast("CHECK-IN SAVED");
    close();
  };

  return (
    <Sheet title={`CHECK-IN · ${dayLabel(day, today(settings))}`} onClose={close} footer={<button className="btn block xl" onClick={save}>SAVE</button>}>
      <h2 style={{ marginTop: 4 }}>SLEEP</h2>
      <div className="grid-2">
        <Field label="HOURS">
          <NumInput value={hours} onChange={setHours} decimals={false} placeholder="7" ariaLabel="sleep hours" />
        </Field>
        <Field label="MINUTES">
          <NumInput value={minutes} onChange={setMinutes} decimals={false} placeholder="30" ariaLabel="sleep minutes" />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="FELL ASLEEP">
          <input className="input" type="time" value={c.bedtime ?? ""} onChange={(e: any) => set("bedtime", e.target.value || null)} />
        </Field>
        <Field label="WOKE UP">
          <input className="input" type="time" value={c.wakeTime ?? ""} onChange={(e: any) => set("wakeTime", e.target.value || null)} />
        </Field>
      </div>
      {sleepHours !== null ? (
        <div className="desc" style={{ margin: "0 0 10px" }}>
          SLEEP <b>{hoursText(sleepHours)}</b>
          {typed === null ? " · FROM THE TIMES" : ""}
        </div>
      ) : null}
      <Field label="NAPS YESTERDAY (MIN)">
        <NumInput value={c.napMinutes ?? null} onChange={(v) => set("napMinutes", v)} decimals={false} placeholder="0" />
      </Field>

      <h2>STATUS (OPTIONAL)</h2>
      <Field label="ENERGY · 1 DRAINED · 5 GREAT">
        <Chips options={scale5} value={c.energy ?? null} onChange={(v) => set("energy", v)} allowNone />
      </Field>
      <Field label="SORENESS · 1 NONE · 5 VERY SORE">
        <Chips options={scale5} value={c.soreness ?? null} onChange={(v) => set("soreness", v)} allowNone />
      </Field>
      <Field label="STRESS · 1 CALM · 5 VERY STRESSED">
        <Chips options={scale5} value={c.stress ?? null} onChange={(v) => set("stress", v)} allowNone />
      </Field>
      <Field label="FEELING ILL">
        <Chips options={[{ value: "no", label: "NO" }, { value: "yes", label: "YES" }]} value={c.ill ? "yes" : "no"} onChange={(v) => set("ill", v === "yes")} />
      </Field>

      {showGarmin ? (
        <>
          <h2>GARMIN READINGS (OPTIONAL)</h2>
          <div className="grid-2">
            <Field label="SLEEP SCORE">
              <NumInput value={c.sleepScore ?? null} onChange={(v) => set("sleepScore", v)} decimals={false} />
            </Field>
            <Field label="OVERNIGHT HRV (MS)">
              <NumInput value={c.hrv ?? null} onChange={(v) => set("hrv", v)} decimals={false} />
            </Field>
            <Field label="RESTING HR (BPM)">
              <NumInput value={c.restingHR ?? null} onChange={(v) => set("restingHR", v)} decimals={false} />
            </Field>
            <Field label="BODY BATTERY">
              <NumInput value={c.bodyBattery ?? null} onChange={(v) => set("bodyBattery", v)} decimals={false} />
            </Field>
          </div>
        </>
      ) : (
        <button className="btn plain block" onClick={() => setShowGarmin(true)}>
          ADD GARMIN READINGS · HRV · RESTING HR · BODY BATTERY · SLEEP SCORE
        </button>
      )}
    </Sheet>
  );
}

// ---- caffeine ---------------------------------------------------------------

export function bedtimeMs(settings: Settings, now = Date.now()): number {
  const [h, m] = settings.bedtime.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() < now - 6 * 3600000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** "HH:MM" today; if that is in the future (more than 5 min), the same time yesterday. */
export function clockToPastMs(hhmm: string, now = Date.now()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() > now + 5 * 60000) d.setDate(d.getDate() - 1);
  return d.getTime();
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function CaffeineSheet() {
  const { settings, close, toast } = useUI();
  const since = Date.now() - 36 * 3600000;
  const doses = useLive(() => listCaffeine(since), [], [] as CaffeineEntry[]);
  const [mg, setMg] = useState<number | null>(null);
  const [time, setTime] = useState<string>(() => hhmm(Date.now()));
  const now = Date.now();
  const add = async (label: string, amount: number) => {
    const t = clockToPastMs(time) ?? Date.now();
    const e: CaffeineEntry = { id: uid(), t, mg: amount, label };
    await put("caffeine", e);
    toast(`CAFFEINE FILED · ${label} ${amount} MG AT ${hhmm(t)}`, () => void del("caffeine", e.id));
  };
  const setDoseTime = async (d: CaffeineEntry, value: string) => {
    const t = clockToPastMs(value, Math.max(Date.now(), d.t));
    if (t !== null) await put("caffeine", { ...d, t });
  };
  const remainingBed = caffeineRemaining(doses.map((d) => ({ mg: d.mg, t: d.t })), bedtimeMs(settings), settings.caffeineHalfLifeHours);
  const remainingNow = caffeineRemaining(doses.map((d) => ({ mg: d.mg, t: d.t })), now, settings.caffeineHalfLifeHours);
  return (
    <Sheet title="CAFFEINE" onClose={close}>
      <Field label="TIME TAKEN">
        <input className="input" type="time" value={time} onChange={(e: any) => setTime(e.target.value)} aria-label="time taken" />
      </Field>
      <div className="chips" style={{ marginBottom: 12 }}>
        {[0, 30, 60, 120, 180].map((min) => (
          <button key={min} className="chip" onClick={() => setTime(hhmm(Date.now() - min * 60000))}>
            {min === 0 ? "NOW" : min < 60 ? `−${min} MIN` : `−${min / 60} H`}
          </button>
        ))}
      </div>
      <div className="grid-2">
        {settings.caffeinePresets.map((p) => (
          <button key={p.label} className="btn plain stack" onClick={() => add(p.label, p.mg)} style={{ minHeight: 64 }}>
            <span className="uc">{p.label}</span>
            <span className="sub">{p.mg} MG</span>
          </button>
        ))}
      </div>
      <div className="grid-2" style={{ marginTop: 10, alignItems: "end" }}>
        <Field label="OTHER AMOUNT (MG)">
          <NumInput value={mg} onChange={setMg} decimals={false} ariaLabel="other amount" />
        </Field>
        <button className="btn" style={{ marginBottom: 12 }} disabled={!mg} onClick={() => mg && add("Custom", mg)}>
          [+] ADD
        </button>
      </div>
      <Card title="CAFFEINE LOAD" aside={`HALF-LIFE ${settings.caffeineHalfLifeHours} H`}>
        <div className="grid-2">
          <Stat label="IN SYSTEM NOW" value={`≈${Math.round(remainingNow)} MG`} />
          <Stat label={`AT BEDTIME ${settings.bedtime}`} value={`≈${Math.round(remainingBed)} MG`} />
        </div>
        <div className="desc">
          ESTIMATE · HALF-LIFE <b>{settings.caffeineHalfLifeHours} H</b> · PEOPLE VARY ≈2–10 H · SET IN CONFIG
        </div>
      </Card>
      <Card title="LAST 36 H" aside={doses.length ? `${doses.length} ${doses.length === 1 ? "DOSE" : "DOSES"}` : null} flush>
        {doses.length === 0 ? <div className="empty">NO RECORDS YET.</div> : null}
        {[...doses].sort((a, b) => b.t - a.t).map((d) => (
          <div className="row" key={d.id}>
            <div className="grow">
              <div className="name uc">{d.label}</div>
              <div className="muted small">{shortDateTime(d.t)}</div>
            </div>
            <input className="input tin" type="time" value={hhmm(d.t)} onChange={(e: any) => void setDoseTime(d, e.target.value)} aria-label={`time of ${d.label}`} />
            <div className="num">{d.mg} MG</div>
            <button className="link danger" onClick={() => del("caffeine", d.id)}>
              DEL
            </button>
          </div>
        ))}
      </Card>
    </Sheet>
  );
}

// ---- quick log ----------------------------------------------------------------

export function QuickSheet() {
  const { open, close, goTab, settings } = useUI();
  const hour = localTime(Date.now(), TZ).hour;
  const meal = hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snacks";
  const items: { label: string; sub: string; go: () => void }[] = [
    { label: "WEIGH-IN", sub: "LOG BODYWEIGHT", go: () => open({ kind: "weight" }) },
    { label: "FOOD", sub: `DESCRIBE OR SEARCH · ${meal.toUpperCase()}`, go: () => open({ kind: "food", day: today(settings), meal }) },
    { label: "CHECK-IN", sub: "SLEEP + STATUS", go: () => open({ kind: "checkin" }) },
    { label: "WORKOUT", sub: "START OR CONTINUE", go: () => { close(); goTab("train"); } },
    { label: "CARDIO", sub: "LOG A SESSION", go: () => open({ kind: "cardio" }) },
    { label: "CAFFEINE", sub: "COFFEE · PRE-WORKOUT", go: () => open({ kind: "caffeine" }) },
  ];
  return (
    <Sheet title="LOG" onClose={close}>
      <div className="grid-2">
        {items.map((i, n) => (
          <button key={i.label} className="btn plain stack" style={{ minHeight: 80 }} onClick={i.go}>
            <span style={{ fontSize: 18 }}>
              <span className="num" style={{ color: "inherit" }}>{String(n + 1).padStart(2, "0")}</span> {i.label}
            </span>
            <span className="sub">{i.sub}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---- settings (config terminal) -------------------------------------------------

export function SettingsSheet() {
  const { close, toast } = useUI();
  const settings = useLive(getSettings, [], null as Settings | null);
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const [storage, setStorage] = useState("…");
  const [dirty, setDirty] = useState(false);
  const [display, setDisplay] = useState(readDisplayPrefs);
  useEffect(() => {
    persistenceStatus().then((s) => setStorage(s === "persistent" ? "PROTECTED FROM AUTO-CLEAR" : s === "best-effort" ? "NOT YET PROTECTED" : "UNKNOWN"));
  }, []);
  if (!settings) return null;
  const s = settings;
  const upd = (patch: Partial<Settings>) => {
    setDirty(true);
    return saveSettings(patch);
  };
  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const kg = trend.at(-1)?.trend ?? null;
  const age = new Date().getFullYear() - s.birthYear;
  const rmr = kg !== null ? mifflinStJeor(kg, s.heightCm, age, s.sex) : null;
  const leave = () => {
    if (dirty) toast(">> 061 SETTINGS SAVED");
    close();
  };
  const setFlicker = (on: boolean) => {
    writeDisplayPref("flicker", on ? "1" : "0");
    setDisplay(readDisplayPrefs());
  };
  const setDensity = (d: Density) => {
    writeDisplayPref("density", d);
    setDisplay(readDisplayPrefs());
  };

  const exportJson = async () => {
    const json = await buildBackupJson();
    const r = await shareOrDownload(`janos-backup-${today(s)}.json`, json, "application/json");
    if (r !== "cancelled") {
      await saveSettings({ lastBackupAt: Date.now() });
      toast(">> 071 BACKUP EXPORTED");
    }
  };
  const exportCsv = async () => {
    const data = await buildCsvZip();
    await shareOrDownload(`janos-csv-${today(s)}.zip`, data, "application/zip");
  };
  const restore = async (file: File) => {
    try {
      const backup = JSON.parse(await file.text()) as Backup;
      const ok = await confirmScreen({
        title: "RESTORE",
        message: "PROC 094 RESTORE WILL REPLACE ALL DATA ON THIS PHONE WITH THIS BACKUP.",
        confirmLabel: "REPLACE ALL",
        danger: true,
      });
      if (!ok) return;
      await restoreAll(backup);
      toast("BACKUP RESTORED");
    } catch (e) {
      await confirmScreen({ title: "RESTORE", message: `ERR 072 RESTORE FAILED · ${(e as Error).message}`, confirmLabel: "ACKNOWLEDGE", cancelLabel: false });
    }
  };

  return (
    <Sheet title="CONFIG" onClose={leave} status="AUTO-SAVE" className="cfg" keys={["[ESC] BACK", "[TAB] NEXT", "[SPACE] TOGGLE"]}>
      <fieldset className="mg-fs">
        <legend>1. GARMIN LINK</legend>
        <GarminSyncSection />
      </fieldset>

      <fieldset className="mg-fs">
        <legend>2. PROFILE</legend>
        <Field label="SEX · STARTING CALORIE ESTIMATE">
          <Segmented options={[{ value: "male", label: "MALE" }, { value: "female", label: "FEMALE" }]} value={s.sex} onChange={(v) => upd({ sex: v })} />
        </Field>
        <div className="grid-2">
          <Field label="BIRTH YEAR">
            <NumInput value={s.birthYear} onChange={(v) => v && upd({ birthYear: v })} decimals={false} />
          </Field>
          <Field label="HEIGHT (CM)">
            <NumInput value={s.heightCm} onChange={(v) => v && upd({ heightCm: v })} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="mg-fs">
        <legend>3. UNITS</legend>
        <Field label="BODYWEIGHT">
          <Segmented options={[{ value: "lb", label: "LB" }, { value: "kg", label: "KG" }]} value={s.weightUnit} onChange={(v) => upd({ weightUnit: v })} />
        </Field>
        <Field label="DISTANCE">
          <Segmented options={[{ value: "km", label: "KM" }, { value: "mi", label: "MI" }]} value={s.distanceUnit} onChange={(v) => upd({ distanceUnit: v })} />
        </Field>
      </fieldset>

      <fieldset className="mg-fs">
        <legend>4. TARGETS</legend>
        <Field label="DIET PHASE">
          <Segmented options={[{ value: "cut", label: "CUT" }, { value: "maintain", label: "MAINTAIN" }, { value: "bulk", label: "BULK" }]} value={s.phase} onChange={(v) => upd({ phase: v, goalRatePct: null })} />
        </Field>
        <Field label="GOAL RATE (% BODYWEIGHT / WEEK)">
          <Chips
            options={(s.phase === "cut" ? [-0.25, -0.5, -0.75, -1] : s.phase === "bulk" ? [0.1, 0.25, 0.5] : [0]).map((v) => ({ value: v, label: `${v > 0 ? "+" : ""}${v}%` }))}
            value={s.goalRatePct ?? DEFAULT_RATE_PCT[s.phase]}
            onChange={(v) => upd({ goalRatePct: v })}
          />
        </Field>
        <Check checked={s.autoTargets} onChange={(v) => upd({ autoTargets: v })} label="AUTO TARGETS · WEEKLY CHECK-IN FROM ADAPTIVE EXPENDITURE" />
        {s.autoTargets ? (
          <p className="mg-hint">
            CALORIES, CARBS AND FAT FOLLOW YOUR <b>MEASURED MAINTENANCE</b> (FOOD ON COMPLETE DAYS VS TREND WEIGHT) PLUS THE GOAL RATE. UPDATED WEEKLY WHEN THE WEEK HAS <b>4 COMPLETE DAYS</b> AND <b>1 WEIGH-IN</b>. PROTEIN USES YOUR NUMBER BELOW (DEFAULT <b>1.8 G/KG</b>).
          </p>
        ) : rmr !== null ? (
          <p className="mg-hint">
            STARTING MAINTENANCE ESTIMATE <b>{Math.round((rmr * 1.4) / 10) * 10}–{Math.round((rmr * 1.6) / 10) * 10} KCAL/DAY</b> (MIFFLIN–ST JEOR × 1.4–1.6).
          </p>
        ) : (
          <p className="mg-hint">
            WARN 031 INSUFFICIENT DATA · LOG A <b>WEIGH-IN</b> FOR A STARTING CALORIE ESTIMATE.
          </p>
        )}
        <div className="grid-2">
          {!s.autoTargets ? (
            <Field label="CALORIES (KCAL/DAY)">
              <NumInput value={s.kcalTarget} onChange={(v) => upd({ kcalTarget: v })} decimals={false} placeholder="2600" />
            </Field>
          ) : null}
          <Field label="PROTEIN (G/DAY)">
            <NumInput value={s.proteinTarget} onChange={(v) => upd({ proteinTarget: v })} decimals={false} />
          </Field>
          {!s.autoTargets ? (
            <>
              <Field label="CARBS (G/DAY · OPT)">
                <NumInput value={s.carbTarget} onChange={(v) => upd({ carbTarget: v })} decimals={false} />
              </Field>
              <Field label="FAT (G/DAY · OPT)">
                <NumInput value={s.fatTarget} onChange={(v) => upd({ fatTarget: v })} decimals={false} />
              </Field>
            </>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="mg-fs">
        <legend>5. SLEEP + CAFFEINE</legend>
        <div className="grid-2">
          <Field label="SLEEP NEED (H)">
            <NumInput value={s.sleepNeedHours} onChange={(v) => v && upd({ sleepNeedHours: v })} />
          </Field>
          <Field label="USUAL BEDTIME">
            <input className="input" type="time" value={s.bedtime} onChange={(e: any) => e.target.value && upd({ bedtime: e.target.value })} />
          </Field>
          <Field label="CAFFEINE HALF-LIFE (H)">
            <NumInput value={s.caffeineHalfLifeHours} onChange={(v) => v && upd({ caffeineHalfLifeHours: v })} />
          </Field>
          <Field label="REST TIMER (S)">
            <NumInput value={s.restSeconds} onChange={(v) => v && upd({ restSeconds: v })} decimals={false} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="mg-fs">
        <legend>6. DISPLAY</legend>
        <Check checked={display.flicker} onChange={setFlicker} label="RAPID FLICKER (FLASHING — TURN OFF IF SENSITIVE)" />
        <Field label="RASTER DENSITY">
          <Segmented
            options={[
              { value: "coarse", label: "COARSE" },
              { value: "medium", label: "MEDIUM" },
              { value: "fine", label: "FINE" },
            ]}
            value={display.density}
            onChange={setDensity}
          />
        </Field>
        <p className="mg-hint">
          STORED ON THIS DEVICE ONLY. THE PHONE&apos;S <b>REDUCE MOTION</b> SETTING ALSO STOPS FLICKER AND BLINK.
        </p>
      </fieldset>

      <fieldset className="mg-fs">
        <legend>7. AI FOOD LOGGING</legend>
        <AiSection />
      </fieldset>

      <fieldset className="mg-fs">
        <legend>8. DATA</legend>
        <p className="mg-hint">
          ALL DATA IS STORED ONLY ON THIS IPHONE. EXPORT A BACKUP REGULARLY AND SAVE IT TO <b>FILES</b> OR <b>ICLOUD DRIVE</b>.
        </p>
        <div className="kv">
          <span>LAST BACKUP</span>
          <b>{s.lastBackupAt ? shortDateTime(s.lastBackupAt) : "NONE"}</b>
        </div>
        <div className="kv" style={{ marginBottom: 10 }}>
          <span>STORAGE</span>
          <b>{storage}</b>
        </div>
        <button className="btn block" onClick={exportJson}>EXPORT FULL BACKUP (JSON)</button>
        <div className="gap" />
        <button className="btn secondary block" onClick={exportCsv}>EXPORT SPREADSHEETS (CSV ZIP)</button>
        <div className="gap" />
        <label className="btn plain block">
          RESTORE FROM BACKUP…
          <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e: any) => e.target.files?.[0] && restore(e.target.files[0])} />
        </label>
      </fieldset>
      <div className="foot-note">JANOS HEALTH V0.1 · NO ACCOUNTS · NO TRACKING · BARCODE DATA: OPEN FOOD FACTS (ODBL)</div>
    </Sheet>
  );
}

export const yesterday = (settings: Settings) => addDays(today(settings), -1);

// ---- Garmin sync --------------------------------------------------------------

const lampColor = { on: "var(--grn)", warn: "var(--am)", off: "var(--red)" } as const;

function GarminSyncSection() {
  const { toast } = useUI();
  const key = useLive(getGarminKey, [], null as string | null);
  const status = useLive(getGarminStatus, [], null as GarminStatus | null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const link = garminLink(key, status);
  const code = garminMessageCode(status?.message);

  const copy = async (k: string) => {
    try {
      await navigator.clipboard.writeText(k);
      toast("KEY COPIED · PASTE IT INTO GITHUB AS JANOS_DATA_KEY");
    } catch {
      setReveal(true);
      toast("COPY BLOCKED · SELECT THE KEY AND COPY IT");
    }
  };

  return (
    <>
      {!key ? (
        <>
          <p className="mg-hint">
            CREATE A PRIVATE SYNC KEY (STEP 4 IN <b>SETUP.MD</b>). <span className="blu">GARMIN</span> DATA IS STORED ENCRYPTED WITH IT; ONLY THIS PHONE CAN READ IT.
          </p>
          <button
            className="btn block"
            onClick={async () => {
              const k = await createGarminKey();
              setReveal(true);
              await copy(k);
            }}
          >
            CREATE SYNC KEY + COPY
          </button>
          <div className="gap" />
          <button className="btn plain block" onClick={() => setPasting(true)}>I ALREADY HAVE A KEY</button>
        </>
      ) : (
        <>
          <div className="subcard mg-brk">
            <div className="sct">
              <span className="id">GARMIN · GITHUB SYNC</span>
              <span className="st" style={{ color: lampColor[link.lamp] }}>● {link.label}</span>
            </div>
            <div className="kv">
              <span>STATUS</span>
              <b>{status?.lastSuccess ? "CONNECTED" : "KEY CREATED"}</b>
            </div>
            <div className="kv">
              <span>DATA FROM</span>
              <b>{status?.generatedAt ? shortDateTime(Date.parse(status.generatedAt)) : "NO DATA YET"}</b>
            </div>
            {status?.lastSuccess ? (
              <>
                <div className="kv">
                  <span>SYNCED</span>
                  <b>
                    {status.days} DAYS · {status.activities} ACTIVITIES
                  </b>
                </div>
                <div className="kv">
                  <span>CHECKED</span>
                  <b>{shortDateTime(status.lastSuccess)}</b>
                </div>
                {status.lastErrors.length ? (
                  <div className="kv">
                    <span>LAST RUN</span>
                    <b>{status.lastErrors.length} MINOR ERROR{status.lastErrors.length > 1 ? "S" : ""}</b>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {status?.lastSuccess && status.lastErrors.length ? (
            <p className="mg-hint">MINOR ERRORS USUALLY MEAN A METRIC YOUR WATCH DOES NOT RECORD.</p>
          ) : null}
          {status?.message ? (
            <div className={code?.startsWith("ERR") ? "notice err" : "notice warn"}>
              <span className="msg">{code}</span>
              <span className="act">{status.message}</span>
            </div>
          ) : null}
          <div className="field" style={{ marginBottom: 0 }}>
            <span>
              SYNC KEY · GITHUB SECRET <b className="blu" style={{ fontWeight: 400 }}>JANOS_DATA_KEY</b>
            </span>
          </div>
          <div className="keybox">{reveal ? key : "•".repeat(20) + key.slice(-4)}</div>
          <div className="grid-2">
            <button className="btn plain" onClick={() => setReveal(!reveal)}>{reveal ? "HIDE" : "SHOW"}</button>
            <button className="btn plain" onClick={() => copy(key)}>COPY</button>
          </div>
          <div className="gap" />
          <button
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const st = await syncGarmin(true);
              setBusy(false);
              toast(st.message ? garminMessageCode(st.message) ?? st.message : `>> 005 GARMIN DATA RECEIVED · ${st.days} DAYS`);
            }}
          >
            {busy ? "CHECKING…" : "CHECK FOR GARMIN DATA NOW"}
          </button>
          <div className="gap" />
          <button className="btn plain block" onClick={() => setPasting(true)}>REPLACE KEY</button>
        </>
      )}
      {pasting ? (
        <div style={{ marginTop: 12 }}>
          <Field label="PASTE THE KEY (44 CHARACTERS)">
            <input className="input" value={pasted} onChange={(e: any) => setPasted(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </Field>
          <button
            className="btn block"
            onClick={async () => {
              try {
                await setGarminKey(pasted);
                setPasting(false);
                setPasted("");
                toast(">> 061 SETTINGS SAVED · SYNC KEY STORED");
                void syncGarmin(true);
              } catch (e) {
                toast(`ERR 021 SYNC KEY INVALID · ${(e as Error).message}`);
              }
            }}
          >
            SAVE KEY
          </button>
        </div>
      ) : null}
    </>
  );
}

// ---- AI food logging -----------------------------------------------------------

function AiSection() {
  const { toast } = useUI();
  const cfg = useLive(getAiConfig, [], null as AiConfig | null);
  const [key, setKey] = useState("");
  const [other, setOther] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const save = async () => {
    const k = key.trim() || cfg?.key || "";
    if (!k) return;
    await setAiConfig({ key: k, baseUrl: baseUrl.trim() || cfg?.baseUrl || AI_DEFAULTS.baseUrl, model: model.trim() || cfg?.model || AI_DEFAULTS.model });
    setKey("");
    setResult(null);
    toast(">> 061 AI KEY SAVED · TAP TEST");
  };
  const test = async () => {
    if (!cfg) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await analyzeMeal("1 medium banana", cfg, null);
      setResult(`>> 016 AI LINK OK · 1 MEDIUM BANANA ≈ ${Math.round(totalOf(r.items).kcal)} KCAL`);
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {cfg ? (
        <>
          <div className="kv">
            <span>KEY</span>
            <b>{maskKey(cfg.key)}</b>
          </div>
          <div className="kv" style={{ marginBottom: 10 }}>
            <span>MODEL</span>
            <b className="uc">{cfg.model}</b>
          </div>
          <div className="grid-2">
            <button className="btn" disabled={busy} onClick={test}>{busy ? "TESTING…" : "TEST"}</button>
            <button
              className="btn plain"
              onClick={async () => {
                const ok = await confirmScreen({ title: "AI KEY", message: "REMOVE THE AI KEY FROM THIS PHONE?", confirmLabel: "REMOVE", danger: true, alarm: false });
                if (ok) {
                  await setAiConfig(null);
                  setResult(null);
                  toast("AI KEY REMOVED");
                }
              }}
            >
              REMOVE KEY
            </button>
          </div>
          {result ? (
            <div className={result.startsWith(">>") ? "notice ok" : result.startsWith("ERR") ? "notice err" : "notice warn"} style={{ marginTop: 10 }}>
              <span className="msg">{result}</span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="mg-hint">
            TYPE WHAT YOU ATE ON THE FOOD TAB AND AN AI WORKS OUT THE MACROS. ONE-TIME SETUP WITH A FREE <b>GROQ</b> KEY:
            <br />1. OPEN <b>CONSOLE.GROQ.COM/KEYS</b> AND SIGN IN (GOOGLE WORKS).
            <br />2. TAP <b>CREATE API KEY</b>, NAME IT JANOS, COPY THE KEY.
            <br />3. PASTE IT BELOW, TAP <b>SAVE</b>, THEN <b>TEST</b>.
          </p>
          <a className="btn secondary block" href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
            OPEN GROQ CONSOLE
          </a>
          <div className="gap" />
        </>
      )}
      <Field label={cfg ? "REPLACE KEY" : "GROQ API KEY"}>
        <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="gsk_…" aria-label="ai key" value={key} onChange={(e: any) => setKey(e.target.value)} />
      </Field>
      <Check checked={other} onChange={setOther} label="OTHER PROVIDER OR MODEL (OPENAI-COMPATIBLE)" />
      {other ? (
        <>
          <Field label="BASE URL">
            <input className="input" autoComplete="off" spellCheck={false} placeholder={cfg?.baseUrl ?? AI_DEFAULTS.baseUrl} aria-label="ai base url" value={baseUrl} onChange={(e: any) => setBaseUrl(e.target.value)} />
          </Field>
          <Field label="MODEL">
            <input className="input" autoComplete="off" spellCheck={false} placeholder={cfg?.model ?? AI_DEFAULTS.model} aria-label="ai model" value={model} onChange={(e: any) => setModel(e.target.value)} />
          </Field>
        </>
      ) : null}
      <button className="btn block" disabled={!key.trim() && !(cfg && (baseUrl.trim() || model.trim()))} onClick={save}>SAVE</button>
      <p className="mg-hint">
        WHAT YOU TYPE IS SENT TO THE AI SERVICE TO BE ANALYZED. THE KEY STAYS ON THIS PHONE AND IS <b>NOT</b> PUT IN BACKUPS.
      </p>
    </>
  );
}
