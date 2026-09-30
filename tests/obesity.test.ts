import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indexRows, type DbRow } from "../src/ui/fooddb";
import { CHAINS, comboIds, damage, POP_ID, popGrams, resolveCombo, totalOf } from "../src/ui/combos";
import { ICON_NAMES } from "../src/ui/pixel";
import { beatPlan, beatWindow, ecgAt } from "../src/engine/vitals";

const rows: DbRow[] = JSON.parse(readFileSync(join(__dirname, "../src/data/fooddb.json"), "utf8")).rows;
const db = indexRows(rows);

test("every combo item exists in the database", () => {
  const missing = comboIds().filter((id) => !db.byId.has(id));
  assert.deepEqual(missing, []);
  assert.ok(CHAINS.length >= 15);
  for (const ch of CHAINS) assert.ok(ch.combos.length >= 2, ch.brand);
});

test("a Big Mac combo adds up from the official items", () => {
  const c = CHAINS.find((x) => x.brand === "McDonald's")!.combos.find((x) => x.id === "mcd-bigmac")!;
  const m = resolveCombo(db, c, "M", "pop");
  assert.deepEqual(m.map((l) => l.name), ["Big Mac", "World Famous Fries (Medium)", "Coca-Cola (Medium)"]);
  assert.equal(Math.round(totalOf(m).kcal), 570 + 350 + 190);
  const large = resolveCombo(db, c, "L", "diet");
  assert.match(large[1].name, /Large/);
  assert.equal(large[2].food, null, "diet pop is shown but not logged");
  assert.equal(large[2].n.kcal, 0);
  const smallPop = resolveCombo(db, c, "S", "pop")[2];
  assert.equal(smallPop.food?.id, POP_ID);
  assert.equal(smallPop.grams, popGrams("S"));
});

test("counts multiply servings (2 slices, 10 Timbits)", () => {
  const dom = CHAINS.find((x) => x.brand === "Domino's")!.combos.find((x) => x.id === "dom-solo")!;
  const [pizza] = resolveCombo(db, dom, "M", "water");
  assert.match(pizza.label, /^8 × 1 slice/);
  assert.equal(Math.round(pizza.n.kcal), 8 * 290);
  const tim = CHAINS.find((x) => x.brand === "Tim Hortons")!.combos.find((x) => x.id === "th-10-timbits")!;
  const lines = resolveCombo(db, tim, "M", "pop");
  const bits = lines.filter((l) => /Timbit/.test(l.name)).reduce((a, l) => a + Number(l.label.split(" ")[0] === "1" ? 1 : l.label.split(" ")[0]), 0);
  assert.equal(bits, 10);
});

test("damage ratings and icons", () => {
  assert.equal(damage(450).word, "SNACK-GRADE");
  assert.equal(damage(850).tone, "am");
  assert.equal(damage(1100).word, "HEAVY DAMAGE");
  assert.equal(damage(1500).blink, true);
  for (const ch of CHAINS) {
    assert.ok(ICON_NAMES.includes(ch.icon), ch.icon);
    for (const c of ch.combos) for (const s of c.slots) assert.ok(ICON_NAMES.includes(s.icon), `${c.id} ${s.icon}`);
  }
});

test("beat plan follows resting HR and spreads with HRV", () => {
  const p = beatPlan(60, 40, "2026-09-29");
  assert.ok(Math.abs(p.cycle / 16 - 1000) < 120, `mean RR ${p.cycle / 16}`);
  const rr = p.cum.slice(1, 17).map((t, i) => p.cum[i + 2] - t);
  const low = beatPlan(60, 5, "x");
  const lowRr = low.cum.slice(1, 17).map((t, i) => low.cum[i + 2] - t);
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  assert.ok(spread(rr) > spread(lowRr), "higher HRV = more variable spacing");
  assert.deepEqual(beatPlan(60, 40, "2026-09-29"), p, "stable for the same day");
  // R peak is the tallest point; beatWindow finds the latest R before t
  const r = p.cum[3];
  assert.ok(ecgAt(p, r) > 0.9);
  assert.ok(ecgAt(p, r + 30) < 0);
  assert.equal(Math.round(beatWindow(p, r + 50).off - p.cum[beatWindow(p, r + 50).i]), 50);
});
