// OBESITY PROTOCOL: tap a chain, tap a combo, log every item at once (official numbers from the database).

import { useState } from "react";
import { get, useLive } from "../db/db";
import { addFoodEntry } from "../db/repo";
import { MEALS, type Food, type Meal } from "../db/types";
import { CHAINS, damage, INGEST_QUIPS, resolveCombo, sized, SIZE_WORD, totalOf, type Chain, type Combo, type Drink, type Size } from "./combos";
import { useFoodDb } from "./describe";
import { freshFood, type FoodDb } from "./fooddb";
import { Card, Chips, fmtKcal, Sheet, useUI } from "./kit";
import { loadEnergyModel, type EnergyModel } from "./models";
import { PixelIcon } from "./pixel";
import { Seg7Panel } from "./raster";

const mealName: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };

export function ObesityBoard(props: { day: string; meal: Meal; onLogged: () => void }) {
  const db = useFoodDb();
  const [chain, setChain] = useState<Chain | null>(null);
  const [combo, setCombo] = useState<Combo | null>(null);

  if (!db) return <div className="empty">LOADING DATABASE…</div>;
  if (chain && combo) return <ComboSheet db={db} chain={chain} combo={combo} day={props.day} meal={props.meal} onBack={() => setCombo(null)} onLogged={props.onLogged} />;

  if (!chain) {
    return (
      <Card
        title="JANOS-SYS/OBESITY"
        status="COMBO PROTOCOL"
        help="EVERY ITEM USES THE CHAIN'S OWN PUBLISHED NUMBERS FROM THE BUILT-IN DATABASE. COMBOS ARE TYPICAL PAIRINGS, NOT OFFICIAL MEAL DEFINITIONS. POP IS GENERIC COLA BY SIZE (355 / 500 / 650 ML) UNLESS THE CHAIN LISTS ITS OWN DRINK. EACH ITEM IS LOGGED SEPARATELY, SO YOU CAN EDIT OR DELETE ONE LATER."
      >
        <div className="desc" style={{ margin: "0 0 10px" }}>PRESS A CHAIN. PICK A COMBO. ACCEPT THE CONSEQUENCES.</div>
        <div className="chain-grid">
          {CHAINS.map((ch) => (
            <button key={ch.brand} className="chain-tile" onClick={() => setChain(ch)} aria-label={`${ch.brand} combos`}>
              <PixelIcon name={ch.icon} size={40} />
              <span className="nm">{ch.brand}</span>
              <span className="ct">{ch.combos.length} COMBOS</span>
            </button>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="rowbar" style={{ margin: "0 0 10px" }}>
        <button className="link" onClick={() => setChain(null)}>◄ ALL CHAINS</button>
      </div>
      <Card title={chain.brand.toUpperCase()} status={`${chain.combos.length} COMBOS`} flush>
        {chain.combos.map((c) => {
          const lines = resolveCombo(db, c, "M", "pop");
          const t = totalOf(lines);
          const d = damage(t.kcal);
          return (
            <button key={c.id} className="row combo-row" onClick={() => setCombo(c)}>
              <div className="icons" aria-hidden="true">
                {lines.slice(0, 5).map((l, i) => (
                  <PixelIcon key={i} name={l.icon} size={22} />
                ))}
              </div>
              <div className="grow">
                <div className="name">{c.name}</div>
                <div className="muted small">
                  P {Math.round(t.protein)} · C {Math.round(t.carbs)} · F {Math.round(t.fat)} · <span className={`dmg ${d.tone}`}>{d.word}</span>
                </div>
              </div>
              <div className="num">{fmtKcal(t.kcal)}</div>
            </button>
          );
        })}
      </Card>
    </>
  );
}

function ComboSheet(props: { db: FoodDb; chain: Chain; combo: Combo; day: string; meal: Meal; onBack: () => void; onLogged: () => void }) {
  const { settings, toast } = useUI();
  const energy = useLive(() => loadEnergyModel(settings), [settings], null as EnergyModel | null);
  const c = props.combo;
  const [size, setSize] = useState<Size>("M");
  const [drink, setDrink] = useState<Drink>("pop");
  const [meal, setMeal] = useState<Meal>(props.meal);
  const [busy, setBusy] = useState(false);
  const lines = resolveCombo(props.db, c, size, drink);
  const t = totalOf(lines);
  const d = damage(t.kcal);
  const target = energy?.targets.kcal ?? settings.kcalTarget ?? null;
  const pct = target ? Math.round((t.kcal / target) * 100) : null;

  const log = async () => {
    setBusy(true);
    for (const l of lines) {
      if (!l.food) continue;
      const mine = await get<Food>("foods", l.food.id);
      await addFoodEntry(mine ? freshFood(props.db, mine) : l.food, l.grams, l.label, props.day, meal, "database");
    }
    const quip = INGEST_QUIPS[Math.floor(Math.random() * INGEST_QUIPS.length)];
    toast(`PROC 099 COMBO LOGGED · ${Math.round(t.kcal)} KCAL · ${quip}`);
    props.onLogged();
  };

  return (
    <Sheet
      title="COMBO"
      onClose={props.onBack}
      footer={
        <button className="btn block xl" disabled={busy} onClick={log}>
          [+] LOG COMBO · {fmtKcal(t.kcal)} KCAL
        </button>
      }
    >
      <div className="combo-head">
        <div className="icons big" aria-hidden="true">
          {lines.map((l, i) => (
            <PixelIcon key={i} name={l.icon} size={40} />
          ))}
        </div>
        <div className="ex-title">{c.name}</div>
        <div className="muted small">{props.chain.brand}</div>
      </div>
      <Card title="JANOS-SYS/DAMAGE REPORT" flush>
        <Seg7Panel
          id="combo-load"
          heat
          rev="OBESITY PROTOCOL R01"
          caption="COMBO LOAD:"
          value={String(Math.round(t.kcal))}
          unit="KCAL"
          tone={d.tone}
          state={{ text: d.word, tone: d.tone, blink: d.blink ? 2 : 0 }}
          sub={`P ${Math.round(t.protein)} · C ${Math.round(t.carbs)} · F ${Math.round(t.fat)} G`}
          side={pct !== null ? { big: String(pct), small: "% OF DAY" } : undefined}
          srText={`${c.name}: ${Math.round(t.kcal)} kcal, ${d.word.toLowerCase()}${pct !== null ? `, ${pct} percent of your daily target` : ""}.`}
        />
      </Card>
      <Card title="ITEMS" aside={`${lines.filter((l) => l.food).length}`} flush>
        {lines.map((l, i) => (
          <div className="row static" key={i}>
            <PixelIcon name={l.icon} size={24} />
            <div className="grow">
              <div className="name">{l.name}</div>
              <div className="muted small">
                {l.label} · P {Math.round(l.n.protein)} · C {Math.round(l.n.carbs)} · F {Math.round(l.n.fat)}
              </div>
            </div>
            <div className="num">{fmtKcal(l.n.kcal)}</div>
          </div>
        ))}
      </Card>
      {sized(c) || c.drink ? (
        <>
          <h2>SIZE</h2>
          <Chips options={(["S", "M", "L"] as Size[]).map((s) => ({ value: s, label: SIZE_WORD[s] }))} value={size} onChange={(v) => v && setSize(v)} />
        </>
      ) : null}
      {c.drink ? (
        <>
          <h2>DRINK</h2>
          <Chips
            options={[
              { value: "pop" as Drink, label: "POP" },
              { value: "diet" as Drink, label: "DIET (NICE TRY)" },
              { value: "water" as Drink, label: "WATER" },
            ]}
            value={drink}
            onChange={(v) => v && setDrink(v)}
          />
        </>
      ) : null}
      <h2>MEAL</h2>
      <Chips options={MEALS.map((m) => ({ value: m, label: mealName[m] }))} value={meal} onChange={(v) => v && setMeal(v)} />
    </Sheet>
  );
}
