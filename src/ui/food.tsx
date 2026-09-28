// Food tab and the add-food sheet.

import { useMemo, useState } from "react";
import { put, uid, useLive } from "../db/db";
import {
  addEntry,
  addFoodEntry,
  addSavedMeal,
  allFoods,
  copyMeal,
  dayStatus,
  deleteEntry,
  entriesForDay,
  listSavedMeals,
  lookupBarcode,
  saveFood,
  saveMealFrom,
  scale,
  setDayComplete,
  sumNutrients,
  today,
} from "../db/repo";
import { MEALS, type DayStatus, type Food, type FoodEntry, type Meal, type SavedMeal } from "../db/types";
import { addDays } from "../engine/dates";
import { fmt } from "../engine/units";
import { BarcodeScanner } from "./barcode";
import { dayLabel, longDate } from "./format";
import { Card, Chips, Field, fmtKcal, NumInput, PageTitle, promptScreen, Segmented, Sheet, Stat, useUI } from "./kit";
import { loadEnergyModel, pad, runWeeklyCheckIn, signed, type EnergyModel } from "./models";
import { MeterPanel, type MeterRow } from "./raster";

/** One intake meter row; `capped` macros turn red when more than 3 % over target (protein never does). */
function macroRow(id2: string, name: string, value: number, target: number | null, unit: string, capped: boolean): MeterRow {
  const v = Math.round(value);
  if (!target) return { id2, name, value: v, max: Math.max(v, 1), line: `${name} ${pad(v, unit === "KCAL" ? 4 : 3)} ${unit} · NO TARGET`, right: "---", tone: "dim" };
  const pct = Math.round((value / target) * 100);
  const overBy = value > target * 1.03;
  return {
    id2,
    name,
    value: Math.min(value, target * 1.2),
    max: target,
    line: `${name} ${pad(v, unit === "KCAL" ? 4 : 3)}/${pad(target, unit === "KCAL" ? 4 : 3)} ${unit}${overBy && capped ? " · OVER" : ""}`,
    right: `${pad(pct, 3)}%`,
    tone: overBy ? (capped ? "red" : "grn") : pct >= 97 ? "grn" : "bands",
  };
}

const CONF: Record<string, string> = { prior: "PRIOR ONLY", low: "LOW", medium: "MEDIUM", high: "HIGH" };

/** Adaptive expenditure (MacroFactor-style) and the weekly check-in that sets the targets. */
function ExpenditureCard(props: { m: EnergyModel }) {
  const { settings, toast, open } = useUI();
  const m = props.m;
  const cur = m.current;
  const est = Math.round(cur?.kcal ?? m.prior);
  const half = cur ? Math.round((cur.high - cur.low) / 2) : Math.round(m.prior * 0.15);
  const ci = m.checkIn;
  const next = ci ? addDays(ci.day, 7) : null;
  return (
    <Card title="JANOS-SYS/EXPENDITURE" status={cur ? `CONFIDENCE ${CONF[cur.confidence]}` : "PRIOR ONLY"}>
      <div className="grid-2">
        <Stat label="MAINTENANCE ≈" value={`${pad(est, 4)} KCAL`} sub={`±${half} (80 % RANGE)${cur?.paused ? " · HELD" : ""}`} />
        <Stat
          label={settings.autoTargets ? "AUTO TARGET" : "TARGET"}
          value={m.targets.kcal ? `${pad(m.targets.kcal, 4)} KCAL` : "---"}
          sub={
            m.targets.kcal
              ? `${signed(m.targets.kcal - est)} VS MAINTENANCE · ${settings.phase.toUpperCase()}`
              : "NO TARGET SET"
          }
        />
      </div>
      <div className="desc">
        {cur && cur.confidence !== "prior"
          ? `FROM ${cur.completeDays} COMPLETE FOOD DAYS AND YOUR TREND WEIGHT (LAST 21 D). `
          : `WARN 031 LEARNING · ${cur?.completeDays ?? 0}/7 COMPLETE DAYS · STARTING GUESS FROM ${m.priorSource === "GARMIN" ? "GARMIN CALORIES" : "HEIGHT, WEIGHT AND AGE"}. `}
        {settings.autoTargets
          ? ci
            ? `CHECK-IN ${ci.day} · NEXT ${next}${m.checkInState.due && !m.checkInState.ready ? ` · WAITING: ${m.checkInState.missing}` : ""}.`
            : "FIRST TARGETS ARRIVE WITH YOUR FIRST WEIGH-IN."
          : "AUTO TARGETS ARE OFF (CONFIG → TARGETS)."}
      </div>
      <div className="rowbar">
        {settings.autoTargets ? (
          <button
            className="link"
            onClick={async () => {
              const rec = await runWeeklyCheckIn(settings, true);
              toast(rec ? `>> 096 CHECK-IN · TARGET ${rec.kcal} KCAL · P ${rec.proteinG} · C ${rec.carbG} · F ${rec.fatG} G` : "WARN 031 NO WEIGH-IN YET");
            }}
          >
            RUN CHECK-IN NOW
          </button>
        ) : null}
        <div className="grow" />
        <button className="link" onClick={() => open({ kind: "settings" })}>GOAL SETTINGS</button>
      </div>
    </Card>
  );
}

const mealName: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };

export function FoodScreen() {
  const { settings, open, toast } = useUI();
  const todayISO = today(settings);
  const [day, setDay] = useState(todayISO);
  const entries = useLive(() => entriesForDay(day), [day], [] as FoodEntry[]);
  const status = useLive(() => dayStatus(day), [day], { day, complete: null } as DayStatus);
  const totals = sumNutrients(entries);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const energy = useLive(() => loadEnergyModel(settings), [settings], null as EnergyModel | null);
  const t = energy?.targets ?? { kcal: settings.kcalTarget, proteinG: settings.proteinTarget, carbG: settings.carbTarget, fatG: settings.fatTarget, source: "NONE" as const };
  const over = t.kcal !== null && totals.kcal > t.kcal * 1.03;

  const saveMealPrompt = async (meal: Meal) => {
    const items = entries.filter((e) => e.meal === meal);
    if (!items.length) return;
    const name = await promptScreen({ title: "SAVE MEAL", label: "NAME THIS SAVED MEAL", initial: `${mealName[meal]} usual` });
    if (!name) return;
    await saveMealFrom(name, items);
    toast(`MEAL SAVED · "${name}"`);
  };

  return (
    <div className="page">
      <PageTitle sys="FOOD" status={`${entries.length} ${entries.length === 1 ? "ENTRY" : "ENTRIES"}`} />
      <div className="daynav">
        <button className="icon-btn" aria-label="previous day" onClick={() => setDay(addDays(day, -1))}>◀</button>
        <div className="day">
          <b>{dayLabel(day, todayISO, addDays(todayISO, -1))}</b>
          <span>{longDate(Date.parse(`${day}T12:00:00`))}</span>
        </div>
        <button className="icon-btn" aria-label="next day" disabled={day >= todayISO} onClick={() => setDay(addDays(day, 1))}>▶</button>
      </div>

      <Card title="JANOS-SYS/INTAKE" status={t.source === "NONE" ? <button className="link" onClick={() => open({ kind: "settings" })}>SET TARGET</button> : `${t.source} TARGETS`} flush>
        <MeterPanel
          id="food-intake"
          title="INTAKE LEVEL"
          right={`TOTAL ${pad(totals.kcal, 4)} KCAL`}
          rev="SUPPLY MOD 2.2"
          stamp={over ? { text: "OVER TARGET", tone: "red", blink: day === todayISO } : undefined}
          rows={[
            macroRow("01", "KCAL", totals.kcal, t.kcal, "KCAL", true),
            macroRow("02", "PROTEIN", totals.protein, t.proteinG, "G", false),
            macroRow("03", "CARBS", totals.carbs, t.carbG, "G", true),
            macroRow("04", "FAT", totals.fat, t.fatG, "G", true),
          ]}
          srText={`Eaten ${Math.round(totals.kcal)} kcal${t.kcal ? ` of ${t.kcal}` : ""}. Protein ${Math.round(totals.protein)} g, carbs ${Math.round(totals.carbs)} g, fat ${Math.round(totals.fat)} g.`}
        />
      </Card>

      {energy ? <ExpenditureCard m={energy} /> : null}

      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal);
        const kcal = sumNutrients(items).kcal;
        return (
          <Card key={meal} title={mealName[meal]} aside={items.length ? `${fmtKcal(kcal)} KCAL` : "EMPTY"} flush>
            {items.map((e) => (
              <button className="row" key={e.id} onClick={() => setEditing(e)}>
                <div className="grow">
                  <div className="name uc">{e.name}</div>
                  <div className="muted small">
                    {e.amountLabel ? `${e.amountLabel} · ` : ""}P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                  </div>
                </div>
                <div className="num">{fmtKcal(e.kcal)}</div>
              </button>
            ))}
            <div className="rowbar">
              <button className="link" onClick={() => open({ kind: "food", day, meal })}>[+] ADD FOOD</button>
              <div className="grow" />
              {items.length ? (
                <button className="link" onClick={() => saveMealPrompt(meal)}>SAVE MEAL</button>
              ) : (
                <button
                  className="link"
                  onClick={async () => {
                    const n = await copyMeal(addDays(day, -1), day, meal);
                    toast(n ? `COPIED ${n} ITEM${n > 1 ? "S" : ""} FROM YESTERDAY` : "NOTHING TO COPY FROM YESTERDAY");
                  }}
                >
                  COPY YESTERDAY
                </button>
              )}
            </div>
          </Card>
        );
      })}

      <Card title="LOG COMPLETE?" aside={status.complete === null ? "UNSET" : status.complete ? "COMPLETE" : "PARTIAL"}>
        <Chips
          options={[{ value: "yes", label: "YES · ALL LOGGED" }, { value: "no", label: "NO · PARTIAL" }]}
          value={status.complete === null ? null : status.complete ? "yes" : "no"}
          onChange={(v) => setDayComplete(day, v === null ? null : v === "yes")}
          allowNone
        />
        <div className="desc">PARTIAL DAYS ARE LEFT OUT WHEN MAINTENANCE CALORIES ARE LEARNED, SO A HALF-LOGGED DAY NEVER READS AS A DEFICIT.</div>
      </Card>

      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function EntryEditor(props: { entry: FoodEntry; onClose: () => void }) {
  const { toast } = useUI();
  const e = props.entry;
  const [factor, setFactor] = useState<number | null>(1);
  const [meal, setMeal] = useState<Meal>(e.meal);
  const f = factor ?? 1;
  const save = async () => {
    await put("entries", {
      ...e,
      meal,
      kcal: e.kcal * f,
      protein: e.protein * f,
      carbs: e.carbs * f,
      fat: e.fat * f,
      grams: e.grams ? e.grams * f : e.grams,
      amountLabel: f !== 1 ? `${e.amountLabel ?? "portion"} × ${fmt(f, 2)}` : e.amountLabel,
    });
    props.onClose();
  };
  return (
    <Sheet
      title="EDIT ENTRY"
      onClose={props.onClose}
      footer={
        <div className="grid-2">
          <button
            className="btn danger"
            onClick={async () => {
              await deleteEntry(e.id);
              toast("PROC 093 ENTRY DELETED", () => void put("entries", e));
              props.onClose();
            }}
          >
            DELETE
          </button>
          <button className="btn" onClick={save}>SAVE</button>
        </div>
      }
    >
      <Card title="ENTRY" aside={mealName[meal]}>
        <div className="ex-title uc">{e.name}</div>
        <div className="muted small">{e.amountLabel}</div>
        <div className="big-number" style={{ marginTop: 6 }}>
          {fmtKcal(e.kcal * f)}
          <span className="unit"> KCAL</span>
        </div>
        <div className="small num">P {Math.round(e.protein * f)} G · C {Math.round(e.carbs * f)} G · F {Math.round(e.fat * f)} G</div>
      </Card>
      <Field label="PORTION MULTIPLIER">
        <Chips options={[0.5, 0.75, 1, 1.5, 2].map((v) => ({ value: v, label: `× ${v}` }))} value={factor} onChange={(v) => setFactor(v)} />
      </Field>
      <Field label="OR TYPE A MULTIPLIER">
        <NumInput value={factor} onChange={setFactor} ariaLabel="multiplier" />
      </Field>
      <Field label="MEAL">
        <Chips options={MEALS.map((m) => ({ value: m, label: mealName[m] }))} value={meal} onChange={(v) => v && setMeal(v)} />
      </Field>
    </Sheet>
  );
}

// ---- add-food sheet ---------------------------------------------------------

type Mode = "recent" | "saved" | "barcode" | "quick";

export function FoodAddSheet(props: { day: string; meal: string }) {
  const { close, toast } = useUI();
  const [meal, setMeal] = useState<Meal>((MEALS as string[]).includes(props.meal) ? (props.meal as Meal) : "snacks");
  const [mode, setMode] = useState<Mode>("recent");
  const [picked, setPicked] = useState<Food | null>(null);
  const [creating, setCreating] = useState<Partial<Food> | null>(null);

  if (picked) return <AmountSheet food={picked} day={props.day} meal={meal} onBack={() => setPicked(null)} />;
  if (creating) {
    return (
      <CustomFoodSheet
        initial={creating}
        onBack={() => setCreating(null)}
        onSaved={(f) => {
          setCreating(null);
          setPicked(f);
        }}
      />
    );
  }

  return (
    <Sheet title={`ADD → ${mealName[meal]}`} onClose={close}>
      <div style={{ marginBottom: 10 }}>
        <Chips options={MEALS.map((m) => ({ value: m, label: mealName[m] }))} value={meal} onChange={(v) => v && setMeal(v)} />
      </div>
      <Segmented
        options={[
          { value: "recent", label: "FOODS" },
          { value: "barcode", label: "BARCODE" },
          { value: "saved", label: "MEALS" },
          { value: "quick", label: "QUICK" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <div style={{ height: 12 }} />
      {mode === "recent" ? <FoodList onPick={setPicked} onCreate={() => setCreating({})} /> : null}
      {mode === "barcode" ? <BarcodePanel onFound={setPicked} onCreate={setCreating} /> : null}
      {mode === "saved" ? (
        <SavedMeals
          onAdd={async (m) => {
            await addSavedMeal(m, props.day, meal);
            toast(`ADDED · ${m.name}`);
            close();
          }}
        />
      ) : null}
      {mode === "quick" ? (
        <QuickAdd
          onAdd={async (q) => {
            await addEntry({ ...q, day: props.day, meal, method: "quick" });
            toast(`ADDED · ${Math.round(q.kcal)} KCAL`);
            close();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function FoodList(props: { onPick: (f: Food) => void; onCreate: () => void }) {
  const foods = useLive(allFoods, [], [] as Food[]);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? foods.filter((f) => `${f.name} ${f.brand ?? ""}`.toLowerCase().includes(t)) : foods).slice(0, 60);
  }, [foods, q]);
  return (
    <>
      <input className="input" placeholder="SEARCH YOUR FOODS" aria-label="search your foods" value={q} onChange={(e: any) => setQ(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn secondary block" onClick={props.onCreate}>[+] NEW FOOD FROM A LABEL</button>
      <div style={{ height: 12 }} />
      <Card title={q ? "MATCHES" : "RECENT FOODS"} aside={shown.length ? `${shown.length}` : null} flush>
        {shown.length === 0 ? (
          <div className="empty">{foods.length ? "NO MATCH." : "NO RECORDS YET. FOODS YOU ADD OR SCAN ARE FILED HERE, MOST RECENT FIRST."}</div>
        ) : null}
        {shown.map((f) => (
          <button className="row" key={f.id} onClick={() => props.onPick(f)}>
            <div className="grow">
              <div className="name uc">{f.name}</div>
              <div className="muted small">
                {f.brand ? (
                  <>
                    <span className="uc">{f.brand}</span> ·{" "}
                  </>
                ) : null}
                {Math.round(f.per100g.kcal)} KCAL / 100 G
              </div>
            </div>
            <span className="go">▶</span>
          </button>
        ))}
      </Card>
    </>
  );
}

function BarcodePanel(props: { onFound: (f: Food) => void; onCreate: (partial: Partial<Food>) => void }) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const look = async (c: string) => {
    const clean = c.replace(/\D/g, "");
    if (clean.length < 6) {
      setMessage("BARCODE INCOMPLETE · 6+ DIGITS REQUIRED");
      return;
    }
    setBusy(true);
    setMessage(null);
    const r = await lookupBarcode(clean);
    setBusy(false);
    if (r.food) {
      await saveFood(r.food);
      props.onFound(r.food);
    } else {
      setMessage(r.error ?? "NOT FOUND");
      setCode(clean);
      if (r.partial) props.onCreate({ ...r.partial, barcode: clean });
    }
  };
  if (scanning) {
    return (
      <BarcodeScanner
        onCode={(c) => {
          setScanning(false);
          setCode(c);
          void look(c);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }
  return (
    <>
      <button className="btn block xl" onClick={() => setScanning(true)}>▶ SCAN BARCODE WITH CAMERA</button>
      <h2>OR TYPE THE NUMBER</h2>
      <input className="input" inputMode="numeric" placeholder="0 55653 68500 1" aria-label="barcode number" value={code} onChange={(e: any) => setCode(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn secondary block" disabled={busy || !code.trim()} onClick={() => look(code)}>
        {busy ? "LOOKING UP…" : "LOOK UP"}
      </button>
      {message ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          <span className="msg">{message}</span>
          <div className="chips">
            <button className="btn sm" onClick={() => props.onCreate({ barcode: code.replace(/\D/g, "") })}>ENTER IT FROM THE LABEL</button>
          </div>
        </div>
      ) : null}
      <div className="desc" style={{ marginTop: 12 }}>
        PRODUCT DATA: <span className="blu">OPEN FOOD FACTS</span>, A FREE CROWD-SOURCED DATABASE. CHECK THE NUMBERS; YOU CAN CORRECT THEM.
      </div>
    </>
  );
}

function SavedMeals(props: { onAdd: (m: SavedMeal) => void }) {
  const meals = useLive(listSavedMeals, [], [] as SavedMeal[]);
  return (
    <Card title="SAVED MEALS" aside={meals.length ? `${meals.length}` : null} flush>
      {meals.length === 0 ? <div className="empty">NO SAVED MEALS YET. LOG A MEAL ON THE FOOD TAB, THEN [SAVE MEAL].</div> : null}
      {meals.map((m) => {
        const t = sumNutrients(m.items);
        return (
          <button className="row" key={m.id} onClick={() => props.onAdd(m)}>
            <div className="grow">
              <div className="name uc">{m.name}</div>
              <div className="muted small">{m.items.length} ITEMS · P {Math.round(t.protein)} G</div>
            </div>
            <div className="num">{fmtKcal(t.kcal)}</div>
          </button>
        );
      })}
    </Card>
  );
}

function QuickAdd(props: { onAdd: (q: { name: string; kcal: number; protein: number; carbs: number; fat: number }) => void }) {
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState<number | null>(null);
  const [p, setP] = useState<number | null>(null);
  const [c, setC] = useState<number | null>(null);
  const [f, setF] = useState<number | null>(null);
  return (
    <>
      <Field label="WHAT WAS IT (OPTIONAL)">
        <input className="input" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="QUICK ADD" />
      </Field>
      <Field label="CALORIES (KCAL)">
        <NumInput value={kcal} onChange={setKcal} big decimals={false} ariaLabel="calories" />
      </Field>
      <div className="grid-3">
        <Field label="PROTEIN G"><NumInput value={p} onChange={setP} ariaLabel="protein" /></Field>
        <Field label="CARBS G"><NumInput value={c} onChange={setC} ariaLabel="carbs" /></Field>
        <Field label="FAT G"><NumInput value={f} onChange={setF} ariaLabel="fat" /></Field>
      </div>
      <button className="btn block xl" disabled={kcal === null} onClick={() => kcal !== null && props.onAdd({ name: name.trim() || "Quick add", kcal, protein: p ?? 0, carbs: c ?? 0, fat: f ?? 0 })}>
        [+] ADD
      </button>
    </>
  );
}

function AmountSheet(props: { food: Food; day: string; meal: Meal; onBack: () => void }) {
  const { close, toast } = useUI();
  const f = props.food;
  const options = [...f.servings, { label: "grams", grams: 1 }];
  const [serving, setServing] = useState(0);
  const [qty, setQty] = useState<number | null>(options[0].label === "grams" ? 100 : 1);
  const s = options[serving];
  const grams = (qty ?? 0) * s.grams;
  const n = scale(f.per100g, grams);
  const label = s.label === "grams" ? `${fmt(grams)} g` : `${fmt(qty ?? 0, 2)} × ${s.label}`;
  return (
    <Sheet
      title="AMOUNT"
      onClose={props.onBack}
      footer={
        <button
          className="btn block xl"
          disabled={!qty}
          onClick={async () => {
            await addFoodEntry(f, grams, label, props.day, props.meal, f.barcode ? "barcode" : "search");
            toast(`ADDED · ${f.name}`);
            close();
          }}
        >
          [+] ADD {fmtKcal(n.kcal)} KCAL
        </button>
      }
    >
      <Card title="FOOD" aside={f.source === "custom" ? "YOUR FOOD" : f.barcode ? `EAN ${f.barcode}` : null}>
        <div className="ex-title uc">{f.name}</div>
        {f.brand ? <div className="muted small uc">{f.brand}</div> : null}
        <div className="grid-3" style={{ marginTop: 10 }}>
          <div className="stat"><div className="label">PROTEIN</div><div className="value" style={{ fontSize: 18 }}>{fmt(n.protein)} G</div></div>
          <div className="stat"><div className="label">CARBS</div><div className="value" style={{ fontSize: 18 }}>{fmt(n.carbs)} G</div></div>
          <div className="stat"><div className="label">FAT</div><div className="value" style={{ fontSize: 18 }}>{fmt(n.fat)} G</div></div>
        </div>
      </Card>
      <Field label="UNIT">
        <Chips
          options={options.map((o, i) => ({ value: i, label: o.label === "grams" ? "grams" : `${o.label}${o.label.includes("g") ? "" : ` (${fmt(o.grams)} g)`}` }))}
          value={serving}
          onChange={(v) => {
            if (v === null) return;
            setServing(v);
            setQty(options[v].label === "grams" ? 100 : 1);
          }}
        />
      </Field>
      <Field label={s.label === "grams" ? "GRAMS" : "HOW MANY"}>
        <NumInput value={qty} onChange={setQty} big ariaLabel="amount" />
      </Field>
      {s.label !== "grams" ? (
        <Chips options={[0.5, 1, 1.5, 2].map((v) => ({ value: v, label: String(v) }))} value={qty} onChange={(v) => v !== null && setQty(v)} />
      ) : null}
      {f.attribution ? <div className="desc" style={{ marginTop: 14 }}>SOURCE: {f.attribution}</div> : null}
    </Sheet>
  );
}

function CustomFoodSheet(props: { initial: Partial<Food>; onBack: () => void; onSaved: (f: Food) => void }) {
  const init = props.initial;
  const initServing = init.servings?.[0] ?? { label: "1 serving", grams: 100 };
  const perServing = init.per100g ? scale(init.per100g, initServing.grams) : null;
  const [name, setName] = useState(init.name ?? "");
  const [brand, setBrand] = useState(init.brand ?? "");
  const [barcode, setBarcode] = useState(init.barcode ?? "");
  const [servingLabel, setServingLabel] = useState(initServing.label);
  const [servingGrams, setServingGrams] = useState<number | null>(initServing.grams);
  const [kcal, setKcal] = useState<number | null>(perServing && perServing.kcal ? Math.round(perServing.kcal) : null);
  const [p, setP] = useState<number | null>(perServing && perServing.protein ? Math.round(perServing.protein * 10) / 10 : null);
  const [c, setC] = useState<number | null>(perServing && perServing.carbs ? Math.round(perServing.carbs * 10) / 10 : null);
  const [fat, setFat] = useState<number | null>(perServing && perServing.fat ? Math.round(perServing.fat * 10) / 10 : null);
  const valid = name.trim() && servingGrams && servingGrams > 0 && kcal !== null;
  const save = async () => {
    if (!valid || !servingGrams) return;
    const k = 100 / servingGrams;
    const food: Food = {
      id: uid(),
      name: name.trim(),
      brand: brand.trim() || undefined,
      barcode: barcode.replace(/\D/g, "") || undefined,
      source: "custom",
      per100g: { kcal: (kcal ?? 0) * k, protein: (p ?? 0) * k, carbs: (c ?? 0) * k, fat: (fat ?? 0) * k },
      servings: [{ label: servingLabel.trim() || "1 serving", grams: servingGrams }],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    };
    await saveFood(food);
    props.onSaved(food);
  };
  return (
    <Sheet title="NEW FOOD" onClose={props.onBack} footer={<button className="btn block xl" disabled={!valid} onClick={save}>SAVE FOOD</button>}>
      <div className="desc" style={{ margin: "0 0 12px" }}>COPY THE NUMBERS FROM THE NUTRITION LABEL, PER SERVING.</div>
      <Field label="NAME"><input className="input" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="GREEK YOGURT 0%" /></Field>
      <Field label="BRAND (OPTIONAL)"><input className="input" value={brand} onChange={(e: any) => setBrand(e.target.value)} /></Field>
      <div className="grid-2">
        <Field label="SERVING (AS ON LABEL)"><input className="input" value={servingLabel} onChange={(e: any) => setServingLabel(e.target.value)} placeholder="3/4 CUP" /></Field>
        <Field label="SERVING SIZE (G OR ML)"><NumInput value={servingGrams} onChange={setServingGrams} /></Field>
      </div>
      <Field label="CALORIES PER SERVING"><NumInput value={kcal} onChange={setKcal} decimals={false} /></Field>
      <div className="grid-3">
        <Field label="PROTEIN G"><NumInput value={p} onChange={setP} /></Field>
        <Field label="CARBS G"><NumInput value={c} onChange={setC} /></Field>
        <Field label="FAT G"><NumInput value={fat} onChange={setFat} /></Field>
      </div>
      <Field label="BARCODE (OPTIONAL)"><input className="input" inputMode="numeric" value={barcode} onChange={(e: any) => setBarcode(e.target.value)} /></Field>
    </Sheet>
  );
}
