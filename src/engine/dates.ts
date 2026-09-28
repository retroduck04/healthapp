// Calendar dates ("YYYY-MM-DD") and the rules for which day an instant belongs to.
// Date arithmetic uses day numbers (days since 1970-01-01), so it is immune to DST changes.

import { pad2 } from "./units";

export type ISODate = string; // "YYYY-MM-DD"

export function parseISODate(d: ISODate): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

export function makeISODate(y: number, m: number, day: number): ISODate {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(day)}`;
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function dayNumber(d: ISODate): number {
  const { y: year, m, day } = parseISODate(d);
  const y = m <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Date for a day number (Howard Hinnant's civil_from_days). */
export function fromDayNumber(n: number): ISODate {
  const z = n + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return makeISODate(y, m, d);
}

export const addDays = (d: ISODate, days: number): ISODate => fromDayNumber(dayNumber(d) + days);

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(d: ISODate): number {
  const n = dayNumber(d);
  return ((((n % 7) + 7) % 7) + 3) % 7 + 1;
}

export interface LocalTime {
  date: ISODate;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local date and time of an instant (ms since epoch) in an IANA time zone. */
export function localTime(instantMs: number, timeZone: string): LocalTime {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(instantMs))) parts[p.type] = p.value;
  return {
    date: makeISODate(Number(parts.year), Number(parts.month), Number(parts.day)),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** The nutrition day of an instant: its local date, except times before `boundaryHour` count to the previous day. */
export function nutritionDay(instantMs: number, timeZone: string, boundaryHour = 4): ISODate {
  const t = localTime(instantMs, timeZone);
  return t.hour < boundaryHour ? addDays(t.date, -1) : t.date;
}

/** Main sleep belongs to the local date you wake up on. */
export function sleepDate(wakeMs: number, timeZone: string): ISODate {
  return localTime(wakeMs, timeZone).date;
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
}
