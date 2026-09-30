// Built-in food database: official restaurant menu items (per serving) plus everyday staples (USDA).
// The JSON ships next to app.js (docs/fooddb.json), is cached by the service worker for offline use and
// loads on first search. Rows are converted to ordinary Food records when picked.

import type { Food } from "../db/types";
import { BRAND_NICK, buildHay, normalize, rank, type Hay } from "../engine/foodsearch";

declare const __FOODDB_URL__: string;

/** [id, brand, name, variant, category, aliases, servings[[label, grams]], unitOnly, kcal, protein, carbs, fat,
 *  fiber, sugar, sodiumMg, region, source] — nutrients per 100 g (unitOnly: per 100 pseudo-grams = 1 serving). */
export type DbRow = [
  string, string, string, string | null, string, string[], [string, number][], boolean,
  number, number, number, number, number | null, number | null, number | null, string, string,
];

export interface FoodDb {
  rows: DbRow[];
  hays: Hay[];
  brands: { name: string; count: number }[];
  byId: Map<string, number>; // row index
}

let pending: Promise<FoodDb> | null = null;

export function indexRows(rows: DbRow[]): FoodDb {
  const counts = new Map<string, number>();
  for (const r of rows) if (r[1]) counts.set(r[1], (counts.get(r[1]) ?? 0) + 1);
  return {
    rows,
    hays: rows.map((r) => buildHay({ name: r[2], variant: r[3], brand: r[1], aliases: r[5], category: r[4] })),
    brands: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    byId: new Map(rows.map((r, i) => [r[0], i])),
  };
}

export function loadFoodDb(): Promise<FoodDb> {
  if (!pending) {
    const url = typeof __FOODDB_URL__ === "string" ? __FOODDB_URL__ : "fooddb.json";
    pending = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { rows: DbRow[] }) => indexRows(j.rows))
      .catch((e) => {
        pending = null; // retry on the next search
        throw e;
      });
  }
  return pending;
}

export function searchDb(db: FoodDb, q: string, limit = 40): DbRow[] {
  return rank(db.rows, (_r, i) => db.hays[i], q, limit);
}

/** The chain a query names on its own ("dominos", "mcd", "tim hortons menu"), or null. */
export function brandMatch(db: FoodDb, q: string): string | null {
  const c = normalize(q).replace(/\b(menu|restaurant|all)\b/g, "").replace(/ /g, "");
  if (c.length < 2) return null;
  for (const b of db.brands) {
    const n = normalize(b.name);
    const names = [n.replace(/ /g, ""), ...(BRAND_NICK[n] ?? "").split(" ").filter(Boolean)];
    if (names.includes(c)) return b.name;
  }
  return null;
}

export function rowsOfBrand(db: FoodDb, brand: string): DbRow[] {
  return db.rows.filter((r) => r[1] === brand);
}

export function rowToFood(r: DbRow): Food {
  const [id, brand, name, variant, category, , servings, unitOnly, kcal, protein, carbs, fat, fiber, sugar, sodiumMg, region] = r;
  const attribution =
    region === "USDA" || region === "FNDDS"
      ? `USDA FOODDATA CENTRAL${region === "FNDDS" ? " · TYPICAL HOME RECIPE" : ""}`
      : `${brand.toUpperCase()} PUBLISHED NUTRITION${region === "US" ? " · US MENU (CANADIAN DATA NOT PUBLISHED)" : " · CANADA"}`;
  return {
    id,
    name: variant && !name.toLowerCase().includes(variant.toLowerCase()) ? `${name}, ${variant}` : name,
    brand: brand || undefined,
    source: "database",
    unitOnly,
    category,
    per100g: { kcal, protein, carbs, fat, fiber, sugar, sodiumMg },
    servings: servings.map(([label, grams]) => ({ label, grams })),
    attribution,
    createdAt: 0,
    lastUsedAt: 0,
    useCount: 0,
  };
}

/** A database food the user has logged before, refreshed from the current database (keeps usage stats). */
export function freshFood(db: FoodDb | null, f: Food): Food {
  const i = f.source === "database" && db ? db.byId.get(f.id) : undefined;
  return i === undefined || !db ? f : { ...rowToFood(db.rows[i]), createdAt: f.createdAt, lastUsedAt: f.lastUsedAt, useCount: f.useCount };
}

/** Search index entry for one of the user's foods (database foods reuse their aliases). */
export function hayOfFood(db: FoodDb | null, f: Food): Hay {
  const i = db ? db.byId.get(f.id) : undefined;
  return i !== undefined && db ? db.hays[i] : buildHay({ name: f.name, brand: f.brand, category: f.category });
}

/** Energy of the first (default) serving, for list rows. */
export function kcalPerServing(f: Food): number {
  const s = f.servings[0];
  return s ? (f.per100g.kcal * s.grams) / 100 : f.per100g.kcal;
}
