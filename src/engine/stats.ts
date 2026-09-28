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
