/**
 * Core types for the WaveGuard traffic engine.
 *
 * The engine is a pure TypeScript module with no React / DOM dependency so the
 * same code powers the live demo, the baseline comparison, the exports and the
 * automated tests (and can later be swapped for / coupled to SUMO or ESP32 nodes).
 */

export type NodeId = 'A' | 'B' | 'C';
export const NODE_IDS: NodeId[] = ['A', 'B', 'C'];

/** Directed road links. Mainline runs West → East: in-A → A → A-B → B → B-C → C → C-out. */
export type LinkId = 'in-A' | 'A-B' | 'B-C' | 'C-out' | 'sA' | 'sB' | 'sC';
export const LINK_IDS: LinkId[] = ['in-A', 'A-B', 'B-C', 'C-out', 'sA', 'sB', 'sC'];

export type Phase = 'MAIN' | 'SIDE';
export type Stage = 'GREEN' | 'YELLOW' | 'ALL_RED';

export type ControllerKind = 'fixed' | 'maxpressure' | 'waveguard';

export interface LinkSpec {
  id: LinkId;
  from: NodeId | 'origin';
  to: NodeId | 'sink';
  kind: 'main' | 'side';
  lengthM: number;
  lanes: number;
  /** index of first cell in the global cell arrays */
  cellStart: number;
  numCells: number;
  /** total storage (veh) = jam density × length × lanes */
  storage: number;
}

export interface NetworkParams {
  /** simulation timestep (s) */
  dt: number;
  /** free-flow speed v_f (m/s) */
  freeFlowSpeed: number;
  /** saturation flow per lane q_max (veh/s/lane) */
  satFlowPerLane: number;
  /** jam density k_j (veh/m/lane) */
  jamDensityPerLane: number;
  /** fraction of mainline vehicles turning off to the side street at each node */
  turnOffFraction: number;
  /** discharge factor during yellow (fraction of saturation flow) */
  yellowDischarge: number;
}

export interface SignalTiming {
  minGreenMain: number;
  minGreenSide: number;
  maxGreenMain: number;
  maxGreenSide: number;
  yellow: number;
  allRed: number;
  /** fairness: side street may not stay red longer than this while it has demand (s) */
  maxSideRed: number;
}

export interface FixedTimePlan {
  mainGreen: number;
  sideGreen: number;
  /** per-node offsets (s) for a simple green wave */
  offsets: Record<NodeId, number>;
}

export interface SignalState {
  node: NodeId;
  phase: Phase;
  stage: Stage;
  /** seconds spent in current stage */
  elapsed: number;
  /** seconds the side street has been without green */
  sideRed: number;
}

export type IncidentType = 'road_blockage' | 'capacity_drop' | 'demand_surge' | 'sensor_failure';

export interface Incident {
  id: string;
  type: IncidentType;
  linkId: LinkId;
  /** 0..1 position along link (0 = upstream end) where the bottleneck sits */
  positionFrac: number;
  /** fraction of capacity removed at the bottleneck (0..0.95) */
  capacityReduction: number;
  /** multiplicative demand increase for demand_surge (e.g. 0.4 = +40%) */
  demandIncrease: number;
  startS: number;
  durationS: number;
  description?: string;
}

export interface SensorFault {
  node: NodeId;
  startS: number;
  durationS: number;
  mode: 'missing' | 'frozen';
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  durationS: number;
  seed: number;
  /** mean arrival rates (veh/s) */
  demand: { main: number; side: Record<NodeId, number> };
  /** piecewise-linear demand multiplier profile */
  demandProfile: Array<{ t: number; factor: number }>;
  incidents: Incident[];
  sensorFaults: SensorFault[];
}

export interface WaveGuardParams {
  /** forecast horizon H (s) */
  horizonS: number;
  /** EMA smoothing factor for flow estimates (per step) */
  emaAlpha: number;
  /** pheromone evaporation rate ρ (1/s) */
  evaporation: number;
  /** deposit gain η */
  depositGain: number;
  /** upper bound of pheromone τ_max */
  tauMax: number;
  /** relay attenuation γ per hop */
  relayAttenuation: number;
  /** minimum risk to emit a warning θ_emit */
  emitThreshold: number;
  /** message time-to-live (s) */
  messageTtlS: number;
  /** re-emit interval when risk persists (s) */
  refreshS: number;
  /** risk discount κ applied to downstream receiving capacity */
  riskDiscount: number;
  /** decision look-ahead h (s) */
  decisionHorizonS: number;
  /** weight of side-street fairness term λ_f */
  fairnessWeight: number;
  /** confidence below which a node falls back to the conservative plan */
  fallbackConfidence: number;
}

export interface EngineConfig {
  network: NetworkParams;
  timing: SignalTiming;
  fixedPlan: FixedTimePlan;
  waveguard: WaveGuardParams;
}

/** What a node can observe about one link (null when the sensor is missing). */
export interface LinkObservation {
  linkId: LinkId;
  vehicles: number | null;
  occupancy: number | null;
  queue: number | null;
  /** vehicles entering the link this step (veh/s) */
  inflow: number | null;
  /** vehicles leaving the link this step (veh/s) */
  outflow: number | null;
  /** receiving capacity of the link's first cell (veh/s) */
  receiving: number | null;
  /** vehicles within ~h seconds of free-flow travel of the stop line (last 10 cells) */
  nearStop: number | null;
  /** position of queue tail from upstream end (m); null if no queue */
  queueTailM: number | null;
  confidence: number;
  stale: boolean;
}

export interface NodeObservation {
  node: NodeId;
  t: number;
  confidence: number;
  signal: SignalState;
  links: Partial<Record<LinkId, LinkObservation>>;
}

export interface LinkForecast {
  linkId: LinkId;
  observer: NodeId;
  occupancy: number;
  remainingStorage: number;
  /** smoothed net accumulation (veh/s); positive = filling */
  netRate: number;
  /** smoothed queue growth (veh/s) */
  queueGrowth: number;
  /** remainingStorage / netRate when netRate > 0, else null */
  timeToCapacity: number | null;
  /** LWR shockwave speed of the queue tail (m/s, negative = moving upstream) or null */
  shockSpeed: number | null;
  queueTailM: number | null;
  /** projected queue tail at forecast horizon (m from upstream end, may be < 0 => spills upstream) */
  projectedTailM: number | null;
  /** time until queue tail reaches upstream end (s) or null */
  timeToSpillback: number | null;
  risk: number;
  confidence: number;
  warning: string | null;
}

export interface RiskMessage {
  id: string;
  source: NodeId;
  target: NodeId;
  linkId: LinkId;
  risk: number;
  timeToCapacity: number | null;
  confidence: number;
  timestamp: number;
  expiry: number;
  hops: number;
  path: NodeId[];
}

export type ActionKind = 'MAINTAIN' | 'EXTEND' | 'SWITCH' | 'METER' | 'FALLBACK';

export interface CandidateAction {
  action: ActionKind;
  targetPhase: Phase;
  score: number | null;
  feasible: boolean;
  note: string;
}

export interface DecisionTrace {
  t: number;
  node: NodeId;
  controller: ControllerKind;
  state: {
    phase: Phase;
    stage: Stage;
    greenElapsed: number;
    mainQueue: number | null;
    sideQueue: number | null;
    downstreamOccupancy: number | null;
    downstreamReceiving: number | null;
    localRisk: number;
    pheromone: number;
    confidence: number;
  };
  receivedMessages: RiskMessage[];
  candidates: CandidateAction[];
  selected: ActionKind;
  request: 'HOLD' | 'SWITCH';
  reason: string;
  constraints: string[];
  decisionTimeMs: number;
}

export interface Frame {
  t: number;
  /** vehicles per cell */
  cells: Float32Array;
  /** fraction of each cell's vehicles that moved this step (0..1) */
  moveFrac: Float32Array;
  signals: Record<NodeId, { phase: Phase; stage: Stage; elapsed: number }>;
  entryQueues: Record<string, number>;
  linkVehicles: Record<LinkId, number>;
  linkOccupancy: Record<LinkId, number>;
  linkQueue: Record<LinkId, number>;
  /** WaveGuard-only data (empty for baselines) */
  forecasts: LinkForecast[];
  pheromone: Record<NodeId, number>;
  activeMessages: RiskMessage[];
  actions: Record<NodeId, ActionKind | null>;
  incidentActive: boolean;
  sensorFault: NodeId[];
}

export interface SeriesPoint {
  t: number;
  queue: number;
  cumWaiting: number;
  discharged: number;
  maxOccupancy: number;
  entryQueue: number;
  warnings: number;
  occBC: number;
  occAB: number;
}

export interface MetricsSummary {
  totalArrived: number;
  totalDischarged: number;
  cumulativeWaitingVehS: number;
  avgQueue: number;
  maxLinkOccupancy: number;
  maxOccupancyLink: LinkId;
  spillbackDurationS: number;
  finalEntryQueue: number;
  vehiclesInNetwork: number;
  sideStreetWaitingVehS: number;
  avgActiveWarnings: number | null;
  maxActiveWarnings: number | null;
  avgDecisionTimeMs: number | null;
  conservationError: number;
}

export interface TimelineEvent {
  t: number;
  kind: 'incident' | 'incident_end' | 'warning' | 'meter' | 'spillback' | 'occupancy' | 'sensor' | 'sensor_end' | 'fallback';
  node?: NodeId;
  linkId?: LinkId;
  text: string;
}

export interface SimulationRun {
  controller: ControllerKind;
  scenario: ScenarioConfig;
  config: EngineConfig;
  frames: Frame[];
  series: SeriesPoint[];
  metrics: MetricsSummary;
  decisions: DecisionTrace[];
  messages: RiskMessage[];
  events: TimelineEvent[];
  /** checksum of the demand trace (identical across controllers for the same scenario) */
  demandChecksum: string;
}
