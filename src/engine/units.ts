// Unit conversions and display formatting.
// The app stores SI units (kg, km, seconds, kcal); these helpers convert only for display and entry.

export const KG_PER_LB = 0.45359237;
export const M_PER_MILE = 1609.344;

export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const mphToKmh = (mph: number): number => (mph * M_PER_MILE) / 1000;
export const kmhToMph = (kmh: number): number => (kmh * 1000) / M_PER_MILE;
export const kmToMiles = (km: number): number => (km * 1000) / M_PER_MILE;
export const milesToKm = (mi: number): number => (mi * M_PER_MILE) / 1000;

/** Pace in seconds per km for a speed in km/h; null for zero or negative speed. */
export function paceSecondsPerKm(kmh: number): number | null {
  return kmh > 0 ? 3600 / kmh : null;
}

export const pad2 = (n: number): string => (n >= 0 && n < 10 ? `0${n}` : `${n}`);

/** "7 h 05 min", or "45 min" under an hour. */
export function formatHoursMinutes(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const totalMinutes = Math.round(Math.abs(seconds) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${sign}${m} min` : `${sign}${h} h ${pad2(m)} min`;
}

/** "6:25" from seconds (pace per km). */
export function formatMinSec(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** Rounds to a fixed number of decimals and drops trailing zeros ("182.5", "180"). */
export function fmt(value: number, decimals = 1): string {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Number.isInteger(r) ? String(r) : r.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}
