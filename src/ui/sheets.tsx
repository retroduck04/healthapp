// Small sheets: weigh-in, morning check-in, caffeine, quick log and settings.

import { useEffect, useState } from "react";
import { del, get, persistenceStatus, put, restoreAll, uid, useLive, type Backup } from "../db/db";
import { buildBackupJson, buildCsvZip, shareOrDownload } from "../db/exporters";
import { createGarminKey, getGarminKey, getGarminStatus, setGarminKey, syncGarmin, type GarminStatus } from "../db/garmin";
import { addWeight, getSettings, listCaffeine, listWeights, saveSettings, today, TZ } from "../db/repo";
import type { CaffeineEntry, CheckIn, Settings, WeightEntry } from "../db/types";
import { addDays, localTime } from "../engine/dates";
import { caffeineRemaining, mifflinStJeor } from "../engine/sleep";
import { fmt } from "../engine/units";
import { checkWeightEntry, weightTrend } from "../engine/weight";
import { dayLabel, durationFromClock, hoursText, shortDateTime, weightFromDisplay, weightText, weightToDisplay } from "./format";
import { Card, Chips, Field, NumInput, Segmented, Sheet, useUI } from "./kit";

// ---- weigh-in ---------------------------------------------------------------

export function WeightSheet() {
  const { settings, close, toast } = useUI();
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const last = weights.at(-1);
  const ref = trend.length ? weightToDisplay(trend.at(-1)!.trend, settings) : null;
  const [value, setValue] = useState<number | null>(null);
  const [warning, setWarning] = useState<{ reason: string; suggestion: number | null } | null>(null);
  useEffect(() => {
    if (value === null && last) setValue(Math.round(weightToDisplay(last.kg, settings) * 10) / 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  const save = async (v: number, force = false) => {
    if (!force) {
      const verdict = checkWeightEntry(v, ref, settings.weightUnit === "lb");
      if (!verdict.ok) {
        setWarning({ reason: verdict.reason, suggestion: verdict.suggestion });
        return;
      }
    }
    const w = await addWeight(weightFromDisplay(v, settings));
    toast(`Saved ${fmt(v)} ${settings.weightUnit}`, () => void del("weights", w.id));
    close();
  };

  return (
    <Sheet
      title="Weigh-in"
      onClose={close}
      footer={
        <button className="btn block xl" disabled={value === null} onClick={() => value !== null && save(value)}>
          Save
        </button>
      }
    >
      <Field label={`Weight (${settings.weightUnit})`}>
        <NumInput big value={value} onChange={(v) => { setValue(v); setWarning(null); }} ariaLabel="weight" autoFocus />
      </Field>
      {ref !== null ? <div className="muted small" style={{ textAlign: "center" }}>Trend weight: {fmt(ref)} {settings.weightUnit}</div> : null}
      {warning ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>{warning.reason}</div>
          <div className="chips">
            {warning.suggestion !== null ? (
              <button className="btn sm" onClick={() => save(warning.suggestion!, true)}>
                Use {fmt(warning.suggestion)} {settings.weightUnit}
              </button>
            ) : null}
            <button className="btn sm plain" onClick={() => value !== null && save(value, true)}>
              Save {value} anyway
            </button>
          </div>
        </div>
      ) : null}
      <h2>Recent</h2>
      <div className="card tight">
        {weights.length === 0 ? <div className="empty">No weigh-ins yet.</div> : null}
        {[...weights].reverse().slice(0, 10).map((w) => (
          <div className="row" key={w.id}>
            <div className="grow">{shortDateTime(w.t)}</div>
            <div className="num">{weightText(w.kg, settings)}</div>
            <button
              className="link"
              style={{ color: "var(--danger)" }}
              onClick={async () => {
                await del("weights", w.id);
                toast("Weigh-in deleted", () => void put("weights", w));
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
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
    toast("Check-in saved");
    close();
  };

  return (
    <Sheet title={`Check-in · ${dayLabel(day, today(settings))}`} onClose={close} footer={<button className="btn block xl" onClick={save}>Save</button>}>
      <h2 style={{ marginTop: 4 }}>Sleep (from your Garmin)</h2>
      <div className="grid-2">
        <Field label="Hours">
          <NumInput value={hours} onChange={setHours} decimals={false} placeholder="7" ariaLabel="sleep hours" />
        </Field>
        <Field label="Minutes">
          <NumInput value={minutes} onChange={setMinutes} decimals={false} placeholder="30" ariaLabel="sleep minutes" />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Fell asleep">
          <input className="input" type="time" value={c.bedtime ?? ""} onChange={(e: any) => set("bedtime", e.target.value || null)} />
        </Field>
        <Field label="Woke up">
          <input className="input" type="time" value={c.wakeTime ?? ""} onChange={(e: any) => set("wakeTime", e.target.value || null)} />
        </Field>
      </div>
      {sleepHours !== null ? <div className="muted small" style={{ marginBottom: 8 }}>Sleep: {hoursText(sleepHours)}{typed === null ? " (from the times)" : ""}</div> : null}
      <Field label="Naps yesterday (minutes)">
        <NumInput value={c.napMinutes ?? null} onChange={(v) => set("napMinutes", v)} decimals={false} placeholder="0" />
      </Field>

      <h2>How do you feel? (optional)</h2>
      <Field label="Energy (1 = drained, 5 = great)">
        <Chips options={scale5} value={c.energy ?? null} onChange={(v) => set("energy", v)} allowNone />
      </Field>
      <Field label="Soreness (1 = none, 5 = very sore)">
        <Chips options={scale5} value={c.soreness ?? null} onChange={(v) => set("soreness", v)} allowNone />
      </Field>
      <Field label="Stress (1 = calm, 5 = very stressed)">
        <Chips options={scale5} value={c.stress ?? null} onChange={(v) => set("stress", v)} allowNone />
      </Field>
      <Field label="Feeling ill?">
        <Chips options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} value={c.ill ? "yes" : "no"} onChange={(v) => set("ill", v === "yes")} />
      </Field>

      {showGarmin ? (
        <>
          <h2>Garmin numbers (optional)</h2>
          <div className="grid-2">
            <Field label="Sleep score">
              <NumInput value={c.sleepScore ?? null} onChange={(v) => set("sleepScore", v)} decimals={false} />
            </Field>
            <Field label="Overnight HRV (ms)">
              <NumInput value={c.hrv ?? null} onChange={(v) => set("hrv", v)} decimals={false} />
            </Field>
            <Field label="Resting HR (bpm)">
              <NumInput value={c.restingHR ?? null} onChange={(v) => set("restingHR", v)} decimals={false} />
            </Field>
            <Field label="Body Battery">
              <NumInput value={c.bodyBattery ?? null} onChange={(v) => set("bodyBattery", v)} decimals={false} />
            </Field>
          </div>
        </>
      ) : (
        <button className="btn plain block" onClick={() => setShowGarmin(true)}>
          Add Garmin numbers (HRV, resting HR, Body Battery, sleep score)
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

export function CaffeineSheet() {
  const { settings, close, toast } = useUI();
  const since = Date.now() - 36 * 3600000;
  const doses = useLive(() => listCaffeine(since), [], [] as CaffeineEntry[]);
  const [mg, setMg] = useState<number | null>(null);
  const now = Date.now();
  const add = async (label: string, amount: number) => {
    const e: CaffeineEntry = { id: uid(), t: Date.now(), mg: amount, label };
    await put("caffeine", e);
    toast(`${label}: ${amount} mg`, () => void del("caffeine", e.id));
  };
  const remainingBed = caffeineRemaining(doses.map((d) => ({ mg: d.mg, t: d.t })), bedtimeMs(settings), settings.caffeineHalfLifeHours);
  const remainingNow = caffeineRemaining(doses.map((d) => ({ mg: d.mg, t: d.t })), now, settings.caffeineHalfLifeHours);
  return (
    <Sheet title="Caffeine" onClose={close}>
      <div className="grid-2">
        {settings.caffeinePresets.map((p) => (
          <button key={p.label} className="btn plain" onClick={() => add(p.label, p.mg)} style={{ minHeight: 64, flexDirection: "column", gap: 0 }}>
            <span>{p.label}</span>
            <span className="muted small">{p.mg} mg</span>
          </button>
        ))}
      </div>
      <div className="grid-2" style={{ marginTop: 10, alignItems: "end" }}>
        <Field label="Other amount (mg)">
          <NumInput value={mg} onChange={setMg} decimals={false} />
        </Field>
        <button className="btn" style={{ marginBottom: 12 }} disabled={!mg} onClick={() => mg && add("Custom", mg)}>
          Add
        </button>
      </div>
      <Card>
        <div className="grid-2">
          <div className="stat">
            <div className="label">In your system now</div>
            <div className="value">≈ {Math.round(remainingNow)} mg</div>
          </div>
          <div className="stat">
            <div className="label">At bedtime ({settings.bedtime})</div>
            <div className="value">≈ {Math.round(remainingBed)} mg</div>
          </div>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          Estimate with a {settings.caffeineHalfLifeHours}-hour half-life. People differ a lot (roughly 2–10 h); change it in Settings.
        </div>
      </Card>
      <h2>Last 36 hours</h2>
      <div className="card tight">
        {doses.length === 0 ? <div className="empty">Nothing logged.</div> : null}
        {[...doses].sort((a, b) => b.t - a.t).map((d) => (
          <div className="row" key={d.id}>
            <div className="grow">{d.label}</div>
            <div className="muted small">{shortDateTime(d.t)}</div>
            <div className="num">{d.mg} mg</div>
            <button className="link" style={{ color: "var(--danger)" }} onClick={() => del("caffeine", d.id)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ---- quick log ----------------------------------------------------------------

export function QuickSheet() {
  const { open, close, goTab, settings } = useUI();
  const hour = localTime(Date.now(), TZ).hour;
  const meal = hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snacks";
  const items: { label: string; sub: string; go: () => void }[] = [
    { label: "Weigh-in", sub: "Log bodyweight", go: () => open({ kind: "weight" }) },
    { label: "Food", sub: `Add to ${meal}`, go: () => open({ kind: "food", day: today(settings), meal }) },
    { label: "Check-in", sub: "Sleep and how you feel", go: () => open({ kind: "checkin" }) },
    { label: "Workout", sub: "Start or continue", go: () => { close(); goTab("train"); } },
    { label: "Cardio", sub: "Log a session", go: () => open({ kind: "cardio" }) },
    { label: "Caffeine", sub: "Coffee, pre-workout…", go: () => open({ kind: "caffeine" }) },
  ];
  return (
    <Sheet title="Log" onClose={close}>
      <div className="grid-2">
        {items.map((i) => (
          <button key={i.label} className="btn plain" style={{ minHeight: 84, flexDirection: "column", gap: 2 }} onClick={i.go}>
            <span style={{ fontSize: 18 }}>{i.label}</span>
            <span className="muted small" style={{ fontWeight: 400 }}>{i.sub}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---- settings -----------------------------------------------------------------

export function SettingsSheet() {
  const { close, toast } = useUI();
  const settings = useLive(getSettings, [], null as Settings | null);
  const weights = useLive(listWeights, [], [] as WeightEntry[]);
  const [storage, setStorage] = useState("…");
  useEffect(() => {
    persistenceStatus().then((s) => setStorage(s === "persistent" ? "Protected from automatic clearing" : s === "best-effort" ? "Not yet protected (it will ask when needed)" : "Unknown"));
  }, []);
  if (!settings) return null;
  const s = settings;
  const upd = (patch: Partial<Settings>) => saveSettings(patch);
  const trend = weightTrend(weights.map((w) => ({ t: w.t, kg: w.kg })));
  const kg = trend.at(-1)?.trend ?? null;
  const age = new Date().getFullYear() - s.birthYear;
  const rmr = kg !== null ? mifflinStJeor(kg, s.heightCm, age, s.sex) : null;

  const exportJson = async () => {
    const json = await buildBackupJson();
    const r = await shareOrDownload(`janos-backup-${today(s)}.json`, json, "application/json");
    if (r !== "cancelled") {
      await saveSettings({ lastBackupAt: Date.now() });
      toast("Backup exported");
    }
  };
  const exportCsv = async () => {
    const data = await buildCsvZip();
    await shareOrDownload(`janos-csv-${today(s)}.zip`, data, "application/zip");
  };
  const restore = async (file: File) => {
    try {
      const backup = JSON.parse(await file.text()) as Backup;
      if (!confirm("Replace ALL data on this phone with this backup?")) return;
      await restoreAll(backup);
      toast("Backup restored");
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <Sheet title="Settings" onClose={close}>
      <GarminSyncSection />
      <h2>You</h2>
      <Field label="Sex (for the starting calorie estimate)">
        <Segmented options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} value={s.sex} onChange={(v) => upd({ sex: v })} />
      </Field>
      <div className="grid-2">
        <Field label="Birth year">
          <NumInput value={s.birthYear} onChange={(v) => v && upd({ birthYear: v })} decimals={false} />
        </Field>
        <Field label="Height (cm)">
          <NumInput value={s.heightCm} onChange={(v) => v && upd({ heightCm: v })} />
        </Field>
      </div>

      <h2>Units</h2>
      <Field label="Bodyweight">
        <Segmented options={[{ value: "lb", label: "Pounds" }, { value: "kg", label: "Kilograms" }]} value={s.weightUnit} onChange={(v) => upd({ weightUnit: v })} />
      </Field>
      <Field label="Distance">
        <Segmented options={[{ value: "km", label: "Kilometres" }, { value: "mi", label: "Miles" }]} value={s.distanceUnit} onChange={(v) => upd({ distanceUnit: v })} />
      </Field>

      <h2>Nutrition targets</h2>
      <Field label="Diet phase">
        <Segmented options={[{ value: "cut", label: "Cut" }, { value: "maintain", label: "Maintain" }, { value: "bulk", label: "Bulk" }]} value={s.phase} onChange={(v) => upd({ phase: v })} />
      </Field>
      {rmr !== null ? (
        <div className="notice">
          Starting estimate of maintenance: <b>{Math.round((rmr * 1.4) / 10) * 10}–{Math.round((rmr * 1.6) / 10) * 10} kcal/day</b> (Mifflin–St Jeor × 1.4–1.6). The app will learn your real number from your logs and weight trend.
        </div>
      ) : (
        <div className="notice">Log a weigh-in to see a starting calorie estimate.</div>
      )}
      <div className="grid-2">
        <Field label="Calories (kcal/day)">
          <NumInput value={s.kcalTarget} onChange={(v) => upd({ kcalTarget: v })} decimals={false} placeholder="e.g. 2600" />
        </Field>
        <Field label="Protein (g/day)">
          <NumInput value={s.proteinTarget} onChange={(v) => upd({ proteinTarget: v })} decimals={false} />
        </Field>
        <Field label="Carbs (g/day, optional)">
          <NumInput value={s.carbTarget} onChange={(v) => upd({ carbTarget: v })} decimals={false} />
        </Field>
        <Field label="Fat (g/day, optional)">
          <NumInput value={s.fatTarget} onChange={(v) => upd({ fatTarget: v })} decimals={false} />
        </Field>
      </div>

      <h2>Sleep and caffeine</h2>
      <div className="grid-2">
        <Field label="Sleep need (hours)">
          <NumInput value={s.sleepNeedHours} onChange={(v) => v && upd({ sleepNeedHours: v })} />
        </Field>
        <Field label="Usual bedtime">
          <input className="input" type="time" value={s.bedtime} onChange={(e: any) => e.target.value && upd({ bedtime: e.target.value })} />
        </Field>
        <Field label="Caffeine half-life (h)">
          <NumInput value={s.caffeineHalfLifeHours} onChange={(v) => v && upd({ caffeineHalfLifeHours: v })} />
        </Field>
        <Field label="Rest timer (seconds)">
          <NumInput value={s.restSeconds} onChange={(v) => v && upd({ restSeconds: v })} decimals={false} />
        </Field>
      </div>

      <h2>Your data</h2>
      <div className="card">
        <div className="small muted" style={{ marginBottom: 10 }}>
          Everything is stored only on this iPhone. Export a backup regularly and save it to Files or iCloud Drive.
          {s.lastBackupAt ? ` Last backup: ${shortDateTime(s.lastBackupAt)}.` : " No backup yet."}
        </div>
        <button className="btn block" onClick={exportJson}>Export full backup (JSON)</button>
        <div style={{ height: 8 }} />
        <button className="btn secondary block" onClick={exportCsv}>Export spreadsheets (CSV zip)</button>
        <div style={{ height: 8 }} />
        <label className="btn plain block">
          Restore from backup…
          <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e: any) => e.target.files?.[0] && restore(e.target.files[0])} />
        </label>
        <div className="small muted" style={{ marginTop: 10 }}>Storage: {storage}</div>
      </div>
      <div className="muted small" style={{ textAlign: "center", margin: "16px 0" }}>
        Janos Health v0.1 · No accounts, no tracking. Barcode lookups use Open Food Facts (ODbL).
      </div>
    </Sheet>
  );
}

export const yesterday = (settings: Settings) => addDays(today(settings), -1);

// ---- Garmin sync --------------------------------------------------------------

function GarminSyncSection() {
  const { toast } = useUI();
  const key = useLive(getGarminKey, [], null as string | null);
  const status = useLive(getGarminStatus, [], null as GarminStatus | null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  const copy = async (k: string) => {
    try {
      await navigator.clipboard.writeText(k);
      toast("Key copied. Paste it into GitHub as JANOS_DATA_KEY.");
    } catch {
      setReveal(true);
      toast("Couldn't copy automatically; select the key and copy it.");
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 4 }}>Garmin sync</h2>
      <div className="card">
        {!key ? (
          <>
            <div className="small" style={{ marginBottom: 10 }}>
              Create a private key (step 4 in SETUP.md). Your Garmin data is stored encrypted with it, and only this phone can read it.
            </div>
            <button
              className="btn block"
              onClick={async () => {
                const k = await createGarminKey();
                setReveal(true);
                await copy(k);
              }}
            >
              Create sync key and copy it
            </button>
            <div style={{ height: 8 }} />
            <button className="btn plain block" onClick={() => setPasting(true)}>I already have a key</button>
          </>
        ) : (
          <>
            <div className="card-head">
              <div className="title">
                {status?.lastSuccess ? "Connected" : "Key created"}
              </div>
              <div className="muted small">
                {status?.generatedAt ? `Garmin data from ${shortDateTime(Date.parse(status.generatedAt))}` : "No data yet"}
              </div>
            </div>
            {status?.message ? <div className="notice warn">{status.message}</div> : null}
            {status?.lastSuccess ? (
              <div className="muted small" style={{ marginBottom: 10 }}>
                {status.days} days and {status.activities} activities synced. Checked {shortDateTime(status.lastSuccess)}.
                {status.lastErrors.length ? ` The last GitHub run had ${status.lastErrors.length} minor error${status.lastErrors.length > 1 ? "s" : ""} (usually a metric your watch doesn't record).` : ""}
              </div>
            ) : null}
            <div className="small muted" style={{ marginBottom: 6 }}>Sync key (GitHub secret JANOS_DATA_KEY):</div>
            <div className="input" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, wordBreak: "break-all", userSelect: "all", minHeight: 0 }}>
              {reveal ? key : "•".repeat(20) + key.slice(-4)}
            </div>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <button className="btn plain" onClick={() => setReveal(!reveal)}>{reveal ? "Hide" : "Show"}</button>
              <button className="btn plain" onClick={() => copy(key)}>Copy</button>
            </div>
            <div style={{ height: 8 }} />
            <button
              className="btn block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const s = await syncGarmin(true);
                setBusy(false);
                toast(s.message ?? `Garmin data updated (${s.days} days)`);
              }}
            >
              {busy ? "Checking…" : "Check for new Garmin data now"}
            </button>
            <div style={{ height: 8 }} />
            <button className="btn plain block" onClick={() => setPasting(true)}>Replace key</button>
          </>
        )}
        {pasting ? (
          <div style={{ marginTop: 12 }}>
            <Field label="Paste the key (44 characters)">
              <input className="input" value={pasted} onChange={(e: any) => setPasted(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </Field>
            <button
              className="btn block"
              onClick={async () => {
                try {
                  await setGarminKey(pasted);
                  setPasting(false);
                  setPasted("");
                  toast("Key saved");
                  void syncGarmin(true);
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              Save key
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
