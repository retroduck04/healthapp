// Garmin data: decrypts the files written by the GitHub sync job and merges them into the app.

import { getAll, get, put, putMany } from "./db";
import type { CardioModality, CardioSession, CardioType, GarminActivityRecord, GarminDay, WeightEntry } from "./types";

const AAD = new TextEncoder().encode("janos-v1");

export interface GarminStatus {
  key: "garminStatus";
  lastAttempt: number | null;
  lastSuccess: number | null;
  generatedAt: string | null;
  days: number;
  activities: number;
  lastErrors: string[];
  message: string | null;
}

const emptyStatus: GarminStatus = {
  key: "garminStatus",
  lastAttempt: null,
  lastSuccess: null,
  generatedAt: null,
  days: 0,
  activities: 0,
  lastErrors: [],
  message: null,
};

// ---- key ------------------------------------------------------------------

export const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

export const fromBase64 = (b64: string): Uint8Array => {
  const s = atob(b64.trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export async function getGarminKey(): Promise<string | null> {
  return (await get<{ key: string; value: string }>("meta", "garminKey"))?.value ?? null;
}

export async function setGarminKey(b64: string): Promise<void> {
  const bytes = fromBase64(b64);
  if (bytes.length !== 32) throw new Error("That key isn't valid (it must be 44 characters ending in '=').");
  await put("meta", { key: "garminKey", value: b64.trim() });
}

export async function createGarminKey(): Promise<string> {
  const k = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  await setGarminKey(k);
  return k;
}

export async function getGarminStatus(): Promise<GarminStatus> {
  return (await get<GarminStatus>("meta", "garminStatus")) ?? emptyStatus;
}

// ---- decryption -----------------------------------------------------------

export async function decryptBlob(keyB64: string, blob: Uint8Array): Promise<unknown> {
  const key = await crypto.subtle.importKey("raw", fromBase64(keyB64) as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) as BufferSource, additionalData: AAD as BufferSource }, key, blob.slice(12) as BufferSource),
  );
  const stream = new Blob([plain as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

// ---- mapping ----------------------------------------------------------------

export interface GarminSummary {
  version: number;
  generatedAt?: string;
  days: Record<string, GarminDay>;
  activities: Record<string, GarminActivity>;
  weights?: { t: string | number; kg: number; sourceType?: string }[];
  lastErrors?: string[];
}

export interface GarminActivity {
  id: number | string;
  name: string | null;
  type: string | null;
  startGMT: string | null;
  startLocal: string | null;
  durationSec: number | null;
  movingSec: number | null;
  distanceM: number | null;
  avgHR: number | null;
  maxHR: number | null;
  kcal: number | null;
  avgSpeed: number | null;
  elevGain: number | null;
  aerobicTE: number | null;
  anaerobicTE: number | null;
  zonesSec: (number | null)[] | null;
  trainingLoad: number | null;
}

const STRENGTH_TYPES = new Set(["strength_training", "indoor_strength_training"]);

export function modalityFor(typeKey: string | null): CardioModality | null {
  const t = (typeKey ?? "").toLowerCase();
  if (STRENGTH_TYPES.has(t)) return null;
  if (t.includes("treadmill")) return "treadmill-run";
  if (t.includes("trail") || t === "running" || t.includes("track_running") || t.includes("street_running")) return "outdoor-run";
  if (t.includes("indoor_cycling") || t.includes("virtual_ride")) return "stationary-bike";
  if (t.includes("cycling") || t.includes("biking") || t.includes("ride")) return "outdoor-bike";
  if (t.includes("elliptical")) return "elliptical";
  if (t.includes("stair")) return "stair-climber";
  if (t.includes("rowing")) return "rower";
  if (t.includes("hiking")) return "hike";
  if (t.includes("walking")) return "walk";
  if (t.includes("running")) return "outdoor-run";
  return "other";
}

export function sessionTypeFor(te: number | null): CardioType {
  if (te === null || te === undefined) return "recreational";
  if (te < 2) return "recovery";
  if (te < 3) return "easy";
  if (te < 4) return "tempo";
  return "threshold";
}

/** Garmin's "YYYY-MM-DD HH:MM:SS" (GMT) or epoch ms → epoch ms. */
export function parseGarminTime(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(`${v.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z"}`);
  return Number.isFinite(t) ? t : null;
}

export function activityToCardio(a: GarminActivity, existing?: CardioSession): CardioSession | null {
  const modality = modalityFor(a.type);
  const start = parseGarminTime(a.startGMT);
  if (!modality || start === null || !a.durationSec) return null;
  const base: CardioSession = {
    id: `garmin-${a.id}`,
    start,
    minutes: Math.round(a.durationSec / 60),
    modality,
    sessionType: sessionTypeFor(a.aerobicTE),
    distanceKm: a.distanceM ? a.distanceM / 1000 : null,
    avgHR: a.avgHR ? Math.round(a.avgHR) : null,
    maxHR: a.maxHR ? Math.round(a.maxHR) : null,
    rpe: null,
    source: "garmin",
    garminId: String(a.id),
    garminName: a.name ?? undefined,
    kcal: a.kcal,
    aerobicTE: a.aerobicTE,
    zonesSec: a.zonesSec,
  };
  if (existing?.editedByUser) {
    return {
      ...base,
      modality: existing.modality,
      sessionType: existing.sessionType,
      rpe: existing.rpe,
      notes: existing.notes,
      machine: existing.machine,
      editedByUser: true,
      hidden: existing.hidden,
    };
  }
  return existing?.hidden ? { ...base, hidden: true } : base;
}

// ---- sync -------------------------------------------------------------------

let syncing: Promise<GarminStatus> | null = null;

/**
 * Where the encrypted summary can be downloaded from. The app's own site is first; on GitHub Pages the
 * raw repository copy is also tried, because it updates as soon as the sync job commits (Pages can lag).
 */
function summaryUrls(): string[] {
  const t = Date.now();
  const urls = [`data/summary.enc?t=${t}`];
  const host = location.hostname;
  if (host.endsWith(".github.io")) {
    const owner = host.split(".")[0];
    const first = location.pathname.split("/").filter(Boolean)[0];
    const repo = first && first !== "index.html" ? first : host;
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/main/docs/data/summary.enc?t=${t}`);
  }
  return urls;
}

/** Downloads the encrypted Garmin summary, decrypts it and merges it in. */
export function syncGarmin(force = false): Promise<GarminStatus> {
  if (syncing) return syncing;
  syncing = (async () => {
    const status = await getGarminStatus();
    const key = await getGarminKey();
    if (!key) return status;
    if (!force && status.lastAttempt && Date.now() - status.lastAttempt < 20 * 60000) return status;
    const next: GarminStatus = { ...status, lastAttempt: Date.now() };
    let found = 0;
    let locked = 0;
    let httpError: number | null = null;
    let networkError: string | null = null;
    let best: GarminSummary | null = null;
    for (const url of summaryUrls()) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 404) continue;
        if (!res.ok) {
          httpError = res.status;
          continue;
        }
        found++;
        const summary = (await decryptBlob(key, new Uint8Array(await res.arrayBuffer())).catch(() => null)) as GarminSummary | null;
        if (!summary) {
          locked++;
          continue;
        }
        if (!best || (summary.generatedAt ?? "") > (best.generatedAt ?? "")) best = summary;
      } catch (e) {
        networkError = (e as Error).message;
      }
    }
    if (best) {
      await mergeSummary(best);
      next.lastSuccess = Date.now();
      next.generatedAt = best.generatedAt ?? null;
      next.days = Object.keys(best.days ?? {}).length;
      next.activities = Object.keys(best.activities ?? {}).length;
      next.lastErrors = best.lastErrors ?? [];
      next.message = null;
    } else if (found && locked === found) {
      next.message = "Garmin data couldn't be unlocked: the key in the app doesn't match the JANOS_DATA_KEY secret on GitHub.";
    } else if (httpError !== null) {
      next.message = `Couldn't download Garmin data (HTTP ${httpError}).`;
    } else if (networkError !== null && !found) {
      next.message = `Offline or unreachable: ${networkError}`;
    } else {
      next.message = "Waiting for the first Garmin sync to run on GitHub.";
    }
    await put("meta", next);
    return next;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function mergeSummary(summary: GarminSummary): Promise<void> {
  const days = Object.values(summary.days ?? {});
  if (days.length) await putMany("garminDays", days);

  const records: GarminActivityRecord[] = [];
  for (const a of Object.values(summary.activities ?? {})) {
    const start = parseGarminTime(a.startGMT);
    if (start === null || a.id === null || a.id === undefined) continue;
    records.push({
      id: String(a.id),
      start,
      minutes: a.durationSec ? Math.round(a.durationSec / 60) : 0,
      type: a.type,
      name: a.name,
      trainingLoad: a.trainingLoad ?? null,
      avgHR: a.avgHR,
      maxHR: a.maxHR,
      kcal: a.kcal,
      aerobicTE: a.aerobicTE,
      anaerobicTE: a.anaerobicTE,
      zonesSec: a.zonesSec,
    });
  }
  if (records.length) await putMany("garminActivities", records);

  const existing = new Map((await getAll<CardioSession>("cardio")).map((c) => [c.id, c]));
  const cardio = Object.values(summary.activities ?? {})
    .map((a) => activityToCardio(a, existing.get(`garmin-${a.id}`)))
    .filter((c): c is CardioSession => c !== null);
  if (cardio.length) await putMany("cardio", cardio);

  const weights: WeightEntry[] = (summary.weights ?? [])
    .map((w) => ({ t: parseGarminTime(w.t), kg: w.kg }))
    .filter((w): w is { t: number; kg: number } => w.t !== null && w.kg > 20 && w.kg < 400)
    .map((w) => ({ id: `garmin-w-${w.t}`, t: w.t, kg: w.kg, source: "import", quality: "imported" }));
  if (weights.length) await putMany("weights", weights);
}

export async function listGarminDays(): Promise<GarminDay[]> {
  return (await getAll<GarminDay>("garminDays")).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function listGarminActivities(): Promise<GarminActivityRecord[]> {
  return (await getAll<GarminActivityRecord>("garminActivities")).sort((a, b) => a.start - b.start);
}
