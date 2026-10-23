import type { SimulationRun } from '../engine/types';

/** Never show a sample from the future during playback. */
export function seriesAt(run: SimulationRun, time: number) {
  let lo = 0;
  let hi = run.series.length - 1;
  if (hi < 0 || run.series[0].t > time) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (run.series[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  return run.series[lo];
}
