// Small, dependency-free statistics helpers.

/** Linear-interpolation quantile ("type 7"). Null for empty input. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const h = (s.length - 1) * Math.min(Math.max(q, 0), 1);
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export const median = (values: readonly number[]): number | null => quantile(values, 0.5);

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Median absolute deviation scaled to estimate a standard deviation for normal data. */
export function robustSD(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  const mad = median(values.map((v) => Math.abs(v - m)));
  return mad === null ? null : 1.4826 * mad;
}

export interface GapSummary {
  sampleCount: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  maxSeconds: number | null;
}

/** Spacing between consecutive timestamps (ms), in seconds. */
export function gapSummary(timesMs: readonly number[]): GapSummary {
  const s = [...timesMs].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < s.length; i++) gaps.push((s[i] - s[i - 1]) / 1000);
  return {
    sampleCount: s.length,
    medianSeconds: median(gaps),
    p90Seconds: quantile(gaps, 0.9),
    maxSeconds: gaps.length ? Math.max(...gaps) : null,
  };
}

export interface HeartRateSample {
  t: number; // ms
  bpm: number;
}

/** Lowest mean HR over any window of `windowSeconds` holding at least `minSamples` samples. */
export function lowestRollingMean(samples: readonly HeartRateSample[], windowSeconds = 300, minSamples = 2): number | null {
  const s = [...samples].sort((a, b) => a.t - b.t);
  let best: number | null = null;
  let end = 0;
  let sum = 0;
  for (let start = 0; start < s.length; start++) {
    if (end < start) {
      end = start;
      sum = 0;
    }
    while (end < s.length && (s[end].t - s[start].t) / 1000 < windowSeconds) {
      sum += s[end].bpm;
      end++;
    }
    const count = end - start;
    if (count >= minSamples) {
      const m = sum / count;
      if (best === null || m < best) best = m;
    }
    if (end > start) sum -= s[start].bpm;
  }
  return best;
}

/** Sample variance with Bessel's correction (n − 1). Null when fewer than 2 values. */
export function sampleVariance(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1);
}

/** Sample standard deviation (n − 1). Null when fewer than 2 values. */
export function sampleSD(values: readonly number[]): number | null {
  const v = sampleVariance(values);
  return v === null ? null : Math.sqrt(v);
}

// Student-t 0.975 quantiles (two-sided 95%) at anchor degrees of freedom, from scipy.stats.t.ppf.
const T975: readonly (readonly [number, number])[] = [
  [1, 12.7062], [1.1, 10.2768], [1.2, 8.64883], [1.35, 7.04822], [1.5, 6.01666], [1.75, 4.94885], [2, 4.30265],
  [2.5, 3.57465], [3, 3.18245], [4, 2.77645], [5, 2.57058], [6, 2.44691], [7, 2.36462], [8, 2.306], [9, 2.26216],
  [10, 2.22814], [11, 2.20099], [12, 2.17881], [13, 2.16037], [14, 2.14479], [15, 2.13145], [16, 2.11991],
  [17, 2.10982], [18, 2.10092], [19, 2.09302], [20, 2.08596], [21, 2.07961], [22, 2.07387], [23, 2.06866],
  [24, 2.0639], [25, 2.05954], [26, 2.05553], [27, 2.05183], [28, 2.04841], [29, 2.04523], [30, 2.04227],
  [35, 2.03011], [40, 2.02108], [50, 2.00856], [60, 2.0003], [80, 1.99006], [100, 1.98397], [120, 1.97993],
  [200, 1.9719],
];
const Z975 = 1.959963984540054;

/**
 * 0.975 quantile of Student's t for any real df ≥ 1 (df < 1 is treated as 1): table anchors with ln(t)
 * interpolated linearly in 1/df, then linear in 1/df toward z = 1.95996 beyond df 200. Max error < 0.2 %.
 */
export function tQuantile975(df: number): number {
  if (!(df > 1)) return T975[0][1];
  if (!Number.isFinite(df)) return Z975;
  for (let i = 1; i < T975.length; i++) {
    const [d1, t1] = T975[i];
    if (df <= d1) {
      const [d0, t0] = T975[i - 1];
      const f = (1 / d0 - 1 / df) / (1 / d0 - 1 / d1);
      return Math.exp(Math.log(t0) + f * (Math.log(t1) - Math.log(t0)));
    }
  }
  const [dLast, tLast] = T975[T975.length - 1];
  return Z975 + (tLast - Z975) * (dLast / df);
}
