// "Describe what you ate": free text → AI estimate → review screen → logged entries.

import { useEffect, useState } from "react";
import { get, useLive } from "../db/db";
import { addEntry, addFoodEntry, today, TZ } from "../db/repo";
import { MEALS, type Food, type Meal } from "../db/types";
import { totalOf, type AiItem, type AiResult } from "../engine/aimeal";
import { localTime } from "../engine/dates";
import { fmt } from "../engine/units";
import { AiError, analyzeMeal, getAiConfig, type AiConfig } from "./ai";
import { freshFood, loadFoodDb, rowToFood, type FoodDb } from "./fooddb";
import { Card, Chips, fmtKcal, Sheet, useUI } from "./kit";

const mealName: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };

/** Meal by the clock: before 11 breakfast, before 15 lunch, before 21 dinner, otherwise snacks. */
export function mealByClock(ms = Date.now()): Meal {
  const h = localTime(ms, TZ).hour;
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snacks";
}

export function useFoodDb(): FoodDb | null {
  const [db, setDb] = useState<FoodDb | null>(null);
  useEffect(() => {
    let live = true;
    loadFoodDb().then(
      (d) => live && setDb(d),
      () => undefined, // AI still works without references
    );
    return () => {
      live = false;
    };
  }, []);
  return db;
}

/** The text box and ANALYZE key. `meal` fixes the meal (add sheet); otherwise it is picked by the clock. */
export function DescribeMeal(props: { day: string; meal?: Meal; onLogged?: () => void; autoFocus?: boolean }) {
  const { open, settings } = useUI();
  const cfg = useLive(getAiConfig, [], null as AiConfig | null);
  const db = useFoodDb();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const meal = props.meal ?? (props.day === today(settings) ? mealByClock() : "snacks");

  if (!cfg) {
    return (
      <div className="describe-off">
        <div className="desc" style={{ margin: "0 0 10px" }}>
          TYPE WHAT YOU ATE AND AI WORKS OUT THE CALORIES AND MACROS. NEEDS A FREE GROQ KEY (ONE-TIME SETUP).
        </div>
        <button className="btn secondary block" onClick={() => open({ kind: "settings" })}>
          SET UP AI · CONFIG → 7. AI
        </button>
      </div>
    );
  }

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await analyzeMeal(text, cfg, db);
      if (!r.items.length) setError(r.note ? `WARN 031 NOTHING TO LOG · ${r.note.toUpperCase()}` : "WARN 031 NOTHING TO LOG · DESCRIBE THE FOOD AND AMOUNT");
      else setResult(r);
    } catch (e) {
      setError(e instanceof AiError ? e.message : `ERR 014 AI REPLY UNREADABLE · ${String((e as Error).message ?? e).toUpperCase().slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <textarea
        className="input describe"
        rows={2}
        aria-label="describe what you ate"
        placeholder="E.G. 2 SLICES OF DOMINOS MEATZZA AND A COKE"
        value={text}
        autoFocus={props.autoFocus}
        onChange={(e: any) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e: any) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void run();
          }
        }}
      />
      <div style={{ height: 8 }} />
      <button className="btn block" disabled={!text.trim() || busy} onClick={run}>
        {busy ? (
          <>
            ANALYZING<span className="mg-cursor" />
          </>
        ) : (
          "ANALYZE ►"
        )}
      </button>
      {error ? (
        <div className={error.startsWith("ERR") ? "notice err" : "notice warn"} role="alert" style={{ marginTop: 10 }}>
          <span className="msg">{error}</span>
        </div>
      ) : null}
      {result ? (
        <AiReviewSheet
          text={text}
          result={result}
          day={props.day}
          meal={meal}
          db={db}
          onBack={() => setResult(null)}
          onLogged={() => {
            setResult(null);
            setText("");
            props.onLogged?.();
          }}
        />
      ) : null}
    </>
  );
}

type Row = AiItem & { key: number; factor: number };

const CONF_TAG = { high: "", medium: "EST", low: "ROUGH" } as const;

/** Review screen: every item with its numbers, adjustable before anything is logged. */
function AiReviewSheet(props: { text: string; result: AiResult; day: string; meal: Meal; db: FoodDb | null; onBack: () => void; onLogged: () => void }) {
  const { toast } = useUI();
  const [rows, setRows] = useState<Row[]>(() => props.result.items.map((it, key) => ({ ...it, key, factor: 1 })));
  const [meal, setMeal] = useState<Meal>(props.meal);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const live = rows.filter((r) => r.factor > 0);
  const scaled = (r: Row) => ({ kcal: r.kcal * r.factor, protein: r.protein * r.factor, carbs: r.carbs * r.factor, fat: r.fat * r.factor });
  const total = totalOf(live.map(scaled));
  const setFactor = (key: number, factor: number) => setRows(rows.map((r) => (r.key === key ? { ...r, factor } : r)));

  const log = async () => {
    setSaving(true);
    for (const r of live) {
      const label = r.factor === 1 ? r.amount : `${r.amount} × ${fmt(r.factor, 2)}`;
      const idx = r.refId && props.db ? props.db.byId.get(r.refId) : undefined;
      if (idx !== undefined && props.db) {
        // Matched to the built-in database: log it as that food (official values, lands in RECENT).
        const base = rowToFood(props.db.rows[idx]);
        const mine = await get<Food>("foods", base.id);
        await addFoodEntry(mine ? freshFood(props.db, mine) : base, (r.grams ?? 0) * r.factor, label, props.day, meal, "database");
      } else {
        const n = scaled(r);
        await addEntry({ day: props.day, meal, name: r.name, grams: r.grams ? r.grams * r.factor : null, amountLabel: label, method: "ai", ...n });
      }
    }
    toast(`ADDED ${live.length} ITEM${live.length === 1 ? "" : "S"} · ${Math.round(total.kcal)} KCAL → ${mealName[meal].toUpperCase()}`);
    props.onLogged();
  };

  return (
    <Sheet
      title="AI ESTIMATE"
      onClose={props.onBack}
      footer={
        <button className="btn block xl" disabled={!live.length || saving} onClick={log}>
          [+] LOG {live.length} ITEM{live.length === 1 ? "" : "S"} · {fmtKcal(total.kcal)} KCAL
        </button>
      }
    >
      <div className="desc uc" style={{ margin: "0 0 10px" }}>"{props.text.trim()}"</div>
      <Card title="ITEMS" aside={`${pad3(total.kcal)} KCAL`} flush help="DB = MATCHED TO THE BUILT-IN DATABASE (OFFICIAL RESTAURANT OR USDA NUMBERS). EST = AI ESTIMATE FROM TYPICAL VALUES; ROUGH = THE AMOUNT OR RECIPE WAS UNCLEAR, SO CHECK IT. TAP AN ITEM TO CHANGE THE AMOUNT OR REMOVE IT.">
        {rows.map((r) =>
          r.factor > 0 ? (
            <div key={r.key}>
              <button className="row" onClick={() => setEditing(editing === r.key ? null : r.key)} aria-expanded={editing === r.key}>
                <div className="grow">
                  <div className="name uc">{r.name}</div>
                  <div className="muted small">
                    {r.factor === 1 ? r.amount : `${r.amount} × ${fmt(r.factor, 2)}`} · P {Math.round(r.protein * r.factor)} · C {Math.round(r.carbs * r.factor)} · F {Math.round(r.fat * r.factor)}
                    {r.refId ? <span className="rec"> · DB</span> : CONF_TAG[r.confidence] ? <span className={r.confidence === "low" ? "bad-tag" : "est-tag"}> · {CONF_TAG[r.confidence]}</span> : null}
                  </div>
                </div>
                <div className="num">{fmtKcal(r.kcal * r.factor)}</div>
              </button>
              {editing === r.key ? (
                <div className="ai-edit">
                  <Chips options={[0.5, 1, 1.5, 2, 3].map((v) => ({ value: v, label: `× ${v}` }))} value={r.factor} onChange={(v) => v !== null && setFactor(r.key, v)} />
                  <button className="link danger" onClick={() => setFactor(r.key, 0)}>REMOVE</button>
                </div>
              ) : null}
            </div>
          ) : null,
        )}
        {!live.length ? <div className="empty">ALL ITEMS REMOVED.</div> : null}
      </Card>
      <div className="grid-3" style={{ margin: "4px 0 12px" }}>
        <div className="stat"><div className="label">PROTEIN</div><div className="value" style={{ fontSize: 18 }}>{Math.round(total.protein)} G</div></div>
        <div className="stat"><div className="label">CARBS</div><div className="value" style={{ fontSize: 18 }}>{Math.round(total.carbs)} G</div></div>
        <div className="stat"><div className="label">FAT</div><div className="value" style={{ fontSize: 18 }}>{Math.round(total.fat)} G</div></div>
      </div>
      <Chips options={MEALS.map((m) => ({ value: m, label: mealName[m] }))} value={meal} onChange={(v) => v && setMeal(v)} />
      {props.result.note ? <div className="desc" style={{ marginTop: 12 }}>AI NOTE · <span className="uc">{props.result.note}</span></div> : null}
    </Sheet>
  );
}

const pad3 = (v: number) => String(Math.round(v)).padStart(3, "0");
