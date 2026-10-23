import type { LinkId, ScenarioConfig } from './types';

/** mulberry32 — small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth Poisson sampler (fine for the small per-step means used here). */
export function samplePoisson(mean: number, rand: () => number): number {
  if (mean <= 0) return 0;
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

export function demandFactor(scenario: ScenarioConfig, t: number): number {
  const prof = scenario.demandProfile;
  let f = 1;
  if (prof.length) {
    if (t <= prof[0].t) f = prof[0].factor;
    else if (t >= prof[prof.length - 1].t) f = prof[prof.length - 1].factor;
    else {
      for (let i = 0; i < prof.length - 1; i++) {
        const a = prof[i];
        const b = prof[i + 1];
        if (t >= a.t && t <= b.t) {
          f = a.factor + ((b.factor - a.factor) * (t - a.t)) / Math.max(1e-9, b.t - a.t);
          break;
        }
      }
    }
  }
  for (const inc of scenario.incidents) {
    if (inc.type === 'demand_surge' && t >= inc.startS && t < inc.startS + inc.durationS) {
      f *= 1 + inc.demandIncrease;
    }
  }
  return f;
}

export type DemandTrace = Record<LinkId, Int16Array>;

/**
 * Pre-generates the complete arrival trace for a scenario. Every controller is
 * fed this exact array, so all comparisons use identical demand.
 */
export function generateDemand(scenario: ScenarioConfig, dt: number, entryLinks: LinkId[]): DemandTrace {
  const steps = Math.round(scenario.durationS / dt);
  const out = {} as DemandTrace;
  entryLinks.forEach((link, idx) => {
    // independent stream per entry so adding a link never perturbs another
    const rand = mulberry32((scenario.seed * 2654435761 + idx * 97 + 13) >>> 0);
    const arr = new Int16Array(steps);
    for (let s = 0; s < steps; s++) {
      const t = s * dt;
      const base =
        link === 'in-A'
          ? scenario.demand.main
          : scenario.demand.side[link === 'sA' ? 'A' : link === 'sB' ? 'B' : 'C'];
      arr[s] = samplePoisson(base * demandFactor(scenario, t) * dt, rand);
    }
    out[link] = arr;
  });
  return out;
}

export function demandChecksum(trace: DemandTrace): string {
  let h = 2166136261;
  for (const k of Object.keys(trace).sort()) {
    const arr = trace[k as LinkId];
    for (let i = 0; i < arr.length; i++) {
      h ^= arr[i] + i * 31;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
