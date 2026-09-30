// OBESITY PROTOCOL: one-tap fast-food combos built from the built-in database (each chain's own published
// numbers). Combos are typical pairings, not the chains' official meal definitions. Pop is generic cola by
// size unless the chain lists its own drink.

import { scale } from "../db/repo";
import type { Food, Nutrients } from "../db/types";
import { rowToFood, type FoodDb } from "./fooddb";
import type { IconName } from "./pixel";

export type Size = "S" | "M" | "L";

export interface Slot {
  /** database id, or one id per size (M is the default and the fallback) */
  id: string | { S?: string; M: string; L?: string };
  /** servings of that item (2 slices, 10 Timbits …) */
  count?: number;
  icon: IconName;
}

export interface Combo {
  id: string;
  name: string;
  slots: Slot[];
  /** adds the pop / diet / water choice */
  drink?: boolean;
  /** chain's own medium drink instead of generic cola (used when M is chosen) */
  drinkM?: string;
}

export interface Chain {
  brand: string;
  icon: IconName;
  combos: Combo[];
}

/** Generic cola by size (mL ≈ g × 0.965): fountain sizes vary by chain, so these are round numbers. */
export const POP_ID = "db-generic-cola-regular";
export const POP_ML: Record<Size, number> = { S: 355, M: 500, L: 650 };
const COLA_DENSITY = 1.037;
export const popGrams = (s: Size) => Math.round(POP_ML[s] * COLA_DENSITY);

const mcd = (x: string) => `db-mcdonald-s-${x}`;
const bk = (x: string) => `db-burger-king-${x}`;
const hv = (x: string) => `db-harvey-s-${x}`;
const kfc = (x: string) => `db-kfc-${x}`;
const pop = (x: string) => `db-popeyes-${x}`;
const mb = (x: string) => `db-mary-brown-s-${x}`;
const cfa = (x: string) => `db-chick-fil-a-${x}`;
const th = (x: string) => `db-tim-hortons-${x}`;
const sb = (x: string) => `db-starbucks-${x}`;
const dq = (x: string) => `db-dairy-queen-${x}`;
const fg = (x: string) => `db-five-guys-${x}`;
const dom = (x: string) => `db-domino-s-${x}`;
const pp = (x: string) => `db-pizza-pizza-${x}`;
const ph = (x: string) => `db-pizza-hut-${x}`;
const pj = (x: string) => `db-papa-john-s-${x}`;
const lc = (x: string) => `db-little-caesars-${x}`;
const tb = (x: string) => `db-taco-bell-${x}`;
const cp = (x: string) => `db-chipotle-${x}`;
const fr = (x: string) => `db-freshii-${x}`;

const mcdFries = { S: mcd("world-famous-fries-small-small"), M: mcd("world-famous-fries-medium-medium"), L: mcd("world-famous-fries-large-large") };
const bkFries = { S: bk("french-fries-small-small"), M: bk("french-fries-medium-medium"), L: bk("french-fries-large-large") };
const bkRings = { S: bk("onion-rings-small-small"), M: bk("onion-rings-medium-medium"), L: bk("onion-rings-large-large") };
const hvFries = { S: hv("fries-kids-kids"), M: hv("fries-regular-regular"), L: hv("fries-large-large") };
const cfaFries = { S: cfa("waffle-potato-fries-small-small"), M: cfa("waffle-potato-fries-medium-medium"), L: cfa("waffle-potato-fries-large-large") };
const dqFries = { M: dq("fries-regular-regular"), L: dq("fries-large-large") };
const dqBlizzard = { S: dq("oreo-cookie-blizzard-small-small"), M: dq("oreo-cookie-blizzard-medium-medium"), L: dq("oreo-cookie-blizzard-large-large") };
const fgFries = { S: fg("fries-little-little"), M: fg("fries-regular-regular"), L: fg("fries-large-large") };
const dd = { S: th("double-double-small-small"), M: th("double-double-medium-medium"), L: th("double-double-large-large") };

export const CHAINS: Chain[] = [
  {
    brand: "Tim Hortons",
    icon: "coffee",
    combos: [
      { id: "th-dd-boston", name: "Double-Double + Boston Cream", slots: [{ id: dd, icon: "coffee" }, { id: th("boston-cream-donut"), icon: "donut" }] },
      {
        id: "th-10-timbits",
        name: "10 Timbits (assorted) + Double-Double",
        slots: [
          { id: th("honey-dip-timbit"), count: 3, icon: "timbits" },
          { id: th("chocolate-glazed-timbit"), count: 3, icon: "timbits" },
          { id: th("sour-cream-glazed-timbit"), count: 2, icon: "timbits" },
          { id: th("birthday-cake-timbit"), count: 2, icon: "timbits" },
          { id: dd, icon: "coffee" },
        ],
      },
      { id: "th-capp-fritter", name: "Iced Capp + Apple Fritter", slots: [{ id: th("original-iced-capp-medium-medium"), icon: "iced" }, { id: th("apple-fritter"), icon: "donut" }] },
      { id: "th-bagel-bfast", name: "Everything Bagel + Hashbrown + Double-Double", slots: [{ id: th("everything-bagel"), icon: "bagel" }, { id: th("hashbrown"), icon: "fries" }, { id: dd, icon: "coffee" }] },
    ],
  },
  {
    brand: "McDonald's",
    icon: "burger",
    combos: [
      { id: "mcd-bigmac", name: "Big Mac Combo", slots: [{ id: mcd("big-mac"), icon: "burger" }, { id: mcdFries, icon: "fries" }], drink: true, drinkM: mcd("coca-cola-medium-medium") },
      { id: "mcd-qpc", name: "Quarter Pounder with Cheese Combo", slots: [{ id: mcd("quarter-pounder-with-cheese"), icon: "burger" }, { id: mcdFries, icon: "fries" }], drink: true, drinkM: mcd("coca-cola-medium-medium") },
      { id: "mcd-10nug", name: "10 McNuggets Combo", slots: [{ id: mcd("chicken-mcnuggets-10-pc-10-pc"), icon: "nuggets" }, { id: mcdFries, icon: "fries" }], drink: true, drinkM: mcd("coca-cola-medium-medium") },
      { id: "mcd-mcchicken", name: "McChicken Combo", slots: [{ id: mcd("mcchicken"), icon: "chicken-sandwich" }, { id: mcdFries, icon: "fries" }], drink: true, drinkM: mcd("coca-cola-medium-medium") },
      { id: "mcd-double", name: "Double Big Mac + Fries + McFlurry", slots: [{ id: mcd("double-big-mac"), icon: "burger" }, { id: mcdFries, icon: "fries" }, { id: mcd("mcflurry-with-oreo-regular-regular"), icon: "icecream" }], drink: true, drinkM: mcd("coca-cola-medium-medium") },
      { id: "mcd-latenight", name: "Late-Night Special: Poutine + McFlurry", slots: [{ id: mcd("poutine"), icon: "poutine" }, { id: mcd("mcflurry-with-oreo-regular-regular"), icon: "icecream" }] },
      { id: "mcd-bfast", name: "Egg McMuffin + Hash Brown", slots: [{ id: mcd("egg-mcmuffin"), icon: "muffin" }, { id: mcd("hash-brown"), icon: "fries" }] },
    ],
  },
  {
    brand: "Harvey's",
    icon: "burger",
    combos: [
      { id: "hv-orig", name: "Original Burger with Cheese Combo", slots: [{ id: hv("original-burger-with-cheese"), icon: "burger" }, { id: hvFries, icon: "fries" }], drink: true },
      { id: "hv-bigharv", name: "Big Harv + Frings", slots: [{ id: hv("big-harv-original-original"), icon: "burger" }, { id: hv("frings"), icon: "rings" }], drink: true },
      { id: "hv-crispy-poutine", name: "Crispy Chicken + Poutine", slots: [{ id: hv("crispy-chicken-sandwich"), icon: "chicken-sandwich" }, { id: { M: hv("classic-poutine-regular-regular"), L: hv("classic-poutine-large-large") }, icon: "poutine" }], drink: true },
      { id: "hv-strips", name: "4 Chicken Strips Combo", slots: [{ id: hv("chicken-strips-4-pc-4-pc"), icon: "nuggets" }, { id: hvFries, icon: "fries" }], drink: true },
    ],
  },
  {
    brand: "Burger King",
    icon: "burger",
    combos: [
      { id: "bk-whopper", name: "Whopper Meal", slots: [{ id: bk("whopper"), icon: "burger" }, { id: bkFries, icon: "fries" }], drink: true },
      { id: "bk-dbl", name: "Double Whopper + Onion Rings", slots: [{ id: bk("double-whopper"), icon: "burger" }, { id: bkRings, icon: "rings" }], drink: true },
      { id: "bk-royal", name: "Royal Crispy Chicken Meal", slots: [{ id: bk("royal-crispy-chicken-classic-classic"), icon: "chicken-sandwich" }, { id: bkFries, icon: "fries" }], drink: true },
      { id: "bk-nug", name: "10 Nuggets Meal", slots: [{ id: bk("chicken-nuggets-10-pc-10-pc"), icon: "nuggets" }, { id: bkFries, icon: "fries" }], drink: true },
    ],
  },
  {
    brand: "KFC",
    icon: "drumstick",
    combos: [
      { id: "kfc-3pc", name: "3-Piece Meal (breast, thigh, drumstick)", slots: [{ id: kfc("original-recipe-breast-keel-keel"), icon: "drumstick" }, { id: kfc("original-recipe-thigh"), icon: "drumstick" }, { id: kfc("original-recipe-drumstick"), icon: "drumstick" }, { id: kfc("seasoned-fries-individual-individual"), icon: "fries" }, { id: kfc("coleslaw-individual-individual"), icon: "bowl" }, { id: kfc("gravy-individual-individual"), icon: "soup" }], drink: true },
      { id: "kfc-famous", name: "Famous Chicken Sandwich Combo", slots: [{ id: kfc("famous-chicken-sandwich"), icon: "chicken-sandwich" }, { id: kfc("seasoned-fries-individual-individual"), icon: "fries" }], drink: true },
      { id: "kfc-bigcrunch", name: "Big Crunch Combo", slots: [{ id: kfc("big-crunch"), icon: "chicken-sandwich" }, { id: kfc("seasoned-fries-individual-individual"), icon: "fries" }], drink: true },
      { id: "kfc-popcorn-poutine", name: "Popcorn Chicken + Poutine", slots: [{ id: kfc("popcorn-chicken-medium-medium"), icon: "nuggets" }, { id: kfc("poutine-regular-regular"), icon: "poutine" }], drink: true },
      { id: "kfc-wings", name: "10 Hot Wings + Fries", slots: [{ id: kfc("hot-wings-10-pc-10-pc"), icon: "wings" }, { id: kfc("seasoned-fries-individual-individual"), icon: "fries" }], drink: true },
    ],
  },
  {
    brand: "Mary Brown's",
    icon: "drumstick",
    combos: [
      { id: "mb-bigmary", name: "Big Mary Combo", slots: [{ id: mb("big-mary"), icon: "chicken-sandwich" }, { id: mb("taters-small-small"), icon: "fries" }], drink: true },
      { id: "mb-2pc", name: "2-Piece Dinner", slots: [{ id: mb("chicken-breast-centre-centre"), icon: "drumstick" }, { id: mb("chicken-thigh"), icon: "drumstick" }, { id: mb("taters-small-small"), icon: "fries" }, { id: mb("coleslaw-small-small"), icon: "bowl" }], drink: true },
      { id: "mb-tenders", name: "3 Tenders Combo", slots: [{ id: mb("chicken-tenders-3-pc-3-pc"), icon: "nuggets" }, { id: mb("fries-small-small"), icon: "fries" }], drink: true },
    ],
  },
  {
    brand: "Popeyes",
    icon: "drumstick",
    combos: [
      { id: "pop-sandwich", name: "Chicken Sandwich Combo", slots: [{ id: pop("chicken-sandwich-classic-classic"), icon: "chicken-sandwich" }, { id: pop("cajun-fries-regular-regular"), icon: "fries" }], drink: true },
      { id: "pop-tenders", name: "3 Tenders Combo", slots: [{ id: pop("tenders-classic-3-pc-classic-3-pc"), icon: "nuggets" }, { id: pop("cajun-fries-regular-regular"), icon: "fries" }, { id: pop("biscuit"), icon: "bread" }], drink: true },
      { id: "pop-2pc", name: "2-Piece (breast + leg) with Mashed + Biscuit", slots: [{ id: pop("chicken-breast-classic-classic"), icon: "drumstick" }, { id: pop("chicken-leg-classic-classic"), icon: "drumstick" }, { id: pop("mashed-potatoes-with-cajun-gravy-regular-regular"), icon: "soup" }, { id: pop("biscuit"), icon: "bread" }], drink: true },
      { id: "pop-wings", name: "6 Hot Wings + Fries", slots: [{ id: pop("signature-hot-wings-6-pc-6-pc"), icon: "wings" }, { id: pop("cajun-fries-regular-regular"), icon: "fries" }], drink: true },
    ],
  },
  {
    brand: "Chick-fil-A",
    icon: "chicken-sandwich",
    combos: [
      { id: "cfa-sandwich", name: "Chicken Sandwich Meal (with lemonade)", slots: [{ id: cfa("chick-fil-a-chicken-sandwich"), icon: "chicken-sandwich" }, { id: cfaFries, icon: "fries" }, { id: cfa("lemonade-medium-medium"), icon: "drink" }] },
      { id: "cfa-12", name: "12-Count Nuggets Meal (with lemonade)", slots: [{ id: cfa("nuggets-12-pc-12-pc"), icon: "nuggets" }, { id: cfaFries, icon: "fries" }, { id: cfa("lemonade-medium-medium"), icon: "drink" }] },
      { id: "cfa-spicy", name: "Spicy Deluxe Meal (with lemonade)", slots: [{ id: cfa("spicy-deluxe-sandwich"), icon: "chicken-sandwich" }, { id: cfaFries, icon: "fries" }, { id: cfa("lemonade-medium-medium"), icon: "drink" }] },
    ],
  },
  {
    brand: "Dairy Queen",
    icon: "icecream",
    combos: [
      { id: "dq-blizzard-combo", name: "Double Cheeseburger + Fries + Oreo Blizzard", slots: [{ id: dq("original-cheeseburger-double-double"), icon: "burger" }, { id: dqFries, icon: "fries" }, { id: dqBlizzard, icon: "icecream" }] },
      { id: "dq-flame", name: "FlameThrower Stackburger Combo", slots: [{ id: dq("flamethrower-stackburger-double-double"), icon: "burger" }, { id: dqFries, icon: "fries" }], drink: true },
      { id: "dq-basket", name: "4-Strip Basket + Blizzard", slots: [{ id: dq("chicken-strip-basket-4-pc-4-piece"), icon: "nuggets" }, { id: dqBlizzard, icon: "icecream" }] },
    ],
  },
  {
    brand: "Five Guys",
    icon: "hotdog",
    combos: [
      { id: "fg-dog", name: "Hot Dog + Fries + Chocolate Shake", slots: [{ id: fg("hot-dog"), icon: "hotdog" }, { id: fgFries, icon: "fries" }, { id: fg("chocolate-milkshake"), icon: "shake" }] },
      { id: "fg-cajun", name: "Cajun Fries + Chocolate Shake (no burger, allegedly)", slots: [{ id: fg("cajun-fries-regular-regular"), icon: "fries" }, { id: fg("chocolate-milkshake"), icon: "shake" }] },
    ],
  },
  {
    brand: "Domino's",
    icon: "pizza",
    combos: [
      { id: "dom-2meat", name: "2 Slices MeatZZa (L) + Cheesy Bread", slots: [{ id: dom("meatzza-large"), count: 2, icon: "pizza" }, { id: dom("cheesy-bread"), icon: "bread" }], drink: true },
      { id: "dom-half", name: "Half a Large Pepperoni + Lava Cake", slots: [{ id: dom("pepperoni-large-hand-tossed"), count: 4, icon: "pizza" }, { id: dom("chocolate-lava-crunch-cake"), icon: "cake" }], drink: true },
      { id: "dom-solo", name: "Solo Run: Whole Large Pepperoni", slots: [{ id: dom("pepperoni-large-hand-tossed"), count: 8, icon: "pizza" }], drink: true },
      { id: "dom-wings", name: "2 Slices Pepperoni + 6 Hot Wings", slots: [{ id: dom("pepperoni-large-hand-tossed"), count: 2, icon: "pizza" }, { id: dom("hot-wings"), count: 3, icon: "wings" }], drink: true },
    ],
  },
  {
    brand: "Pizza Pizza",
    icon: "pizza",
    combos: [
      { id: "pp-2slice", name: "2 Slices Meat Supreme (M) + Pop", slots: [{ id: pp("meat-supreme-pizza-medium"), count: 2, icon: "pizza" }], drink: true },
      { id: "pp-poutine", name: "2 Slices Cheese + Poutine", slots: [{ id: pp("classic-cheese-pizza-medium"), count: 2, icon: "pizza" }, { id: pp("classic-poutine"), icon: "poutine" }], drink: true },
      { id: "pp-wings", name: "5 Wings + Garlic Cheese Fingers", slots: [{ id: pp("crispy-breaded-wings"), icon: "wings" }, { id: pp("garlic-cheese-fingers"), icon: "bread" }], drink: true },
    ],
  },
  {
    brand: "Pizza Hut",
    icon: "pizza",
    combos: [
      { id: "ph-3slice", name: "3 Slices Pepperoni Pan (L) + 2 Breadsticks", slots: [{ id: ph("pepperoni-large-pan"), count: 3, icon: "pizza" }, { id: ph("breadstick"), count: 2, icon: "bread" }], drink: true },
      { id: "ph-personal", name: "Personal Pan Meat Lover's + Lava Cake", slots: [{ id: ph("meat-lover-s-6-personal-pan"), icon: "pizza" }, { id: ph("caramel-chocolate-lava-cake"), icon: "cake" }], drink: true },
    ],
  },
  {
    brand: "Papa John's",
    icon: "pizza",
    combos: [
      { id: "pj-meats", name: "2 Slices The Meats (L) + 2 Garlic Knots", slots: [{ id: pj("the-meats-large-original"), count: 2, icon: "pizza" }, { id: pj("garlic-knots"), count: 2, icon: "bread" }], drink: true },
      { id: "pj-wings", name: "2 Slices Pepperoni + 8 Buffalo Wings", slots: [{ id: pj("pepperoni-large-original"), count: 2, icon: "pizza" }, { id: pj("buffalo-wings"), icon: "wings" }], drink: true },
    ],
  },
  {
    brand: "Little Caesars",
    icon: "pizza",
    combos: [
      { id: "lc-half", name: "Half a Classic Pepperoni + Crazy Bread", slots: [{ id: lc("classic-pepperoni-large-classic"), count: 4, icon: "pizza" }, { id: lc("crazy-bread"), icon: "bread" }], drink: true },
      { id: "lc-solo", name: "Solo Run: Whole 3 Meat Treat", slots: [{ id: lc("3-meat-treat-large-specialty"), count: 8, icon: "pizza" }], drink: true },
    ],
  },
  {
    brand: "Taco Bell",
    icon: "taco",
    combos: [
      { id: "tb-crunchwrap", name: "Crunchwrap Supreme + Crunchy Taco", slots: [{ id: tb("crunchwrap-supreme-beef"), icon: "burrito" }, { id: tb("crunchy-taco-beef"), icon: "taco" }], drink: true },
      { id: "tb-burrito", name: "Burrito Supreme + 2 Crunchy Tacos", slots: [{ id: tb("burrito-supreme-beef"), icon: "burrito" }, { id: tb("crunchy-taco-beef"), count: 2, icon: "taco" }], drink: true },
      { id: "tb-gordita", name: "Cheesy Gordita Crunch + Nachos Supreme", slots: [{ id: tb("cheesy-gordita-crunch"), icon: "taco" }, { id: tb("nachos-supreme"), icon: "chips" }], drink: true },
      { id: "tb-quesadilla", name: "Chicken Quesadilla + Cinnamon Twists", slots: [{ id: tb("chicken-quesadilla"), icon: "taco" }, { id: tb("cinnamon-twists"), icon: "rings" }], drink: true },
    ],
  },
  {
    brand: "Chipotle",
    icon: "burrito",
    combos: [
      { id: "cp-steak", name: "Steak Burrito + Chips", slots: [{ id: cp("steak-burrito"), icon: "burrito" }, { id: cp("chips"), icon: "chips" }], drink: true },
      { id: "cp-bowl", name: "Chicken Bowl with Guac + Chips", slots: [{ id: cp("chicken-burrito-bowl-with-guacamole"), icon: "bowl" }, { id: cp("chips"), icon: "chips" }], drink: true },
    ],
  },
  {
    brand: "Freshii",
    icon: "bowl",
    combos: [
      { id: "fr-bowl-soup", name: "Chiipotle Cheddar Bowl + Soup", slots: [{ id: fr("chiipotle-cheddar-bowl"), icon: "bowl" }, { id: fr("spicy-lemongrass-soup-small"), icon: "soup" }] },
      { id: "fr-roll", name: "Texas Smokehouse Roll + Soup (still counts)", slots: [{ id: fr("texas-smokehouse-roll"), icon: "burrito" }, { id: fr("spicy-lemongrass-soup-small"), icon: "soup" }] },
    ],
  },
  {
    brand: "Starbucks",
    icon: "iced",
    combos: [
      { id: "sb-frapp", name: "Caramel Frappuccino + Chocolate Croissant", slots: [{ id: sb("caramel-frappuccino-grande-grande-whole-milk-whipped-cream"), icon: "iced" }, { id: sb("chocolate-croissant"), icon: "croissant" }] },
      { id: "sb-psl", name: "Pumpkin Spice Latte + Butter Croissant", slots: [{ id: sb("pumpkin-spice-latte-grande-grande-2-milk-whipped-cream"), icon: "coffee" }, { id: sb("butter-croissant"), icon: "croissant" }] },
      { id: "sb-latte", name: "Latte + Turkey Bacon Egg White Sandwich", slots: [{ id: sb("caffe-latte-grande-grande-2-milk"), icon: "coffee" }, { id: sb("bacon-style-turkey-cheddar-egg-white-sandwich"), icon: "muffin" }] },
    ],
  },
];

/** The id a slot uses at a size (falls back to M). */
export const slotId = (s: Slot, size: Size): string => (typeof s.id === "string" ? s.id : s.id[size] ?? s.id.M);
export const sized = (c: Combo) => c.slots.some((s) => typeof s.id !== "string" && (s.id.S || s.id.L));

/** Every database id the combos use (checked by a test against the database). */
export const comboIds = (): string[] =>
  [...new Set(CHAINS.flatMap((ch) => ch.combos.flatMap((c) => [...c.slots.flatMap((s) => (typeof s.id === "string" ? [s.id] : Object.values(s.id).filter(Boolean) as string[])), ...(c.drinkM ? [c.drinkM] : []), ...(c.drink ? [POP_ID] : [])])))];

/** Damage rating by combo energy. */
export function damage(kcal: number): { word: string; tone: "grn" | "am" | "red"; blink: boolean } {
  if (kcal < 600) return { word: "SNACK-GRADE", tone: "grn", blink: false };
  if (kcal < 900) return { word: "MODERATE DAMAGE", tone: "am", blink: false };
  if (kcal < 1200) return { word: "HEAVY DAMAGE", tone: "red", blink: false };
  return { word: "CRITICAL MASS", tone: "red", blink: true };
}

export const INGEST_QUIPS = ["ARTERIES NOTIFIED", "CARDIO RECOMMENDED", "NO REGRETS DETECTED", "WORTH IT (PROBABLY)", "FLAVOUR TOWN REACHED", "TREADMILL ON STANDBY"];

// ---- resolving a combo ------------------------------------------------------------------------------

export type Drink = "pop" | "diet" | "water";

export interface Line {
  food: Food | null; // null = zero-calorie drink shown but not logged
  name: string;
  label: string;
  grams: number;
  icon: IconName;
  n: Nutrients;
}

const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
export const SIZE_WORD: Record<Size, string> = { S: "SMALL", M: "MEDIUM", L: "LARGE" };

/** The combo's items at a size and drink choice, with their numbers. */
export function resolveCombo(db: FoodDb, c: Combo, size: Size, drink: Drink): Line[] {
  const line = (id: string, count: number, icon: IconName): Line | null => {
    const i = db.byId.get(id);
    if (i === undefined) return null;
    const food = rowToFood(db.rows[i]);
    const s = food.servings[0];
    const grams = s.grams * count;
    return { food, name: food.name, label: count === 1 ? s.label : `${count} × ${s.label}`, grams, icon, n: scale(food.per100g, grams) };
  };
  const out: Line[] = [];
  for (const s of c.slots) {
    const l = line(slotId(s, size), s.count ?? 1, s.icon);
    if (l) out.push(l);
  }
  if (c.drink) {
    if (drink === "pop") {
      const own = size === "M" && c.drinkM ? line(c.drinkM, 1, "drink") : null;
      if (own) out.push(own);
      else {
        const i = db.byId.get(POP_ID);
        if (i !== undefined) {
          const food = rowToFood(db.rows[i]);
          const grams = popGrams(size);
          out.push({ food, name: `Pop, ${SIZE_WORD[size].toLowerCase()}`, label: `${POP_ML[size]} mL (fountain sizes vary)`, grams, icon: "drink", n: scale(food.per100g, grams) });
        }
      }
    } else out.push({ food: null, name: drink === "diet" ? "Diet pop" : "Water", label: "0 kcal · not logged", grams: 0, icon: "drink", n: ZERO });
  }
  return out;
}

export const totalOf = (lines: Line[]): Nutrients =>
  lines.reduce((a, l) => ({ kcal: a.kcal + l.n.kcal, protein: a.protein + l.n.protein, carbs: a.carbs + l.n.carbs, fat: a.fat + l.n.fat }), { ...ZERO });

