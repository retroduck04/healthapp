// CSV export (as a small uncompressed .zip) and JSON backup files.

import { exportAll } from "./db";
import type { CardioSession, CheckIn, FoodEntry, StrengthSet, WeightEntry, Workout, Exercise } from "./types";

function csv(rows: readonly (readonly unknown[])[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const iso = (t: number) => new Date(t).toISOString();

// ---- minimal ZIP writer (stored, no compression) ---------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); // stored
    v.setUint32(14, crc, true);
    v.setUint32(18, f.data.length, true);
    v.setUint32(22, f.data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, f.data);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    offset += local.length + f.data.length;
  }
  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function buildCsvZip(): Promise<Uint8Array<ArrayBuffer>> {
  const b = await exportAll();
  const d = b.data;
  const enc = new TextEncoder();
  const exercises = new Map((d.exercises as Exercise[] | undefined ?? []).map((e) => [e.id, e.name]));
  const files = [
    {
      name: "weights.csv",
      rows: [["time_utc", "kg", "lb", "source"], ...((d.weights as WeightEntry[]) ?? []).map((w) => [iso(w.t), w.kg.toFixed(2), (w.kg / 0.45359237).toFixed(1), w.source])],
    },
    {
      name: "food.csv",
      rows: [
        ["day", "time_utc", "meal", "name", "amount", "grams", "kcal", "protein_g", "carbs_g", "fat_g", "method"],
        ...((d.entries as FoodEntry[]) ?? []).map((e) => [e.day, iso(e.t), e.meal, e.name, e.amountLabel ?? "", e.grams ?? "", e.kcal.toFixed(0), e.protein.toFixed(1), e.carbs.toFixed(1), e.fat.toFixed(1), e.method]),
      ],
    },
    {
      name: "strength_sets.csv",
      rows: [
        ["workout_start_utc", "workout", "exercise", "set", "kind", "load", "reps", "rir"],
        ...((d.sets as StrengthSet[]) ?? []).map((s) => {
          const w = ((d.workouts as Workout[]) ?? []).find((x) => x.id === s.workoutId);
          return [w ? iso(w.start) : "", w?.name ?? "", exercises.get(s.exerciseId) ?? s.exerciseId, s.index, s.kind, s.load, s.reps, s.rir ?? ""];
        }),
      ],
    },
    {
      name: "cardio.csv",
      rows: [
        ["start_utc", "minutes", "modality", "type", "distance_km", "avg_hr", "max_hr", "rpe"],
        ...((d.cardio as CardioSession[]) ?? []).map((c) => [iso(c.start), c.minutes, c.modality, c.sessionType, c.distanceKm ?? "", c.avgHR ?? "", c.maxHR ?? "", c.rpe ?? ""]),
      ],
    },
    {
      name: "checkins.csv",
      rows: [
        ["day", "sleep_hours", "bedtime", "wake_time", "nap_min", "energy", "soreness", "stress", "ill", "hrv_ms", "resting_hr", "body_battery", "sleep_score"],
        ...((d.checkins as CheckIn[]) ?? []).map((c) => [c.day, c.sleepHours ?? "", c.bedtime ?? "", c.wakeTime ?? "", c.napMinutes ?? "", c.energy ?? "", c.soreness ?? "", c.stress ?? "", c.ill ? 1 : 0, c.hrv ?? "", c.restingHR ?? "", c.bodyBattery ?? "", c.sleepScore ?? ""]),
      ],
    },
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(csv(f.rows)) })));
}

export async function buildBackupJson(): Promise<string> {
  return JSON.stringify(await exportAll());
}

/** Shares a file through the iOS share sheet (Save to Files), or downloads it elsewhere. */
export async function shareOrDownload(name: string, data: BlobPart, type: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([data], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
