import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, parseQuery, buildHay, scoreHay } from "../src/engine/foodsearch";
import { indexRows, rowToFood, searchDb, kcalPerServing, type DbRow } from "../src/ui/fooddb";

const rows: DbRow[] = JSON.parse(readFileSync(join(__dirname, "../src/data/fooddb.json"), "utf8")).rows;
const db = indexRows(rows);
const top = (q: string, n = 5) => searchDb(db, q, n).map((r) => `${r[1]} | ${r[2]}${r[3] ? ` | ${r[3]}` : ""}`);

test("normalize strips apostrophes, accents and joins A&W", () => {
  assert.equal(normalize("Domino's Pizza"), "dominos pizza");
  assert.equal(normalize("Crème brûlée"), "creme brulee");
  assert.equal(normalize("A&W Teen Burger"), "aw teen burger");
  assert.equal(normalize("Tim Hortons® Double-Double"), "tim hortons double double");
});

test("database rows are well formed", () => {
  assert.ok(rows.length > 400, `${rows.length} rows`);
  const ids = new Set<string>();
  for (const r of rows) {
    assert.equal(r.length, 17, r[0]);
    assert.ok(!ids.has(r[0]), `duplicate id ${r[0]}`);
    ids.add(r[0]);
    assert.ok(r[6].length >= 1, `${r[0]} has no serving`);
    for (const [, g] of r[6]) assert.ok(g > 0, `${r[0]} serving grams`);
    const f = rowToFood(r);
    const k = kcalPerServing(f);
    assert.ok(k >= 0 && k < 3000, `${r[0]} kcal/serving ${k}`);
    // Energy agrees with the macros (Atwater) within 20 % for anything with real calories.
    const est = 4 * f.per100g.protein + 4 * f.per100g.carbs + 9 * f.per100g.fat;
    if (f.per100g.kcal >= 30 && !/beer|wine|cider|spirit/i.test(r[2])) assert.ok(Math.abs(est - f.per100g.kcal) / f.per100g.kcal <= 0.2, `${r[0]} atwater`);
  }
});

test("'dominos pizza 3 meat' finds Domino's MeatZZa and defaults to one slice", () => {
  const hits = searchDb(db, "dominos pizza 3 meat", 5);
  assert.ok(hits.length > 0);
  assert.equal(hits[0][1], "Domino's");
  assert.match(hits[0][2], /MeatZZa|Extravaganzza/i);
  const f = rowToFood(hits[0]);
  assert.match(f.servings[0].label, /slice/i);
  assert.ok(kcalPerServing(f) > 150 && kcalPerServing(f) < 500);
});

test("common phrasings land on the right item", () => {
  assert.match(top("big mac")[0], /McDonald's \| Big Mac/);
  assert.match(top("mcd big mac")[0], /McDonald's \| Big Mac/);
  assert.match(top("bigmac")[0], /Big Mac/);
  assert.match(top("timmies double double")[0], /Tim Hortons \| Double-Double/);
  assert.match(top("double double")[0], /Tim Hortons \| Double-Double/);
  assert.match(top("dominos pizza 3 meat")[0], /Domino's \| MeatZZa/);
  assert.match(top("three meat dominos")[0], /Domino's/);
  assert.ok(top("chiken breast").some((s) => /Chicken breast/i.test(s)), "typo tolerated");
  assert.ok(top("nuggets").some((s) => /nugget/i.test(s)));
});

test("every query word must match (one miss allowed for 3+ words)", () => {
  const q2 = parseQuery("dominos burrito");
  const meatzza = buildHay({ name: "MeatZZa", brand: "Domino's", aliases: ["3 meat"], category: "pizza" });
  assert.equal(scoreHay(meatzza, q2), null);
  const q3 = parseQuery("dominos meat pizza slice");
  const r = scoreHay(meatzza, q3);
  assert.ok(r && r.misses === 1);
  assert.equal(parseQuery("the big mac").length, 2, "stop words dropped");
});

test("name matches rank above alias-only matches", () => {
  const byName = buildHay({ name: "Pepperoni", brand: "Domino's", category: "pizza" });
  const byAlias = buildHay({ name: "Pacific Veggie", brand: "Domino's", aliases: ["pepperoni style"], category: "pizza" });
  const q = parseQuery("pepperoni");
  assert.ok(scoreHay(byName, q)!.s > scoreHay(byAlias, q)!.s);
});
