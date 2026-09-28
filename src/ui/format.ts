import { KG_PER_LB, fmt, kmToMiles, milesToKm } from "../engine/units";
import { parseISODate, type ISODate } from "../engine/dates";
import type { Settings } from "../db/types";

export const weightToDisplay = (kg: number, s: Settings): number => (s.weightUnit === "lb" ? kg / KG_PER_LB : kg);
export const weightFromDisplay = (v: number, s: Settings): number => (s.weightUnit === "lb" ? v * KG_PER_LB : v);
export const weightText = (kg: number, s: Settings, decimals = 1): string => `${fmt(weightToDisplay(kg, s), decimals)} ${s.weightUnit}`;

export const distToDisplay = (km: number, s: Settings): number => (s.distanceUnit === "mi" ? kmToMiles(km) : km);
export const distFromDisplay = (v: number, s: Settings): number => (s.distanceUnit === "mi" ? milesToKm(v) : v);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dayLabel(d: ISODate, todayISO?: ISODate, yesterdayISO?: ISODate): string {
  if (todayISO && d === todayISO) return "Today";
  if (yesterdayISO && d === yesterdayISO) return "Yesterday";
  const { m, day } = parseISODate(d);
  return `${MONTHS[m - 1]} ${day}`;
}

export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function shortDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function weekdayShort(isoWeekday: number): string {
  return DAYS[isoWeekday - 1];
}

export function hoursText(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

export function clockToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Sleep duration in hours from bedtime and wake time, crossing midnight when needed. */
export function durationFromClock(bed: string, wake: string): number | null {
  const b = clockToMinutes(bed);
  const w = clockToMinutes(wake);
  if (b === null || w === null) return null;
  let d = w - b;
  if (d <= 0) d += 24 * 60;
  return d / 60;
}

export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
