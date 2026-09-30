// IndexedDB storage with versioned schema migrations, change notifications, export and restore.
// Everything stays on the device.

import { useEffect, useState } from "react";

export const DB_NAME = "janos";
export const SCHEMA_VERSION = 3;

export type StoreName =
  | "meta"
  | "weights"
  | "foods"
  | "entries"
  | "days"
  | "savedMeals"
  | "exercises"
  | "templates"
  | "workouts"
  | "sets"
  | "cardio"
  | "checkins"
  | "caffeine"
  | "tags"
  | "garminDays"
  | "garminActivities";

export const STORES: StoreName[] = [
  "meta",
  "weights",
  "foods",
  "entries",
  "days",
  "savedMeals",
  "exercises",
  "templates",
  "workouts",
  "sets",
  "cardio",
  "checkins",
  "caffeine",
  "tags",
  "garminDays",
  "garminActivities",
];

type IndexSpec = [name: string, keyPath: string];

// Migration steps: each entry upgrades the database from version (index) to (index + 1).
const migrations: ((db: IDBDatabase) => void)[] = [
  (db) => {
    const make = (name: StoreName, keyPath: string, indexes: IndexSpec[] = []) => {
      const s = db.createObjectStore(name, { keyPath });
      for (const [iname, path] of indexes) s.createIndex(iname, path);
    };
    make("meta", "key");
    make("weights", "id", [["t", "t"]]);
    make("foods", "id", [["barcode", "barcode"], ["lastUsedAt", "lastUsedAt"]]);
    make("entries", "id", [["day", "day"], ["t", "t"]]);
    make("days", "day");
    make("savedMeals", "id");
    make("exercises", "id");
    make("templates", "id");
    make("workouts", "id", [["start", "start"]]);
    make("sets", "id", [["workoutId", "workoutId"], ["exerciseId", "exerciseId"]]);
    make("cardio", "id", [["start", "start"]]);
    make("checkins", "day");
    make("caffeine", "id", [["t", "t"]]);
    make("tags", "id");
  },
  // v2: Garmin daily summaries (sleep, HRV, resting HR, stress, Body Battery, steps…)
  (db) => {
    db.createObjectStore("garminDays", { keyPath: "date" });
  },
  // v3: every Garmin activity (strength included) with Garmin's own training load, for load tracking
  (db) => {
    db.createObjectStore("garminActivities", { keyPath: "id" }).createIndex("start", "start");
  },
];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = ev.oldVersion; v < SCHEMA_VERSION; v++) migrations[v](db);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database upgrade blocked by another open tab."));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

// ---- change notifications -------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

export function notifyChange(): void {
  version++;
  for (const l of listeners) l();
}

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs an async query and re-runs it whenever the database changes. */
export function useLive<T>(query: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const [tick, setTick] = useState(version);
  useEffect(() => onChange(() => setTick((x) => x + 1)), []);
  useEffect(() => {
    let alive = true;
    query().then(
      (v) => alive && setValue(v),
      (e) => console.error(e),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return value;
}

// ---- basic operations -----------------------------------------------------

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function byIndex<T>(store: StoreName, index: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(query)) as Promise<T[]>;
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  await putMany(store, [value]);
}

export async function putMany<T>(store: StoreName, values: readonly T[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const s = tx.objectStore(store);
  for (const v of values) s.put(v);
  await done(tx);
  notifyChange();
  void requestPersistence();
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await done(tx);
  notifyChange();
}

export async function delMany(store: StoreName, keys: readonly IDBValidKey[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const s = tx.objectStore(store);
  for (const k of keys) s.delete(k);
  await done(tx);
  notifyChange();
}

// ---- export / restore -----------------------------------------------------

/** meta rows that belong to this device only (never exported, kept across a restore) */
const LOCAL_ONLY_META = ["ai"];

export interface Backup {
  app: "janos-health";
  schemaVersion: number;
  exportedAt: string;
  data: Partial<Record<StoreName, unknown[]>>;
}

export async function exportAll(): Promise<Backup> {
  const db = await openDb();
  const tx = db.transaction(STORES);
  const data: Partial<Record<StoreName, unknown[]>> = {};
  for (const s of STORES) data[s] = (await wrap(tx.objectStore(s).getAll())) as unknown[];
  // Device secrets stay on the device: the AI key is never written into a backup file.
  data.meta = (data.meta ?? []).filter((r) => !LOCAL_ONLY_META.includes((r as { key?: string }).key ?? ""));
  return { app: "janos-health", schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

/** Replaces all data with a backup. */
export async function restoreAll(backup: Backup): Promise<void> {
  if (backup.app !== "janos-health" || typeof backup.schemaVersion !== "number") throw new Error("This file is not a Janos Health backup.");
  if (backup.schemaVersion > SCHEMA_VERSION) throw new Error("This backup comes from a newer version of the app. Update the app first.");
  const db = await openDb();
  const keep = (await Promise.all(LOCAL_ONLY_META.map((k) => get<{ key: string }>("meta", k)))).filter(Boolean);
  const tx = db.transaction(STORES, "readwrite");
  for (const s of STORES) {
    const store = tx.objectStore(s);
    store.clear();
    for (const v of backup.data[s] ?? []) if (!(s === "meta" && LOCAL_ONLY_META.includes((v as { key?: string }).key ?? ""))) store.put(v);
  }
  for (const v of keep) tx.objectStore("meta").put(v);
  await done(tx);
  notifyChange();
}

// ---- persistence ----------------------------------------------------------

let persistAsked = false;

/** Asks the browser not to evict this app's data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (persistAsked || !navigator.storage?.persist) return false;
  persistAsked = true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function persistenceStatus(): Promise<"persistent" | "best-effort" | "unknown"> {
  try {
    if (!navigator.storage?.persisted) return "unknown";
    return (await navigator.storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "unknown";
  }
}

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
