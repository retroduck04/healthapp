// Recovery contributors, each compared with your own baseline. No hidden weighted score.

import type { CheckIn, GarminDay } from "../db/types";
import { addDays, type ISODate } from "../engine/dates";
import type { HrvStatus } from "../engine/hrv";
import { median, robustSD } from "../engine/stats";

export type Level = "good" | "normal" | "watch" | "unknown";

export interface Contributor {
  label: string;
  value: string;
  level: Level;
  note: string;
}

export interface Recovery {
  summary: "Good" | "Normal" | "Reduced" | "Not enough data";
  contributors: Contributor[];
}

export function assessRecovery(
  day: ISODate,
  garmin: readonly GarminDay[],
  checkins: readonly CheckIn[],
  needHours: number,
  debtHours: number | null,
  hrvTrend?: HrvStatus,
): Recovery {
  const byDate = new Map(garmin.map((g) => [g.date, g]));
  const g = byDate.get(day);
  const c = checkins.find((x) => x.day === day);
  const out: Contributor[] = [];

  // HRV against Garmin's own personal baseline range.
  const hrv = g?.hrv.lastNight ?? c?.hrv ?? null;
  if (hrvTrend && hrvTrend.status !== "insufficient" && hrvTrend.avg7 !== null && hrvTrend.low !== null && hrvTrend.high !== null) {
    // Preferred: 7-day ln-rMSSD average against your own 60-day normal band (one bad night doesn't flip it).
    const level: Level = hrvTrend.status === "low" ? "watch" : hrvTrend.status === "high" ? "good" : "normal";
    out.push({
      label: "HRV 7-day",
      value: `${Math.round(hrvTrend.avg7)} ms`,
      level,
      note: `Normal ${Math.round(hrvTrend.low)}–${Math.round(hrvTrend.high)} ms${hrv !== null ? ` · last night ${Math.round(hrv)}` : ""}.`,
    });
  } else if (hrv !== null) {
    const lo = g?.hrv.baselineLow ?? null;
    const hi = g?.hrv.baselineHigh ?? null;
    let level: Level = "unknown";
    let note = "No baseline yet.";
    if (lo !== null && hi !== null) {
      level = hrv < lo ? "watch" : hrv > hi ? "good" : "normal";
      note = `Your usual range is ${lo}–${hi} ms.`;
    }
    out.push({ label: "HRV", value: `${Math.round(hrv)} ms`, level, note });
  }

  // Resting HR against the previous 28 days.
  const rhr = g?.restingHR ?? c?.restingHR ?? null;
  if (rhr !== null) {
    const prior: number[] = [];
    for (let i = 1; i <= 28; i++) {
      const d = addDays(day, -i);
      const v = byDate.get(d)?.restingHR ?? checkins.find((x) => x.day === d)?.restingHR ?? null;
      if (v !== null && v !== undefined) prior.push(v);
    }
    let level: Level = "unknown";
    let note = `Baseline needs 14 days (have ${prior.length}).`;
    if (prior.length >= 14) {
      const m = median(prior)!;
      const band = Math.max(3, robustSD(prior) ?? 0);
      level = rhr > m + band ? "watch" : rhr < m - band ? "good" : "normal";
      note = `Your usual is about ${Math.round(m)} bpm.`;
    }
    out.push({ label: "Resting HR", value: `${Math.round(rhr)} bpm`, level, note });
  }

  // Last night's sleep against your need.
  const sleepH = g?.sleep.totalSec ? g.sleep.totalSec / 3600 : c?.sleepHours ?? null;
  if (sleepH !== null && sleepH !== undefined) {
    const short = needHours - sleepH;
    out.push({
      label: "Sleep",
      value: `${Math.floor(sleepH)} h ${String(Math.round((sleepH % 1) * 60)).padStart(2, "0")}`,
      level: short > 1 ? "watch" : short < 0 ? "good" : "normal",
      note: short > 0 ? `${Math.round(short * 60)} min under your need.` : "At or above your need.",
    });
  }

  if (debtHours !== null) {
    out.push({
      label: "Sleep debt",
      value: `${debtHours.toFixed(1)} h`,
      level: debtHours > 4 ? "watch" : debtHours < 1 ? "good" : "normal",
      note: "Weighted over 14 nights.",
    });
  }

  if (g?.bodyBatteryWake != null) {
    out.push({
      label: "Body Battery",
      value: String(g.bodyBatteryWake),
      level: "unknown",
      note: "Garmin's own score; shown for reference, not used in the summary.",
    });
  }

  if (c?.ill) out.push({ label: "Illness", value: "Yes", level: "watch", note: "You marked yourself as feeling ill." });

  const scored = out.filter((x) => x.level !== "unknown");
  const watch = scored.filter((x) => x.level === "watch").length;
  let summary: Recovery["summary"];
  if (scored.length < 2) summary = "Not enough data";
  else if (c?.ill || watch >= 2) summary = "Reduced";
  else if (watch === 0 && scored.every((x) => x.level === "good" || x.level === "normal") && scored.some((x) => x.level === "good")) summary = "Good";
  else summary = "Normal";
  return { summary, contributors: out };
}
