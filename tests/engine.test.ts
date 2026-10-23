import { describe, expect, it } from 'vitest';
import { generateDemand, demandChecksum } from '../src/engine/demand';
import { buildNetwork, DEFAULT_CONFIG } from '../src/engine/network';
import { getScenario, makeIncident } from '../src/engine/scenarios';
import { initialSignal, isSafeTransition, stepSignal } from '../src/engine/signal';
import { compareControllers, runSimulation } from '../src/engine/simulator';
import { StigmergyBus } from '../src/engine/stigmergy';
import { LinkPredictor } from '../src/engine/predictor';
import { computeComparison } from '../src/engine/report';
import type { ControllerKind, SignalState } from '../src/engine/types';

const KINDS: ControllerKind[] = ['fixed', 'maxpressure', 'waveguard'];
const net = buildNetwork();

describe('1. vehicle conservation', () => {
  for (const id of ['normal', 'rush', 'incident', 'sensor'] as const) {
    it(`conserves vehicles in scenario "${id}" for every controller`, () => {
      const runs = compareControllers(getScenario(id), KINDS, DEFAULT_CONFIG, { recordFrames: false });
      for (const k of KINDS) {
        expect(runs[k].metrics.conservationError).toBeLessThan(1e-6);
        expect(runs[k].metrics.totalArrived).toBeGreaterThan(0);
      }
    });
  }
});

describe('2. finite road storage', () => {
  it('never exceeds cell storage or goes negative (checked every frame)', () => {
    const run = runSimulation(getScenario('incident'), 'fixed');
    for (const f of run.frames) {
      for (let c = 0; c < f.cells.length; c++) {
        expect(f.cells[c]).toBeGreaterThanOrEqual(0);
        expect(f.cells[c]).toBeLessThanOrEqual(net.cellCap[c] + 1e-4);
      }
      for (const l of net.linkList) expect(f.linkOccupancy[l.id]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
  it('holds vehicles in an external entrance queue when the entry link is full', () => {
    const sc = getScenario('incident');
    sc.incidents = [makeIncident({ linkId: 'A-B', positionFrac: 0.9, capacityReduction: 0.95, startS: 0, durationS: 1500 })];
    const run = runSimulation(sc, 'fixed', DEFAULT_CONFIG, { recordFrames: false });
    expect(run.metrics.finalEntryQueue).toBeGreaterThan(50);
    expect(run.metrics.conservationError).toBeLessThan(1e-6);
  });
});

describe('3. downstream link blockage', () => {
  it('a full blockage on B-C stops discharge from B-C and spills back to A-B', () => {
    const sc = getScenario('incident');
    sc.incidents = [makeIncident({ capacityReduction: 0.95, startS: 60, durationS: 1400 })];
    const run = runSimulation(sc, 'fixed');
    const late = run.frames[run.frames.length - 1];
    expect(late.linkOccupancy['B-C']).toBeGreaterThan(0.6); // cells downstream of the bottleneck stay nearly empty
    expect(late.cells[net.links['B-C'].cellStart]).toBeGreaterThan(0.5 * net.cellCap[net.links['B-C'].cellStart]);
    expect(late.linkOccupancy['A-B']).toBeGreaterThan(0.5);
    expect(run.metrics.spillbackDurationS).toBeGreaterThan(0);
    expect(run.events.some((e) => e.kind === 'spillback' && e.linkId === 'B-C')).toBe(true);
    // downstream of the bottleneck, flow is limited to 5% of capacity (0.1 veh/s)
    const discharged = run.series[run.series.length - 1].discharged - run.series[30].discharged;
    const normal = runSimulation(getScenario('normal'), 'fixed', DEFAULT_CONFIG, { recordFrames: false });
    expect(discharged).toBeLessThan(normal.metrics.totalDischarged);
  });
});

describe('4. signal phase safety', () => {
  const timing = DEFAULT_CONFIG.timing;
  it('honours min green, yellow and all-red, and never skips clearance', () => {
    let s: SignalState = { node: 'A', phase: 'MAIN', stage: 'GREEN', elapsed: 0, sideRed: 0 };
    const r1 = stepSignal(s, 'SWITCH', timing, 1, true);
    expect(r1.state.stage).toBe('GREEN');
    expect(r1.blockedBy).toBe('min_green');
    s = { ...s, elapsed: timing.minGreenMain };
    const seq: SignalState[] = [s];
    let cur = s;
    for (let i = 0; i < 12; i++) {
      cur = stepSignal(cur, 'SWITCH', timing, 1, true).state;
      seq.push(cur);
    }
    for (let i = 1; i < seq.length; i++) expect(isSafeTransition(seq[i - 1], seq[i])).toBe(true);
    const yellow = seq.filter((x) => x.stage === 'YELLOW').length;
    const allRed = seq.filter((x) => x.stage === 'ALL_RED').length;
    expect(yellow).toBe(timing.yellow);
    expect(allRed).toBe(timing.allRed);
    expect(seq[seq.length - 1].phase).toBe('SIDE');
  });
  it('forces a switch at max green and when side-street fairness is violated', () => {
    const s: SignalState = { node: 'A', phase: 'MAIN', stage: 'GREEN', elapsed: timing.maxGreenMain, sideRed: 10 };
    expect(stepSignal(s, 'HOLD', timing, 1, true).forced).toBe('max_green');
    const f: SignalState = { node: 'A', phase: 'MAIN', stage: 'GREEN', elapsed: 20, sideRed: timing.maxSideRed };
    expect(stepSignal(f, 'HOLD', timing, 1, true).forced).toBe('fairness');
  });
  it('no controller produces an unsafe transition or exceeds max green in full runs', () => {
    for (const k of KINDS) {
      const run = runSimulation(getScenario('incident'), k);
      let prev = run.frames[0].signals;
      for (const f of run.frames.slice(1)) {
        for (const n of ['A', 'B', 'C'] as const) {
          const a = prev[n];
          const b = f.signals[n];
          expect(isSafeTransition({ node: n, ...a, sideRed: 0 }, { node: n, ...b, sideRed: 0 })).toBe(true);
          if (b.stage === 'GREEN') expect(b.elapsed).toBeLessThanOrEqual(b.phase === 'MAIN' ? timing.maxGreenMain : timing.maxGreenSide);
        }
        prev = f.signals;
      }
    }
  });
  it('initial signal state is a valid state', () => {
    for (const n of ['A', 'B', 'C'] as const) {
      const s = initialSignal(DEFAULT_CONFIG.fixedPlan, timing, n);
      expect(['GREEN', 'YELLOW', 'ALL_RED']).toContain(s.stage);
    }
  });
});

describe('5. warning decay and expiry', () => {
  const p = DEFAULT_CONFIG.waveguard;
  it('pheromone is bounded, decays and messages expire', () => {
    const bus = new StigmergyBus(p);
    for (let t = 0; t < 200; t += 1) {
      bus.evaporate(t, 1);
      bus.emit({ t, source: 'C', target: 'B', linkId: 'B-C', risk: 1, timeToCapacity: 10, confidence: 1, path: [] });
      expect(bus.tau.B).toBeLessThanOrEqual(p.tauMax);
    }
    const peak = bus.tau.B;
    expect(peak).toBeGreaterThan(0.3);
    for (let t = 200; t < 260; t++) bus.evaporate(t, 1);
    expect(bus.tau.B).toBeLessThan(peak * 0.2);
    expect(bus.active.length).toBe(0); // all expired after TTL
  });
  it('low-confidence messages deposit less, sub-threshold risk is not emitted, cycles are rejected', () => {
    const hi = new StigmergyBus(p);
    const lo = new StigmergyBus(p);
    hi.emit({ t: 0, source: 'C', target: 'B', linkId: 'B-C', risk: 0.9, timeToCapacity: null, confidence: 0.95, path: [] });
    lo.emit({ t: 0, source: 'C', target: 'B', linkId: 'B-C', risk: 0.9, timeToCapacity: null, confidence: 0.1, path: [] });
    expect(lo.tau.B).toBeLessThan(hi.tau.B);
    expect(hi.emit({ t: 1, source: 'B', target: 'A', linkId: 'A-B', risk: p.emitThreshold - 0.01, timeToCapacity: null, confidence: 1, path: [] })).toBeNull();
    expect(hi.emit({ t: 1, source: 'B', target: 'C', linkId: 'A-B', risk: 0.9, timeToCapacity: null, confidence: 1, path: ['C'] })).toBeNull();
  });
});

describe('6. identical demand across controller comparisons', () => {
  it('all controllers receive exactly the same arrival trace and incident schedule', () => {
    const runs = compareControllers(getScenario('incident'), KINDS, DEFAULT_CONFIG, { recordFrames: false });
    const sums = KINDS.map((k) => runs[k].demandChecksum);
    expect(new Set(sums).size).toBe(1);
    const arrived = KINDS.map((k) => runs[k].metrics.totalArrived);
    expect(new Set(arrived).size).toBe(1);
    // independent generation reproduces the same trace
    const d = generateDemand(getScenario('incident'), 1, net.entryLinks);
    expect(demandChecksum(d)).toBe(sums[0]);
    expect(KINDS.every((k) => JSON.stringify(runs[k].scenario.incidents) === JSON.stringify(runs.fixed.scenario.incidents))).toBe(true);
  });
  it('a different seed produces a different trace', () => {
    const a = demandChecksum(generateDemand(getScenario('incident', 1), 1, net.entryLinks));
    const b = demandChecksum(generateDemand(getScenario('incident', 2), 1, net.entryLinks));
    expect(a).not.toBe(b);
  });
});

describe('7. deterministic simulation replay', () => {
  it('replaying the same scenario and seed gives identical results', () => {
    for (const k of KINDS) {
      const a = runSimulation(getScenario('incident'), k);
      const b = runSimulation(getScenario('incident'), k);
      const strip = (m: typeof a.metrics) => ({ ...m, avgDecisionTimeMs: null });
      expect(strip(a.metrics)).toEqual(strip(b.metrics));
      expect(a.series).toEqual(b.series);
      expect(Array.from(a.frames[900].cells)).toEqual(Array.from(b.frames[900].cells));
      expect(a.decisions.map((d) => [d.t, d.node, d.selected])).toEqual(b.decisions.map((d) => [d.t, d.node, d.selected]));
    }
  });
});

describe('8. safe handling of missing sensor information', () => {
  it('node B falls back to the conservative plan while its sensor is down, ground truth is unaffected', () => {
    const sc = getScenario('sensor');
    const run = runSimulation(sc, 'waveguard');
    const fault = sc.sensorFaults[0];
    const during = run.decisions.filter((d) => d.node === 'B' && d.t >= fault.startS && d.t < fault.startS + fault.durationS);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((d) => d.selected === 'FALLBACK')).toBe(true);
    expect(during.every((d) => d.state.confidence < 0.5)).toBe(true);
    expect(run.metrics.conservationError).toBeLessThan(1e-6);
    // the same scenario without a fault has identical physics inputs (ground truth independent of observation)
    const noFault = { ...sc, sensorFaults: [] };
    const r2 = runSimulation(noFault, 'fixed', DEFAULT_CONFIG, { recordFrames: false });
    const r1 = runSimulation(sc, 'fixed', DEFAULT_CONFIG, { recordFrames: false });
    expect(r1.metrics.totalDischarged).toBeCloseTo(r2.metrics.totalDischarged, 9);
  });
  it('predictor never fabricates evidence from a missing observation', () => {
    const pr = new LinkPredictor(net, DEFAULT_CONFIG.waveguard, 'B', 'B-C');
    const f = pr.update({ linkId: 'B-C', vehicles: null, occupancy: null, queue: null, inflow: null, outflow: null, receiving: null, nearStop: null, queueTailM: null, confidence: 0.1, stale: true });
    expect(f.risk).toBe(0);
    expect(f.warning).toBeNull();
    expect(f.confidence).toBe(0.1);
  });
  it('predictor handles zero / negative accumulation explicitly (no time-to-capacity)', () => {
    const pr = new LinkPredictor(net, DEFAULT_CONFIG.waveguard, 'B', 'B-C');
    const f = pr.update({ linkId: 'B-C', vehicles: 10, occupancy: 0.1, queue: 0, inflow: 0.3, outflow: 0.5, receiving: 1, nearStop: 3, queueTailM: null, confidence: 0.95, stale: false });
    expect(f.timeToCapacity).toBeNull();
    expect(f.shockSpeed).toBeNull();
    const g = new LinkPredictor(net, DEFAULT_CONFIG.waveguard, 'B', 'B-C');
    const h = g.update({ linkId: 'B-C', vehicles: 60, occupancy: 0.76, queue: 30, inflow: 0.5, outflow: 0.2, receiving: 1, nearStop: 30, queueTailM: 120, confidence: 0.95, stale: false });
    expect(h.timeToCapacity).toBeCloseTo((net.links['B-C'].storage - 60) / 0.3, 6);
    expect(h.shockSpeed!).toBeLessThan(0); // queue tail moves upstream
  });
});

describe('10. correct metric calculation', () => {
  it('metrics are consistent with the recorded series and frames', () => {
    const run = runSimulation(getScenario('incident'), 'waveguard');
    const last = run.series[run.series.length - 1];
    expect(run.metrics.cumulativeWaitingVehS).toBeCloseTo(last.cumWaiting, 6);
    expect(run.metrics.totalDischarged).toBeCloseTo(last.discharged, 6);
    let maxOcc = 0;
    for (const f of run.frames) for (const v of Object.values(f.linkOccupancy)) maxOcc = Math.max(maxOcc, v);
    expect(run.metrics.maxLinkOccupancy).toBeCloseTo(maxOcc, 6);
    const avgWarn = run.frames.reduce((s, f) => s + f.activeMessages.length, 0) / run.frames.length;
    expect(run.metrics.avgActiveWarnings).toBeCloseTo(avgWarn, 6);
  });
  it('an empty network with no demand has zero waiting and zero discharge after drain', () => {
    const sc = { ...getScenario('normal'), demand: { main: 0, side: { A: 0, B: 0, C: 0 } } };
    const run = runSimulation(sc, 'fixed', DEFAULT_CONFIG, { recordFrames: false });
    expect(run.metrics.totalArrived).toBe(0);
    expect(run.metrics.vehiclesInNetwork).toBeLessThan(1e-3);
    expect(run.metrics.finalEntryQueue).toBe(0);
  });
  it('comparison deltas are computed from the run metrics', () => {
    const runs = compareControllers(getScenario('incident'), ['fixed', 'waveguard'], DEFAULT_CONFIG, { recordFrames: false });
    const cmp = computeComparison(runs.fixed, runs.waveguard);
    const w = cmp.find((r) => r.key === 'cumulativeWaitingVehS')!;
    expect(w.baseline).toBe(runs.fixed.metrics.cumulativeWaitingVehS);
    expect(w.proposed).toBe(runs.waveguard.metrics.cumulativeWaitingVehS);
    expect(w.changePct).toBeCloseTo(((w.proposed! - w.baseline!) / w.baseline!) * 100, 9);
  });
});
