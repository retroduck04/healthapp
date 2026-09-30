import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMessages, extractJson, MEAL_SCHEMA, settleItems, totalOf, type RefItem } from "../src/engine/aimeal";
import { indexRows, type DbRow } from "../src/ui/fooddb";
import { mealPhrases, referenceItems } from "../src/ui/ai";

const rows: DbRow[] = JSON.parse(readFileSync(join(__dirname, "../src/data/fooddb.json"), "utf8")).rows;
const db = indexRows(rows);

const REF: RefItem = { ref: "R1", id: "db-x", label: "Domino's MeatZZa, Medium", serving: { label: "1 slice", grams: 113 }, kcal: 270, protein: 12, carbs: 26, fat: 13 };

test("phrases drop amounts and filler words", () => {
  assert.deepEqual(mealPhrases("I had 2 slices of dominos meatzza and a coke, plus fries"), ["dominos meatzza", "coke", "fries"]);
  assert.deepEqual(mealPhrases("chicken breast with 1 cup rice"), ["chicken breast", "rice"]);
});

test("references include the database items the description names", () => {
  const refs = referenceItems(db, "2 slices of dominos meatzza and a coke");
  assert.ok(refs.some((r) => /MeatZZa/.test(r.label)), refs.map((r) => r.label).join("; "));
  assert.ok(refs.some((r) => /Cola/i.test(r.label)), refs.map((r) => r.label).join("; "));
  assert.equal(refs[0].ref, "R1");
  assert.ok(refs.length <= 24);
  const msg = buildMessages("2 slices of dominos meatzza", refs)[1].content;
  assert.match(msg, /R1 \| Domino's MeatZZa/);
  assert.match(msg, /serving: 1 slice \(medium, 1\/8 pizza\) = 113 g \| 270 kcal/, "weighed servings show grams in the prompt only");
  assert.ok(!/=/.test(refs[0].serving.label), "the serving label itself stays plain");
  assert.match(msg, /WHAT I ATE:\n2 slices of dominos meatzza/);
});

test("a referenced item takes the database numbers, not the model's", () => {
  const r = settleItems({ items: [{ name: "pizza", amount: "2 slices", ref: "r1", servings: 2, grams: 999, kcal: 100, protein: 1, carbs: 1, fat: 1, confidence: "low" }], note: "" }, [REF]);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.refId, "db-x");
  assert.equal(it.kcal, 540);
  assert.equal(it.protein, 24);
  assert.equal(it.grams, 226);
  assert.equal(it.amount, "2 × 1 slice");
  assert.equal(it.confidence, "high");
});

test("servings fall back to grams, then 1", () => {
  const a = settleItems({ items: [{ name: "p", amount: "", ref: "R1", servings: 0, grams: 339, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: "high" }] }, [REF]);
  assert.equal(a.items[0].servings, 3);
  const b = settleItems({ items: [{ name: "p", amount: "", ref: "R1", servings: 0, grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: "high" }] }, [REF]);
  assert.equal(b.items[0].servings, 1);
});

test("estimates are cleaned: macros win when kcal disagrees, alcohol keeps its kcal, empties and junk dropped", () => {
  const r = settleItems(
    {
      items: [
        { name: "Scrambled eggs", amount: "2 eggs", ref: "", servings: 0, grams: 120, kcal: 900, protein: 13, carbs: 2, fat: 15, confidence: "medium" },
        { name: "Beer", amount: "1 can", ref: "", servings: 0, grams: 355, kcal: 153, protein: 1.6, carbs: 12.6, fat: 0, confidence: "high" },
        { name: "Water", amount: "1 glass", ref: "", servings: 0, grams: 250, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: "high" },
        { name: "Toast", amount: "1 slice", ref: "R9", servings: 1, grams: 30, kcal: "80", protein: -3, carbs: 14, fat: 1, confidence: "weird" },
        null,
        "text",
      ],
      note: 42,
    },
    [REF],
  );
  assert.deepEqual(r.items.map((i) => i.name), ["Scrambled eggs", "Beer", "Toast"]);
  assert.equal(r.items[0].kcal, 4 * 13 + 4 * 2 + 9 * 15);
  assert.equal(r.items[1].kcal, 153);
  assert.equal(r.items[2].protein, 0);
  assert.equal(r.items[2].confidence, "medium");
  assert.equal(r.items[2].refId, null, "an unknown ref is treated as an estimate");
  assert.equal(r.note, "42");
  const t = totalOf(r.items);
  assert.ok(Math.abs(t.kcal - (195 + 153 + r.items[2].kcal)) < 1e-9);
});

test("JSON is found inside fences or chatter; garbage throws", () => {
  assert.deepEqual(extractJson('```json\n{"items":[],"note":"x"}\n```'), { items: [], note: "x" });
  assert.deepEqual(extractJson('Sure! {"items":[]} hope that helps'), { items: [] });
  assert.throws(() => extractJson("no json here"));
});

test("strict schema lists every property as required", () => {
  const item = MEAL_SCHEMA.properties.items.items;
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
  assert.equal(item.additionalProperties, false);
});
