import type { Network } from '../network';
import type {
  ActionKind,
  ControllerKind,
  DecisionTrace,
  EngineConfig,
  LinkForecast,
  NodeId,
  NodeObservation,
  RiskMessage,
  SignalState,
} from '../types';

export interface ControllerContext {
  t: number;
  net: Network;
  config: EngineConfig;
  signals: Record<NodeId, SignalState>;
  /** what each node can observe (may be missing / stale under sensor faults) */
  obs: Record<NodeId, NodeObservation>;
}

export interface ControllerOutput {
  requests: Record<NodeId, 'HOLD' | 'SWITCH'>;
  actions: Record<NodeId, ActionKind | null>;
  traces: DecisionTrace[];
  forecasts: LinkForecast[];
  pheromone: Record<NodeId, number>;
  activeMessages: RiskMessage[];
  newMessages: RiskMessage[];
}

export interface Controller {
  kind: ControllerKind;
  decide(ctx: ControllerContext): ControllerOutput;
  /** called after the signal machine processed the requests (for traces of forced / blocked transitions) */
  afterSignal?(node: NodeId, result: { honoured: boolean; forced: string | null; blockedBy: string | null }): void;
}

export const now = (): number =>
  typeof globalThis.performance !== 'undefined' ? globalThis.performance.now() : Date.now();
