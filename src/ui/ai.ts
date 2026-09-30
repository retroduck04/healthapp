// AI meal logging: key storage, reference selection and the call to an OpenAI-compatible chat API.
//
// Provider: Groq's free plan (console.groq.com) by default. It accepts calls straight from a browser
// (CORS), which a static GitHub Pages app needs; NVIDIA's build.nvidia.com API does not. Any other
// OpenAI-compatible endpoint that allows browser calls (OpenRouter, Mistral, …) works through CONFIG.
// The key is stored on this phone only (IndexedDB meta "ai") and is left out of backups.

import { del, get, put } from "../db/db";
import { scale } from "../db/repo";
import { buildMessages, extractJson, MEAL_SCHEMA, settleItems, type AiResult, type RefItem } from "../engine/aimeal";
import { rowToFood, searchDb, type FoodDb } from "./fooddb";

export interface AiConfig {
  key: string;
  model: string;
  baseUrl: string;
}

export const AI_DEFAULTS = { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" } as const;
export const AI_META_KEY = "ai";

export async function getAiConfig(): Promise<AiConfig | null> {
  const row = await get<{ key: string; value: Partial<AiConfig> }>("meta", AI_META_KEY);
  const v = row?.value;
  if (!v?.key) return null;
  return { key: v.key, model: v.model || AI_DEFAULTS.model, baseUrl: v.baseUrl || AI_DEFAULTS.baseUrl };
}

export async function setAiConfig(c: AiConfig | null): Promise<void> {
  if (!c) await del("meta", AI_META_KEY);
  else await put("meta", { key: AI_META_KEY, value: { key: c.key.trim(), model: c.model.trim() || AI_DEFAULTS.model, baseUrl: c.baseUrl.trim() || AI_DEFAULTS.baseUrl } });
}

/** "gsk_…WXYZ" */
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "SET");

// ---- references from the built-in database -----------------------------------------------------

const FILLER =
  /\b(\d+(\.\d+)?|a|an|the|of|some|few|couple|i|had|ate|eat|eaten|drank|for|my|today|tonight|yesterday|this|morning|afternoon|evening|slices?|pieces?|pcs?|cups?|bowls?|plates?|cans?|bottles?|glass(es)?|servings?|portions?|handful|scoops?|tbsp|tsp|g|grams?|oz|ml|l|half|whole|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;

/** Splits "2 slices of dominos meatzza and a coke, fries" into search phrases. */
export function mealPhrases(text: string): string[] {
  return text
    .toLowerCase()
    .split(/,|;|\n|\+|&|\band\b|\bwith\b|\bplus\b|\bthen\b/)
    .map((s) => s.replace(FILLER, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2)
    .slice(0, 12);
}

/** Database foods that probably appear in the description, as prompt references R1…Rn. */
export function referenceItems(db: FoodDb, text: string, max = 24): RefItem[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id) && ids.length < max) ids.push(id);
  };
  for (const p of mealPhrases(text)) for (const r of searchDb(db, p, 4)) add(r[0]);
  return ids.map((id, n) => {
    const f = rowToFood(db.rows[db.byId.get(id)!]);
    const s = f.servings[0] ?? { label: "100 g", grams: 100 };
    const per = scale(f.per100g, s.grams);
    return {
      ref: `R${n + 1}`,
      id,
      label: f.brand ? `${f.brand} ${f.name}` : f.name,
      serving: { label: s.label, grams: s.grams, weighed: !f.unitOnly },
      kcal: per.kcal,
      protein: per.protein,
      carbs: per.carbs,
      fat: per.fat,
    };
  });
}

// ---- the call ---------------------------------------------------------------------------------------

export class AiError extends Error {}

async function post(url: string, key: string, body: unknown, ms = 60000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch {
    throw new AiError("ERR 013 AI UNREACHABLE · CHECK THE CONNECTION");
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the description; returns settled items (database values where the model matched a reference). */
export async function analyzeMeal(text: string, cfg: AiConfig, db: FoodDb | null): Promise<AiResult> {
  const refs = db ? referenceItems(db, text) : [];
  const messages = buildMessages(text, refs);
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const reasoning = /gpt-oss/i.test(cfg.model) ? { reasoning_effort: "low" } : {};
  // Strict JSON schema first; fall back for providers or models that don't support it.
  const formats: Record<string, unknown>[] = [
    { response_format: { type: "json_schema", json_schema: { name: "meal_items", strict: true, schema: MEAL_SCHEMA } } },
    { response_format: { type: "json_object" } },
    {},
  ];
  let lastError = "";
  for (const fmt of formats) {
    const res = await post(url, cfg.key, { model: cfg.model, messages, temperature: 0.2, max_completion_tokens: 2500, ...reasoning, ...fmt });
    if (res.status === 401 || res.status === 403) throw new AiError("ERR 011 AI KEY REJECTED · CHECK CONFIG → 7. AI");
    if (res.status === 429) throw new AiError("WARN 012 AI BUSY (FREE-PLAN LIMIT) · TRY AGAIN IN A MINUTE");
    if (res.status === 400 || res.status === 422) {
      lastError = (await res.text().catch(() => "")).slice(0, 160);
      if (/response_format|json_schema|json_object|schema|reasoning/i.test(lastError)) continue;
      throw new AiError(`ERR 015 AI REQUEST REJECTED · ${lastError.replace(/[{}"]/g, " ").trim().slice(0, 90).toUpperCase()}`);
    }
    if (!res.ok) throw new AiError(`ERR 013 AI SERVICE ERROR · HTTP ${res.status}`);
    const j = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const content = j?.choices?.[0]?.message?.content ?? "";
    try {
      return settleItems(extractJson(content), refs);
    } catch {
      lastError = "unreadable reply";
      continue;
    }
  }
  throw new AiError(`ERR 014 AI REPLY UNREADABLE${lastError ? ` · ${lastError.slice(0, 60).toUpperCase()}` : ""}`);
}
