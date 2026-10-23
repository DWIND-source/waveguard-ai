import { FixedTimeController } from './controllers/fixedTime';
import { MaxPressureController } from './controllers/maxPressure';
import type { Controller } from './controllers/types';
import { WaveGuardController } from './controllers/waveguard';
import { demandChecksum, generateDemand, type DemandTrace } from './demand';
import { buildNetwork, DEFAULT_CONFIG, type Network } from './network';
import { dischargeFactor, initialSignal, isSafeTransition, stepSignal } from './signal';
import {
  LINK_IDS,
  NODE_IDS,
  type ActionKind,
  type ControllerKind,
  type DecisionTrace,
  type EngineConfig,
  type Frame,
  type LinkId,
  type LinkObservation,
  type MetricsSummary,
  type NodeId,
  type NodeObservation,
  type RiskMessage,
  type ScenarioConfig,
  type SeriesPoint,
  type SignalState,
  type SimulationRun,
  type TimelineEvent,
} from './types';

/**
 * Discrete-time traffic engine (Cell Transmission Model, Daganzo 1994).
 *
 * Per cell i with n_i vehicles, max flow Q_i and storage N_i:
 *   sending   S_i = min(n_i, Q_i)
 *   receiving R_i = min(Q_i, δ·(N_i − n_i)),  δ = w / v_f
 *   flow      y_{i→i+1} = min(S_i, R_{i+1})
 *   update    n_i(t+1) = n_i(t) + inflow_i(t) − outflow_i(t)      (vehicle conservation)
 *
 * Intersections: only the GREEN (or YELLOW, at reduced rate) phase discharges.
 * Mainline discharge uses a FIFO diverge: total = min(S_last·g, R_down / r_through)
 * so a blocked downstream link also blocks turners queued behind through vehicles.
 * External entrance queues hold vehicles when a link cannot admit them.
 */

export interface RunOptions {
  recordFrames?: boolean;
  demand?: DemandTrace;
}

export const CONTROLLER_LABEL: Record<ControllerKind, string> = {
  fixed: 'Điều khiển thông thường (Fixed-Time)',
  maxpressure: 'Max-Pressure (đơn giản hoá)',
  waveguard: 'WaveGuard AI',
};

export function makeController(kind: ControllerKind, net: Network, config: EngineConfig): Controller {
  if (kind === 'fixed') return new FixedTimeController();
  if (kind === 'maxpressure') return new MaxPressureController();
  return new WaveGuardController(net, config);
}

function linkCells(net: Network, l: LinkId): [number, number] {
  const s = net.links[l];
  return [s.cellStart, s.cellStart + s.numCells];
}

export function runSimulation(
  scenario: ScenarioConfig,
  kind: ControllerKind,
  config: EngineConfig = DEFAULT_CONFIG,
  opts: RunOptions = {},
): SimulationRun {
  const recordFrames = opts.recordFrames ?? true;
  const net = buildNetwork(config.network);
  const p = net.params;
  const dt = p.dt;
  const steps = Math.round(scenario.durationS / dt);
  const demand = opts.demand ?? generateDemand(scenario, dt, net.entryLinks);
  const controller = makeController(kind, net, config);
  const r = 1 - p.turnOffFraction;

  // ---- state (identical initial conditions for every controller)
  const n = new Float64Array(net.numCells);
  for (const l of net.linkList) {
    const [a, b] = linkCells(net, l.id);
    for (let c = a; c < b; c++) n[c] = l.kind === 'main' ? 0.35 : 0.15;
  }
  const ext: Record<string, number> = { 'in-A': 0, sA: 0, sB: 0, sC: 0 };
  let signals = Object.fromEntries(NODE_IDS.map((id) => [id, initialSignal(config.fixedPlan, config.timing, id)])) as Record<NodeId, SignalState>;
  const lastOut = new Float64Array(net.numCells);
  const lastDelayed = new Float64Array(net.numCells);
  const linkInLast: Record<string, number> = {};
  const linkOutLast: Record<string, number> = {};
  for (const l of LINK_IDS) {
    linkInLast[l] = 0;
    linkOutLast[l] = 0;
  }
  let initialVehicles = 0;
  for (let c = 0; c < net.numCells; c++) initialVehicles += n[c];

  let arrived = 0;
  let exited = 0;
  let cumWaiting = 0;
  let sideWaiting = 0;
  let queueSum = 0;
  let spillback = 0;
  let warningsSum = 0;
  let warningsMax = 0;
  let decisionTimeSum = 0;
  let decisionCount = 0;
  let unsafeTransitions = 0;
  const maxOcc = Object.fromEntries(LINK_IDS.map((l) => [l, 0])) as Record<LinkId, number>;
  const frames: Frame[] = [];
  const series: SeriesPoint[] = [];
  const decisions: DecisionTrace[] = [];
  const messages: RiskMessage[] = [];
  const events: TimelineEvent[] = [];
  const seenEvent = new Set<string>();
  const addEvent = (key: string, e: TimelineEvent) => {
    if (seenEvent.has(key)) return;
    seenEvent.add(key);
    events.push(e);
  };
  const lastGoodObs: Partial<Record<NodeId, NodeObservation>> = {};

  const incidentCell = (inc: ScenarioConfig['incidents'][number]) => {
    const [a, b] = linkCells(net, inc.linkId);
    return Math.min(b - 1, a + Math.floor(inc.positionFrac * (b - a)));
  };

  const Qeff = new Float64Array(net.numCells);
  const S = new Float64Array(net.numCells);
  const R = new Float64Array(net.numCells);
  const inflow = new Float64Array(net.numCells);
  const outflow = new Float64Array(net.numCells);

  const computeQ = (t: number) => {
    Qeff.set(net.cellQ);
    let active = false;
    for (const inc of scenario.incidents) {
      if (inc.type === 'demand_surge') continue;
      if (t >= inc.startS && t < inc.startS + inc.durationS) {
        const c = incidentCell(inc);
        Qeff[c] = Math.min(Qeff[c], net.cellQ[c] * (1 - Math.max(0, Math.min(0.95, inc.capacityReduction))));
        active = true;
      }
    }
    return active;
  };

  const congested = (c: number) => n[c] > net.cellQ[c] * 1.3 || (n[c] > 0.5 && lastDelayed[c] > 0.5 * n[c]);

  const observeLink = (l: LinkId): Omit<LinkObservation, 'confidence' | 'stale'> => {
    const spec = net.links[l];
    const [a, b] = linkCells(net, l);
    let veh = 0;
    let q = 0;
    let near = 0;
    for (let c = a; c < b; c++) {
      veh += n[c];
      q += lastDelayed[c];
      if (c >= b - 10) near += n[c];
    }
    // queue tail: most downstream congested block, extended upstream (1-cell gaps allowed)
    let tail: number | null = null;
    let j = b - 1;
    while (j >= a && !congested(j)) j--;
    if (j >= a) {
      let k = j;
      while (k - 1 >= a && (congested(k - 1) || (k - 2 >= a && congested(k - 2)))) k--;
      tail = (k - a) * net.cellLength;
    }
    const first = a;
    const recv = Math.min(Qeff[first], net.delta * (net.cellCap[first] - n[first]));
    return {
      linkId: l,
      vehicles: veh,
      occupancy: veh / spec.storage,
      queue: q,
      inflow: linkInLast[l] / dt,
      outflow: linkOutLast[l] / dt,
      receiving: Math.max(0, recv) / dt,
      nearStop: near,
      queueTailM: tail,
    };
  };

  const buildObs = (t: number): Record<NodeId, NodeObservation> => {
    const out = {} as Record<NodeId, NodeObservation>;
    for (const node of NODE_IDS) {
      const fault = scenario.sensorFaults.find((f) => f.node === node && t >= f.startS && t < f.startS + f.durationS);
      const links: NodeObservation['links'] = {};
      const ids: LinkId[] = [net.mainIn[node], net.mainOut[node], net.sideIn[node]];
      if (!fault) {
        for (const l of ids) links[l] = { ...observeLink(l), confidence: 0.95, stale: false };
        out[node] = { node, t, confidence: 0.95, signal: { ...signals[node] }, links };
        lastGoodObs[node] = out[node];
      } else if (fault.mode === 'frozen' && lastGoodObs[node]) {
        const prev = lastGoodObs[node]!;
        for (const l of ids) links[l] = { ...(prev.links[l] as LinkObservation), confidence: 0.2, stale: true };
        out[node] = { node, t, confidence: 0.2, signal: { ...signals[node] }, links };
      } else {
        for (const l of ids)
          links[l] = { linkId: l, vehicles: null, occupancy: null, queue: null, inflow: null, outflow: null, receiving: null, nearStop: null, queueTailM: null, confidence: 0.1, stale: true };
        out[node] = { node, t, confidence: 0.1, signal: { ...signals[node] }, links };
      }
    }
    return out;
  };

  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    // 1. arrivals into external entrance queues
    for (const e of net.entryLinks) {
      const a = demand[e][s];
      ext[e] += a;
      arrived += a;
    }
    const incidentActive = computeQ(t);
    for (const inc of scenario.incidents) {
      if (t === inc.startS) addEvent(`inc-${inc.id}`, { t, kind: 'incident', linkId: inc.linkId, text: inc.type === 'demand_surge' ? `Lưu lượng tăng ${Math.round(inc.demandIncrease * 100)}%` : `Sự cố trên ${inc.linkId}: năng lực thông hành giảm ${Math.round(inc.capacityReduction * 100)}%` });
      if (t === inc.startS + inc.durationS) addEvent(`inc-end-${inc.id}`, { t, kind: 'incident_end', linkId: inc.linkId, text: `Sự cố trên ${inc.linkId} được giải phóng` });
    }
    for (const f of scenario.sensorFaults) {
      if (t === f.startS) addEvent(`sf-${f.node}`, { t, kind: 'sensor', node: f.node, text: `Cảm biến nút ${f.node} mất tín hiệu (${f.mode === 'missing' ? 'không có dữ liệu' : 'dữ liệu đóng băng'})` });
      if (t === f.startS + f.durationS) addEvent(`sf-end-${f.node}`, { t, kind: 'sensor_end', node: f.node, text: `Cảm biến nút ${f.node} hoạt động lại` });
    }

    // 2. observe → 3. decide
    const obs = buildObs(t);
    const out = controller.decide({ t, net, config, signals, obs });
    for (const tr of out.traces) {
      decisions.push(tr);
      decisionTimeSum += tr.decisionTimeMs;
      decisionCount++;
      if (tr.selected === 'METER') addEvent(`meter-${tr.node}`, { t, kind: 'meter', node: tr.node, text: `Nút ${tr.node} bắt đầu điều tiết dòng về ${net.mainOut[tr.node]}` });
      if (tr.selected === 'FALLBACK') addEvent(`fb-${tr.node}`, { t, kind: 'fallback', node: tr.node, text: `Nút ${tr.node} chuyển sang phương án dự phòng do thiếu dữ liệu` });
    }
    for (const m of out.newMessages) {
      messages.push(m);
      addEvent(`warn-${m.source}-${m.target}`, { t, kind: 'warning', node: m.source, linkId: m.linkId, text: `Nút ${m.source} gửi cảnh báo rủi ro ${m.risk.toFixed(2)} về ${m.linkId} tới nút ${m.target}` });
    }

    // 4. signal state machine (safety layer)
    const nextSignals = {} as Record<NodeId, SignalState>;
    for (const node of NODE_IDS) {
      const [sa, sb] = linkCells(net, net.sideIn[node]);
      let sideVeh = ext[net.sideIn[node]];
      for (let c = sa; c < sb; c++) sideVeh += n[c];
      const res = stepSignal(signals[node], out.requests[node], config.timing, dt, sideVeh > 0.5);
      if (!isSafeTransition(signals[node], res.state)) unsafeTransitions++;
      nextSignals[node] = res.state;
    }
    signals = nextSignals;

    // 5. CTM flows
    for (let c = 0; c < net.numCells; c++) {
      S[c] = Math.min(n[c], Qeff[c]);
      R[c] = Math.max(0, Math.min(Qeff[c], net.delta * (net.cellCap[c] - n[c])));
    }
    inflow.fill(0);
    outflow.fill(0);
    for (const l of LINK_IDS) {
      linkInLast[l] = 0;
      linkOutLast[l] = 0;
    }
    for (const l of net.linkList) {
      const [a, b] = linkCells(net, l.id);
      for (let c = a; c < b - 1; c++) {
        const y = Math.min(S[c], R[c + 1]);
        outflow[c] += y;
        inflow[c + 1] += y;
      }
    }
    // entrances
    for (const e of net.entryLinks) {
      const [a] = linkCells(net, e);
      const y = Math.min(ext[e], R[a]);
      ext[e] -= y;
      inflow[a] += y;
      linkInLast[e] += y;
    }
    // intersections
    let exitedStep = 0;
    for (const node of NODE_IDS) {
      const sig = signals[node];
      const inL = net.mainIn[node];
      const outL = net.mainOut[node];
      const [, ib] = linkCells(net, inL);
      const last = ib - 1;
      const [oa] = linkCells(net, outL);
      const gM = dischargeFactor(sig, 'MAIN', p.yellowDischarge);
      const total = Math.min(S[last] * gM, R[oa] / r);
      outflow[last] += total;
      inflow[oa] += total * r;
      linkOutLast[inL] += total;
      linkInLast[outL] += total * r;
      exitedStep += total * (1 - r);

      const sideL = net.sideIn[node];
      const [, sb] = linkCells(net, sideL);
      const gS = dischargeFactor(sig, 'SIDE', p.yellowDischarge);
      const ys = S[sb - 1] * gS;
      outflow[sb - 1] += ys;
      linkOutLast[sideL] += ys;
      exitedStep += ys;
    }
    {
      const [, eb] = linkCells(net, 'C-out');
      const y = S[eb - 1];
      outflow[eb - 1] += y;
      linkOutLast['C-out'] += y;
      exitedStep += y;
    }
    // internal (cell→cell) link boundary flows were already counted per link: none cross links except at nodes.

    // 6. conservation update + delay accounting
    let delayed = 0;
    let delayedSide = 0;
    for (let c = 0; c < net.numCells; c++) {
      const before = n[c];
      const d = Math.max(0, before - outflow[c]);
      lastDelayed[c] = d;
      lastOut[c] = before > 1e-9 ? Math.min(1, outflow[c] / before) : 1;
      delayed += d;
      if (net.links[net.cellLink[c]].kind === 'side') delayedSide += d;
      let v = before + inflow[c] - outflow[c];
      if (v < 0) {
        if (v < -1e-9) throw new Error(`negative vehicle count in cell ${c}: ${v}`);
        v = 0;
      }
      if (v > net.cellCap[c] + 1e-9) throw new Error(`cell ${c} over capacity: ${v} > ${net.cellCap[c]}`);
      n[c] = v;
    }
    exited += exitedStep;
    let extTotal = 0;
    for (const e of net.entryLinks) extTotal += ext[e];
    const extSide = ext.sA + ext.sB + ext.sC;
    const waitingNow = delayed + extTotal;
    cumWaiting += waitingNow * dt;
    sideWaiting += (delayedSide + extSide) * dt;
    queueSum += waitingNow;

    // link aggregates
    const linkVehicles = {} as Record<LinkId, number>;
    const linkOccupancy = {} as Record<LinkId, number>;
    const linkQueue = {} as Record<LinkId, number>;
    for (const l of net.linkList) {
      const [a, b] = linkCells(net, l.id);
      let v = 0;
      let q = 0;
      for (let c = a; c < b; c++) {
        v += n[c];
        q += lastDelayed[c];
      }
      linkVehicles[l.id] = v;
      linkOccupancy[l.id] = v / l.storage;
      linkQueue[l.id] = q;
      if (linkOccupancy[l.id] > maxOcc[l.id]) maxOcc[l.id] = linkOccupancy[l.id];
      if (linkOccupancy[l.id] >= 0.8 && l.kind === 'main') addEvent(`occ-${l.id}`, { t, kind: 'occupancy', linkId: l.id, text: `Đoạn ${l.id} vượt 80% sức chứa` });
    }
    let spillNow = false;
    for (const l of ['A-B', 'B-C'] as LinkId[]) {
      const [a] = linkCells(net, l);
      if (n[a] >= 0.5 * net.cellCap[a]) {
        spillNow = true;
        addEvent(`spill-${l}`, { t, kind: 'spillback', linkId: l, text: `Hàng chờ trên ${l} lan tới nút thượng lưu (spillback)` });
      }
    }
    if (spillNow) spillback += dt;
    const warnings = kind === 'waveguard' ? out.activeMessages.length : 0;
    warningsSum += warnings;
    warningsMax = Math.max(warningsMax, warnings);

    if (recordFrames) {
      const cells = new Float32Array(n);
      frames.push({
        t: t + dt,
        cells,
        moveFrac: new Float32Array(lastOut),
        signals: Object.fromEntries(NODE_IDS.map((id) => [id, { phase: signals[id].phase, stage: signals[id].stage, elapsed: signals[id].elapsed }])) as Frame['signals'],
        entryQueues: { ...ext },
        linkVehicles,
        linkOccupancy,
        linkQueue,
        forecasts: out.forecasts,
        pheromone: out.pheromone,
        activeMessages: out.activeMessages,
        actions: out.actions as Record<NodeId, ActionKind | null>,
        incidentActive,
        sensorFault: scenario.sensorFaults.filter((f) => t >= f.startS && t < f.startS + f.durationS).map((f) => f.node),
      });
    }
    if ((s + 1) % 10 === 0 || s === steps - 1) {
      let mo = 0;
      for (const l of LINK_IDS) mo = Math.max(mo, linkOccupancy[l]);
      series.push({
        t: t + dt,
        queue: waitingNow,
        cumWaiting,
        discharged: exited,
        maxOccupancy: mo,
        entryQueue: extTotal,
        warnings,
        occBC: linkOccupancy['B-C'],
        occAB: linkOccupancy['A-B'],
      });
    }
  }

  let inNet = 0;
  for (let c = 0; c < net.numCells; c++) inNet += n[c];
  let extTotal = 0;
  for (const e of net.entryLinks) extTotal += ext[e];
  let maxLink: LinkId = 'in-A';
  for (const l of LINK_IDS) if (maxOcc[l] > maxOcc[maxLink]) maxLink = l;

  const metrics: MetricsSummary = {
    totalArrived: arrived,
    totalDischarged: exited,
    cumulativeWaitingVehS: cumWaiting,
    avgQueue: queueSum / steps,
    maxLinkOccupancy: maxOcc[maxLink],
    maxOccupancyLink: maxLink,
    spillbackDurationS: spillback,
    finalEntryQueue: extTotal,
    vehiclesInNetwork: inNet,
    sideStreetWaitingVehS: sideWaiting,
    avgActiveWarnings: kind === 'waveguard' ? warningsSum / steps : null,
    maxActiveWarnings: kind === 'waveguard' ? warningsMax : null,
    avgDecisionTimeMs: decisionCount ? decisionTimeSum / decisionCount : null,
    conservationError: Math.abs(initialVehicles + arrived - (inNet + extTotal + exited)),
  };
  if (unsafeTransitions > 0) throw new Error(`unsafe signal transitions: ${unsafeTransitions}`);
  events.sort((a, b) => a.t - b.t);

  return {
    controller: kind,
    scenario,
    config,
    frames,
    series,
    metrics,
    decisions,
    messages,
    events,
    demandChecksum: demandChecksum(demand),
  };
}

/** Runs the same scenario (same demand trace object) under several controllers. */
export function compareControllers(
  scenario: ScenarioConfig,
  kinds: ControllerKind[],
  config: EngineConfig = DEFAULT_CONFIG,
  opts: { recordFrames?: boolean } = {},
): Record<ControllerKind, SimulationRun> {
  const net = buildNetwork(config.network);
  const demand = generateDemand(scenario, config.network.dt, net.entryLinks);
  const out = {} as Record<ControllerKind, SimulationRun>;
  for (const k of kinds) out[k] = runSimulation(scenario, k, config, { ...opts, demand });
  return out;
}
