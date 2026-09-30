// Simulated vitals for the body map: a beat schedule from resting heart rate and HRV, and an ECG shape.
// Pure functions (no DOM). The trace is a stylised PQRST complex, not a medical ECG.

/** Beat schedule: a repeating pattern of 16 R-R intervals around 60000/hr, spread by HRV (seeded, stable per day). */
export interface BeatPlan {
  cum: number[]; // beat times within one cycle, with one beat of padding each side
  cycle: number;
}
export function beatPlan(hr: number, hrv: number | null, seedStr: string): BeatPlan {
  let seed = 2166136261;
  for (const ch of seedStr) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = 60000 / Math.max(30, Math.min(200, hr));
  const sd = Math.max(5, Math.min(120, hrv ?? 25)) / Math.SQRT2;
  const rr: number[] = [];
  for (let i = 0; i < 16; i++) {
    const g = Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()); // normal(0,1)
    rr.push(Math.max(base * 0.7, Math.min(base * 1.3, base + g * sd)));
  }
  const cycle = rr.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (const r of rr) cum.push(cum[cum.length - 1] + r);
  return { cum: [cum[15] - cycle, ...cum, cycle + rr[0]], cycle };
}

/** ms since the most recent R peak, and the index of the beat window, at time t */
export function beatWindow(plan: BeatPlan, t: number): { i: number; off: number } {
  const off = ((t % plan.cycle) + plan.cycle) % plan.cycle;
  let i = 1;
  while (i < plan.cum.length - 2 && plan.cum[i + 1] <= off) i++;
  return { i, off };
}

const gauss = (x: number, w: number) => Math.exp(-0.5 * (x / w) * (x / w));
/** one PQRST complex, τ = ms from the R peak */
export const wave = (tau: number) =>
  0.12 * gauss(tau + 170, 24) - 0.1 * gauss(tau + 28, 9) + gauss(tau, 11) - 0.24 * gauss(tau - 30, 11) + 0.3 * gauss(tau - 270, 48);

export function ecgAt(plan: BeatPlan, t: number): number {
  const { i, off } = beatWindow(plan, t);
  return wave(off - plan.cum[i - 1]) + wave(off - plan.cum[i]) + wave(off - plan.cum[i + 1]);
}

