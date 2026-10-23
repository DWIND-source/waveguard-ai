import type { EngineConfig, LinkId, LinkSpec, NetworkParams, NodeId } from './types';

/**
 * Corridor geometry (West → East) with three signalised intersections:
 *
 *            sA            sB            sC        (side streets, N → S, 1 lane)
 *            |             |             |
 *   in-A --> A --> A-B --> B --> B-C --> C --> C-out -->  (mainline, 2 lanes)
 *            |             |             |
 *          (sink)        (sink)        (sink)       side traffic + mainline turn-offs exit here
 *
 * Every link is discretised into CTM cells of length v_f·dt, so a vehicle in
 * free flow advances exactly one cell per step.
 */
export const DEFAULT_NETWORK: NetworkParams = {
  dt: 1,
  freeFlowSpeed: 13.9, // 50 km/h
  satFlowPerLane: 0.5, // 1800 veh/h/lane
  jamDensityPerLane: 1 / 7, // 7 m per stopped vehicle
  turnOffFraction: 0.08,
  yellowDischarge: 0.5,
};

export const DEFAULT_CONFIG: EngineConfig = {
  network: DEFAULT_NETWORK,
  timing: {
    minGreenMain: 12,
    minGreenSide: 8,
    maxGreenMain: 75,
    maxGreenSide: 45,
    yellow: 3,
    allRed: 2,
    maxSideRed: 80,
  },
  fixedPlan: {
    mainGreen: 60,
    sideGreen: 20,
    offsets: { A: 0, B: 24, C: 44 },
  },
  waveguard: {
    horizonS: 120,
    emaAlpha: 0.08,
    evaporation: 0.04,
    depositGain: 0.5,
    tauMax: 1,
    relayAttenuation: 0.6,
    emitThreshold: 0.3,
    messageTtlS: 30,
    refreshS: 10,
    riskDiscount: 0.6,
    decisionHorizonS: 10,
    fairnessWeight: 1.5,
    fallbackConfidence: 0.5,
  },
};

const LINK_GEOMETRY: Array<Omit<LinkSpec, 'cellStart' | 'numCells' | 'storage'>> = [
  { id: 'in-A', from: 'origin', to: 'A', kind: 'main', lengthM: 250, lanes: 2 },
  { id: 'A-B', from: 'A', to: 'B', kind: 'main', lengthM: 334, lanes: 2 },
  { id: 'B-C', from: 'B', to: 'C', kind: 'main', lengthM: 278, lanes: 2 },
  { id: 'C-out', from: 'C', to: 'sink', kind: 'main', lengthM: 195, lanes: 2 },
  { id: 'sA', from: 'origin', to: 'A', kind: 'side', lengthM: 139, lanes: 1 },
  { id: 'sB', from: 'origin', to: 'B', kind: 'side', lengthM: 139, lanes: 1 },
  { id: 'sC', from: 'origin', to: 'C', kind: 'side', lengthM: 139, lanes: 1 },
];

export interface Network {
  params: NetworkParams;
  links: Record<LinkId, LinkSpec>;
  linkList: LinkSpec[];
  numCells: number;
  cellLength: number;
  /** max vehicles per cell N_i */
  cellCap: Float64Array;
  /** max flow per step Q_i (veh/step) at base capacity */
  cellQ: Float64Array;
  cellLink: LinkId[];
  /** ratio δ = w / v_f used in CTM receiving function */
  delta: number;
  /** backward wave speed w (m/s) of the triangular fundamental diagram */
  waveSpeed: number;
  /** critical density per lane k_c (veh/m/lane) */
  criticalDensity: number;
  mainIn: Record<NodeId, LinkId>;
  mainOut: Record<NodeId, LinkId>;
  sideIn: Record<NodeId, LinkId>;
  upstreamNode: Record<NodeId, NodeId | null>;
  entryLinks: LinkId[];
}

export function buildNetwork(params: NetworkParams = DEFAULT_NETWORK): Network {
  const cellLength = params.freeFlowSpeed * params.dt;
  const kc = params.satFlowPerLane / params.freeFlowSpeed;
  const waveSpeed = params.satFlowPerLane / (params.jamDensityPerLane - kc);
  const delta = waveSpeed / params.freeFlowSpeed;
  let cursor = 0;
  const linkList: LinkSpec[] = LINK_GEOMETRY.map((g) => {
    const numCells = Math.max(3, Math.round(g.lengthM / cellLength));
    const spec: LinkSpec = {
      ...g,
      cellStart: cursor,
      numCells,
      storage: params.jamDensityPerLane * cellLength * numCells * g.lanes,
    };
    cursor += numCells;
    return spec;
  });
  const numCells = cursor;
  const cellCap = new Float64Array(numCells);
  const cellQ = new Float64Array(numCells);
  const cellLink: LinkId[] = new Array(numCells);
  for (const l of linkList) {
    for (let i = 0; i < l.numCells; i++) {
      const c = l.cellStart + i;
      cellCap[c] = params.jamDensityPerLane * cellLength * l.lanes;
      cellQ[c] = params.satFlowPerLane * l.lanes * params.dt;
      cellLink[c] = l.id;
    }
  }
  const links = Object.fromEntries(linkList.map((l) => [l.id, l])) as Record<LinkId, LinkSpec>;
  return {
    params,
    links,
    linkList,
    numCells,
    cellLength,
    cellCap,
    cellQ,
    cellLink,
    delta,
    waveSpeed,
    criticalDensity: kc,
    mainIn: { A: 'in-A', B: 'A-B', C: 'B-C' },
    mainOut: { A: 'A-B', B: 'B-C', C: 'C-out' },
    sideIn: { A: 'sA', B: 'sB', C: 'sC' },
    upstreamNode: { A: null, B: 'A', C: 'B' },
    entryLinks: ['in-A', 'sA', 'sB', 'sC'],
  };
}
