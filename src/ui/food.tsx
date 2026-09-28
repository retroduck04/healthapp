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
import { Card, Chips, Field, fmtKcal, NumInput, ProgressBar, Segmented, Sheet, useUI } from "./kit";

const mealName: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };

export function FoodScreen() {
  const { settings, open, toast } = useUI();
  const todayISO = today(settings);
  const [day, setDay] = useState(todayISO);
  const entries = useLive(() => entriesForDay(day), [day], [] as FoodEntry[]);
  const status = useLive(() => dayStatus(day), [day], { day, complete: null } as DayStatus);
  const totals = sumNutrients(entries);
  const [editing, setEditing] = useState<FoodEntry | null>(null);

  const saveMealPrompt = async (meal: Meal) => {
    const items = entries.filter((e) => e.meal === meal);
    if (!items.length) return;
    const name = prompt("Name this saved meal", `${mealName[meal]} usual`);
    if (!name) return;
    await saveMealFrom(name, items);
    toast(`Saved "${name}"`);
  };

  return (
    <div className="page">
      <div className="page-title">
        <button className="icon-btn" aria-label="previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24 }}>{dayLabel(day, todayISO, addDays(todayISO, -1))}</h1>
          <div className="sub">{longDate(Date.parse(`${day}T12:00:00`))}</div>
        </div>
        <button className="icon-btn" aria-label="next day" disabled={day >= todayISO} onClick={() => setDay(addDays(day, 1))}>›</button>
      </div>

      <Card>
        <div className="card-head">
          <div>
            <div className="big-number">{fmtKcal(totals.kcal)}</div>
            <div className="muted small">kcal eaten{settings.kcalTarget ? ` of ${fmtKcal(settings.kcalTarget)}` : ""}</div>
          </div>
          {settings.kcalTarget ? (
            <div style={{ textAlign: "right" }}>
              <div className="stat">
                <div className="value">{fmtKcal(settings.kcalTarget - totals.kcal)}</div>
                <div className="label">{settings.kcalTarget - totals.kcal >= 0 ? "remaining" : "over"}</div>
              </div>
            </div>
          ) : (
            <button className="link" onClick={() => open({ kind: "settings" })}>Set target</button>
          )}
        </div>
        {settings.kcalTarget ? <ProgressBar value={totals.kcal} max={settings.kcalTarget} /> : null}
        <div className="grid-3" style={{ marginTop: 12 }}>
          <Macro label="Protein" value={totals.protein} target={settings.proteinTarget} />
          <Macro label="Carbs" value={totals.carbs} target={settings.carbTarget} />
          <Macro label="Fat" value={totals.fat} target={settings.fatTarget} />
        </div>
      </Card>

      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal);
        const kcal = sumNutrients(items).kcal;
        return (
          <div key={meal}>
            <h2 style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{mealName[meal]}</span>
              <span className="num">{items.length ? `${fmtKcal(kcal)} kcal` : ""}</span>
            </h2>
            <div className="card tight">
              {items.map((e) => (
                <button className="row" key={e.id} onClick={() => setEditing(e)}>
                  <div className="grow">
                    <div className="name">{e.name}</div>
                    <div className="muted small">
                      {e.amountLabel ? `${e.amountLabel} · ` : ""}P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                    </div>
                  </div>
                  <div className="num">{fmtKcal(e.kcal)}</div>
                </button>
              ))}
              <div className="row">
                <button className="link" onClick={() => open({ kind: "food", day, meal })}>+ Add food</button>
                <div className="grow" />
                {items.length ? (
                  <button className="link" style={{ color: "var(--muted)" }} onClick={() => saveMealPrompt(meal)}>Save meal</button>
                ) : (
                  <button
                    className="link"
                    style={{ color: "var(--muted)" }}
                    onClick={async () => {
                      const n = await copyMeal(addDays(day, -1), day, meal);
                      toast(n ? `Copied ${n} item${n > 1 ? "s" : ""} from yesterday` : "Nothing to copy from yesterday");
                    }}
                  >
                    Copy yesterday
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <h2>Is this day's log complete?</h2>
      <Card>
        <Chips
          options={[{ value: "yes", label: "Yes, everything logged" }, { value: "no", label: "No, partial" }]}
          value={status.complete === null ? null : status.complete ? "yes" : "no"}
          onChange={(v) => setDayComplete(day, v === null ? null : v === "yes")}
          allowNone
        />
        <div className="muted small" style={{ marginTop: 8 }}>
          Partial days are left out when the app learns your maintenance calories, so a half-logged day never looks like a big deficit.
        </div>
      </Card>

      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function Macro(props: { label: string; value: number; target: number | null }) {
  return (
    <div>
      <div className="small muted">{props.label}</div>
      <div className="num" style={{ fontWeight: 600 }}>
        {Math.round(props.value)}
        {props.target ? <span className="muted small"> / {props.target} g</span> : " g"}
      </div>
      {props.target ? <ProgressBar value={props.value} max={props.target} /> : null}
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
      title="Edit entry"
      onClose={props.onClose}
      footer={
        <div className="grid-2">
          <button
            className="btn plain"
            style={{ color: "var(--danger)" }}
            onClick={async () => {
              await deleteEntry(e.id);
              toast("Entry deleted", () => void put("entries", e));
              props.onClose();
            }}
          >
            Delete
          </button>
          <button className="btn" onClick={save}>Save</button>
        </div>
      }
    >
      <Card>
        <div style={{ fontWeight: 600 }}>{e.name}</div>
        <div className="muted small">{e.amountLabel}</div>
        <div className="big-number" style={{ marginTop: 6 }}>{fmtKcal(e.kcal * f)} kcal</div>
        <div className="muted small">P {Math.round(e.protein * f)} g · C {Math.round(e.carbs * f)} g · F {Math.round(e.fat * f)} g</div>
      </Card>
      <Field label="Portion multiplier">
        <Chips options={[0.5, 0.75, 1, 1.5, 2].map((v) => ({ value: v, label: `× ${v}` }))} value={factor} onChange={(v) => setFactor(v)} />
      </Field>
      <Field label="Or type a multiplier">
        <NumInput value={factor} onChange={setFactor} />
      </Field>
      <Field label="Meal">
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
    <Sheet title={`Add to ${mealName[meal]}`} onClose={close}>
      <div style={{ marginBottom: 10 }}>
        <Chips options={MEALS.map((m) => ({ value: m, label: mealName[m] }))} value={meal} onChange={(v) => v && setMeal(v)} />
      </div>
      <Segmented
        options={[
          { value: "recent", label: "Foods" },
          { value: "barcode", label: "Barcode" },
          { value: "saved", label: "Meals" },
          { value: "quick", label: "Quick" },
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
            toast(`Added ${m.name}`);
            close();
          }}
        />
      ) : null}
      {mode === "quick" ? (
        <QuickAdd
          onAdd={async (q) => {
            await addEntry({ ...q, day: props.day, meal, method: "quick" });
            toast(`Added ${Math.round(q.kcal)} kcal`);
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
      <input className="input" placeholder="Search your foods" value={q} onChange={(e: any) => setQ(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn secondary block" onClick={props.onCreate}>+ New food from a label</button>
      <h2>{q ? "Matches" : "Recent"}</h2>
      <div className="card tight">
        {shown.length === 0 ? (
          <div className="empty">{foods.length ? "No match." : "Foods you add or scan appear here, most recent first."}</div>
        ) : null}
        {shown.map((f) => (
          <button className="row" key={f.id} onClick={() => props.onPick(f)}>
            <div className="grow">
              <div className="name">{f.name}</div>
              <div className="muted small">
                {f.brand ? `${f.brand} · ` : ""}
                {Math.round(f.per100g.kcal)} kcal / 100 g
              </div>
            </div>
            <span className="muted">›</span>
          </button>
        ))}
      </div>
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
      setMessage("That doesn't look like a full barcode number.");
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
      setMessage(r.error ?? "Not found.");
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
      <button className="btn block xl" onClick={() => setScanning(true)}>Scan barcode with camera</button>
      <h2>Or type the number</h2>
      <input className="input" inputMode="numeric" placeholder="e.g. 0 55653 68500 1" value={code} onChange={(e: any) => setCode(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn secondary block" disabled={busy || !code.trim()} onClick={() => look(code)}>
        {busy ? "Looking up…" : "Look up"}
      </button>
      {message ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          {message}
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => props.onCreate({ barcode: code.replace(/\D/g, "") })}>Enter it from the label</button>
          </div>
        </div>
      ) : null}
      <div className="muted small" style={{ marginTop: 12 }}>
        Product data comes from Open Food Facts, a free crowd-sourced database. Always glance at the numbers; you can correct them.
      </div>
    </>
  );
}

function SavedMeals(props: { onAdd: (m: SavedMeal) => void }) {
  const meals = useLive(listSavedMeals, [], [] as SavedMeal[]);
  return (
    <div className="card tight">
      {meals.length === 0 ? <div className="empty">No saved meals yet. On the Food tab, log a meal and tap “Save meal”.</div> : null}
      {meals.map((m) => {
        const t = sumNutrients(m.items);
        return (
          <button className="row" key={m.id} onClick={() => props.onAdd(m)}>
            <div className="grow">
              <div className="name">{m.name}</div>
              <div className="muted small">{m.items.length} items · P {Math.round(t.protein)} g</div>
            </div>
            <div className="num">{fmtKcal(t.kcal)}</div>
          </button>
        );
      })}
    </div>
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
      <Field label="What was it? (optional)">
        <input className="input" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Quick add" />
      </Field>
      <Field label="Calories (kcal)">
        <NumInput value={kcal} onChange={setKcal} big decimals={false} ariaLabel="calories" />
      </Field>
      <div className="grid-3">
        <Field label="Protein g"><NumInput value={p} onChange={setP} /></Field>
        <Field label="Carbs g"><NumInput value={c} onChange={setC} /></Field>
        <Field label="Fat g"><NumInput value={f} onChange={setF} /></Field>
      </div>
      <button className="btn block xl" disabled={kcal === null} onClick={() => kcal !== null && props.onAdd({ name: name.trim() || "Quick add", kcal, protein: p ?? 0, carbs: c ?? 0, fat: f ?? 0 })}>
        Add
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
      title="Amount"
      onClose={props.onBack}
      footer={
        <button
          className="btn block xl"
          disabled={!qty}
          onClick={async () => {
            await addFoodEntry(f, grams, label, props.day, props.meal, f.barcode ? "barcode" : "search");
            toast(`Added ${f.name}`);
            close();
          }}
        >
          Add {fmtKcal(n.kcal)} kcal
        </button>
      }
    >
      <Card>
        <div style={{ fontWeight: 600 }}>{f.name}</div>
        <div className="muted small">{f.brand ?? (f.source === "custom" ? "Your food" : "")}</div>
        <div className="grid-3" style={{ marginTop: 10 }}>
          <div><div className="small muted">Protein</div><div className="num">{fmt(n.protein)} g</div></div>
          <div><div className="small muted">Carbs</div><div className="num">{fmt(n.carbs)} g</div></div>
          <div><div className="small muted">Fat</div><div className="num">{fmt(n.fat)} g</div></div>
        </div>
      </Card>
      <Field label="Unit">
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
      <Field label={s.label === "grams" ? "Grams" : "How many"}>
        <NumInput value={qty} onChange={setQty} big ariaLabel="amount" />
      </Field>
      {s.label !== "grams" ? (
        <Chips options={[0.5, 1, 1.5, 2].map((v) => ({ value: v, label: String(v) }))} value={qty} onChange={(v) => v !== null && setQty(v)} />
      ) : null}
      {f.attribution ? <div className="muted small" style={{ marginTop: 14 }}>Source: {f.attribution}</div> : null}
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
    <Sheet title="New food" onClose={props.onBack} footer={<button className="btn block xl" disabled={!valid} onClick={save}>Save food</button>}>
      <div className="muted small" style={{ marginBottom: 12 }}>Copy the numbers from the nutrition label, per serving.</div>
      <Field label="Name"><input className="input" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="e.g. Greek yogurt 0%" /></Field>
      <Field label="Brand (optional)"><input className="input" value={brand} onChange={(e: any) => setBrand(e.target.value)} /></Field>
      <div className="grid-2">
        <Field label="Serving (as on label)"><input className="input" value={servingLabel} onChange={(e: any) => setServingLabel(e.target.value)} placeholder="3/4 cup" /></Field>
        <Field label="Serving size (g or ml)"><NumInput value={servingGrams} onChange={setServingGrams} /></Field>
      </div>
      <Field label="Calories per serving"><NumInput value={kcal} onChange={setKcal} decimals={false} /></Field>
      <div className="grid-3">
        <Field label="Protein g"><NumInput value={p} onChange={setP} /></Field>
        <Field label="Carbs g"><NumInput value={c} onChange={setC} /></Field>
        <Field label="Fat g"><NumInput value={fat} onChange={setFat} /></Field>
      </div>
      <Field label="Barcode (optional)"><input className="input" inputMode="numeric" value={barcode} onChange={(e: any) => setBarcode(e.target.value)} /></Field>
    </Sheet>
  );
}
