// AI meal logging: the user describes what they ate in words; an LLM splits it into items and estimates
// each one. Pure functions only (prompt, schema, response parsing); the network call lives in ui/ai.ts.
//
// Accuracy: the prompt carries REFERENCE ITEMS from the built-in database (official restaurant data and
// USDA values) that match the description. When the model says an item is one of them, the app recomputes
// that item from the database itself, so official numbers win over the model's arithmetic.

export interface RefItem {
  /** short id used in the prompt ("R1") */
  ref: string;
  /** database id of the food */
  id: string;
  /** "Domino's MeatZZa, Medium" */
  label: string;
  /** default serving: label and grams (pseudo-grams for unit-only foods, where `weighed` is false) */
  serving: { label: string; grams: number; weighed?: boolean };
  /** nutrition for ONE serving */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type Confidence = "high" | "medium" | "low";

export interface AiItemRaw {
  name: string;
  amount: string;
  ref: string;
  servings: number;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: Confidence;
}

export interface AiItem {
  name: string;
  amount: string;
  grams: number | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: Confidence;
  /** set when the item was matched to the built-in database (values are the database's) */
  refId: string | null;
  servings: number | null;
}

export interface AiResult {
  items: AiItem[];
  note: string;
}

/** JSON schema for strict structured output (every field required, no extras). */
export const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "note"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount", "ref", "servings", "grams", "kcal", "protein", "carbs", "fat", "confidence"],
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
          ref: { type: "string" },
          servings: { type: "number" },
          grams: { type: "number" },
          kcal: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    note: { type: "string" },
  },
} as const;

export const SYSTEM_PROMPT = `You are the food-logging assistant in a personal nutrition tracker (user in Canada). The user describes what they ate. Split it into separate foods and estimate each one.

For each item return:
- name: short food name in English (e.g. "Pepperoni pizza", "Coca-Cola", "Scrambled eggs").
- amount: the amount eaten, as the user said it or your stated assumption (e.g. "2 slices", "1 can (355 mL)", "about 1.5 cups").
- grams: estimated weight eaten in grams (mL for drinks).
- kcal, protein, carbs, fat: totals for the WHOLE amount eaten (not per 100 g). Grams of protein, carbohydrate and fat.
- ref and servings: if the item is the same food as one of the REFERENCE ITEMS, set ref to its id (e.g. "R3") and servings to how many of that reference's serving were eaten (2 slices of a "1 slice" reference = 2; a whole 8-slice pizza = 8). Use the reference's numbers for the totals. Only use a reference for the same food (same restaurant when the user names one, same size when known). Otherwise ref = "" and servings = 0.
- confidence: "high" for reference matches or clear packaged foods, "medium" for normal home portions, "low" when the amount or recipe is very unclear.

Rules:
- Base estimates on USDA / Canadian Nutrient File values and typical portions. When the size is not given, assume a normal adult portion and say so in amount.
- Include drinks, sauces, dressings, butter and cooking oil only when the user mentions them or they are an obvious part of the dish (e.g. a Caesar salad includes its dressing).
- Do not add foods the user did not mention. Do not split one dish into its ingredients unless the user lists them.
- Numbers must be plain numbers; kcal should roughly equal 4×protein + 4×carbs + 9×fat (alcohol aside).
- If the text is not a description of food or drink, return no items and explain in note. Otherwise note is a short remark about any big assumption, or "".
Reply with JSON only.`;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Reference lines for the prompt: "R1 | Domino's MeatZZa, Medium | 1 slice = 113 g | 270 kcal | P 12 | C 26 | F 13". */
export function formatRefs(refs: readonly RefItem[]): string {
  if (!refs.length) return "(none)";
  return refs
    .map((r) => `${r.ref} | ${r.label} | serving: ${r.serving.label}${r.serving.weighed ? ` = ${Math.round(r.serving.grams)} g` : ""} | ${Math.round(r.kcal)} kcal | P ${r1(r.protein)} g | C ${r1(r.carbs)} g | F ${r1(r.fat)} g`)
    .join("\n");
}

export function buildMessages(text: string, refs: readonly RefItem[]): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `REFERENCE ITEMS (nutrition per 1 serving):\n${formatRefs(refs)}\n\nWHAT I ATE:\n${text.trim()}` },
  ];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const ALCOHOL = /\b(beer|lager|ale|ipa|wine|cider|vodka|whisk(e)?y|rum|gin|tequila|bourbon|scotch|liqueur|cocktail|margarita|sangria|shot|seltzer|cooler)\b/i;

/** Extracts the first JSON object from model text (handles ```json fences and stray words). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("The AI reply was not JSON.");
  }
}

/**
 * Validates the model's reply and settles each item's numbers:
 * - a valid reference → recomputed from the database (servings × one serving);
 * - otherwise the model's estimate, cleaned: no negatives, kcal re-derived from the macros when the two
 *   disagree by more than 25 % (alcoholic drinks excepted), items with nothing in them dropped.
 */
export function settleItems(raw: unknown, refs: readonly RefItem[]): AiResult {
  const obj = (raw ?? {}) as { items?: unknown; note?: unknown };
  const list = Array.isArray(obj.items) ? obj.items : [];
  const byRef = new Map(refs.map((r) => [r.ref.toUpperCase(), r]));
  const items: AiItem[] = [];
  for (const it of list.slice(0, 30) as Partial<AiItemRaw>[]) {
    if (!it || typeof it !== "object") continue;
    const name = String(it.name ?? "").trim().slice(0, 80) || "Food";
    const amount = String(it.amount ?? "").trim().slice(0, 60);
    const conf: Confidence = it.confidence === "high" || it.confidence === "low" ? it.confidence : "medium";
    const ref = byRef.get(String(it.ref ?? "").trim().toUpperCase());
    if (ref) {
      let servings = num(it.servings);
      const g = num(it.grams);
      if (!(servings > 0)) servings = g > 0 && ref.serving.grams > 0 ? g / ref.serving.grams : 1;
      servings = Math.min(Math.round(servings * 100) / 100, 50);
      items.push({
        name: ref.label,
        amount: servings === 1 ? ref.serving.label : `${servings} × ${ref.serving.label}`,
        grams: ref.serving.grams * servings,
        kcal: ref.kcal * servings,
        protein: ref.protein * servings,
        carbs: ref.carbs * servings,
        fat: ref.fat * servings,
        confidence: "high",
        refId: ref.id,
        servings,
      });
      continue;
    }
    const p = Math.max(0, Math.min(num(it.protein), 500));
    const c = Math.max(0, Math.min(num(it.carbs), 1000));
    const f = Math.max(0, Math.min(num(it.fat), 500));
    let kcal = Math.max(0, Math.min(num(it.kcal), 8000));
    const atwater = 4 * p + 4 * c + 9 * f;
    const boozy = ALCOHOL.test(`${name} ${amount}`);
    if (atwater > 0 && !boozy && (kcal <= 0 || Math.abs(kcal - atwater) / Math.max(kcal, atwater) > 0.25)) kcal = atwater;
    if (kcal <= 0 && atwater <= 0) continue; // water, black coffee with nothing, or an empty guess
    const grams = num(it.grams);
    items.push({ name, amount, grams: grams > 0 ? Math.min(grams, 5000) : null, kcal, protein: p, carbs: c, fat: f, confidence: conf, refId: null, servings: null });
  }
  return { items, note: String(obj.note ?? "").trim().slice(0, 300) };
}

/** Sum of the items (for the review total). */
export function totalOf(items: readonly Pick<AiItem, "kcal" | "protein" | "carbs" | "fat">[]) {
  return items.reduce((a, b) => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}
