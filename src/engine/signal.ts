import type { FixedTimePlan, NodeId, Phase, SignalState, SignalTiming } from './types';

/**
 * Deterministic signal state machine. Controllers can only *request* HOLD or
 * SWITCH — every transition goes through this module, which enforces:
 *   - minimum green before a requested switch is honoured
 *   - maximum green (forced switch)
 *   - yellow clearance, then all-red, then the other phase's green
 *   - side-street fairness: side may not stay red longer than maxSideRed while it has demand
 *   - only one phase can be GREEN at a time (a single phase variable — conflicting greens are unrepresentable)
 */
export interface SignalStepResult {
  state: SignalState;
  honoured: boolean;
  forced: 'max_green' | 'fairness' | null;
  blockedBy: 'min_green' | 'clearance' | null;
}

export function minGreen(phase: Phase, timing: SignalTiming): number {
  return phase === 'MAIN' ? timing.minGreenMain : timing.minGreenSide;
}
export function maxGreen(phase: Phase, timing: SignalTiming): number {
  return phase === 'MAIN' ? timing.maxGreenMain : timing.maxGreenSide;
}

export function other(phase: Phase): Phase {
  return phase === 'MAIN' ? 'SIDE' : 'MAIN';
}

export function stepSignal(
  s: SignalState,
  request: 'HOLD' | 'SWITCH',
  timing: SignalTiming,
  dt: number,
  sideHasDemand: boolean,
): SignalStepResult {
  const next: SignalState = { ...s };
  let honoured = request === 'HOLD';
  let forced: SignalStepResult['forced'] = null;
  let blockedBy: SignalStepResult['blockedBy'] = null;

  if (s.stage === 'GREEN') {
    let goYellow = false;
    if (s.elapsed >= maxGreen(s.phase, timing)) {
      goYellow = true;
      forced = 'max_green';
    } else if (s.phase === 'MAIN' && sideHasDemand && s.sideRed >= timing.maxSideRed && s.elapsed >= timing.minGreenMain) {
      goYellow = true;
      forced = 'fairness';
    } else if (request === 'SWITCH') {
      if (s.elapsed >= minGreen(s.phase, timing)) {
        goYellow = true;
        honoured = true;
      } else {
        blockedBy = 'min_green';
      }
    }
    if (goYellow) {
      next.stage = 'YELLOW';
      next.elapsed = 0;
    } else {
      next.elapsed = s.elapsed + dt;
    }
  } else if (s.stage === 'YELLOW') {
    if (request === 'SWITCH') blockedBy = 'clearance';
    if (s.elapsed + dt >= timing.yellow) {
      next.stage = 'ALL_RED';
      next.elapsed = 0;
    } else next.elapsed = s.elapsed + dt;
  } else {
    if (request === 'SWITCH') blockedBy = 'clearance';
    if (s.elapsed + dt >= timing.allRed) {
      next.stage = 'GREEN';
      next.phase = other(s.phase);
      next.elapsed = 0;
    } else next.elapsed = s.elapsed + dt;
  }
  // side-street red timer
  const sideGreenNow = next.phase === 'SIDE' && next.stage !== 'ALL_RED';
  next.sideRed = sideGreenNow ? 0 : s.sideRed + dt;
  return { state: next, honoured, forced, blockedBy };
}

/** Discharge factor for a phase given the signal state (1 = full saturation flow). */
export function dischargeFactor(s: SignalState, phase: Phase, yellowDischarge: number): number {
  if (s.phase !== phase) return 0;
  if (s.stage === 'GREEN') return 1;
  if (s.stage === 'YELLOW') return yellowDischarge;
  return 0;
}

export function cycleLength(plan: FixedTimePlan, timing: SignalTiming): number {
  return plan.mainGreen + plan.sideGreen + 2 * (timing.yellow + timing.allRed);
}

/** Phase that the fixed-time plan wants green at time t for a node. */
export function plannedPhase(plan: FixedTimePlan, timing: SignalTiming, node: NodeId, t: number): Phase {
  const C = cycleLength(plan, timing);
  const pos = (((t - plan.offsets[node]) % C) + C) % C;
  // cycle: [0, g_M) MAIN green | clearance | SIDE green | clearance → back to MAIN.
  // The wanted phase flips at the *start* of each clearance so the switch request
  // triggers yellow at the right moment.
  const clear = timing.yellow + timing.allRed;
  return pos < plan.mainGreen || pos >= plan.mainGreen + clear + plan.sideGreen ? 'MAIN' : 'SIDE';
}

/** Initial signal state consistent with the fixed-time plan at t = 0 (shared by all controllers). */
export function initialSignal(plan: FixedTimePlan, timing: SignalTiming, node: NodeId): SignalState {
  const C = cycleLength(plan, timing);
  const pos = (((0 - plan.offsets[node]) % C) + C) % C;
  const mainSpan = plan.mainGreen + timing.yellow + timing.allRed;
  const phase: Phase = pos < mainSpan ? 'MAIN' : 'SIDE';
  const inPhase = phase === 'MAIN' ? pos : pos - mainSpan;
  const g = phase === 'MAIN' ? plan.mainGreen : plan.sideGreen;
  let stage: SignalState['stage'] = 'GREEN';
  let elapsed = inPhase;
  if (inPhase >= g + timing.yellow) {
    stage = 'ALL_RED';
    elapsed = inPhase - g - timing.yellow;
  } else if (inPhase >= g) {
    stage = 'YELLOW';
    elapsed = inPhase - g;
  }
  const sideRed = phase === 'SIDE' ? 0 : inPhase;
  return { node, phase, stage, elapsed, sideRed };
}

export function isSafeTransition(prev: SignalState, next: SignalState): boolean {
  if (prev.stage === 'GREEN') return (next.stage === 'GREEN' && next.phase === prev.phase) || (next.stage === 'YELLOW' && next.phase === prev.phase);
  if (prev.stage === 'YELLOW') return next.phase === prev.phase && (next.stage === 'YELLOW' || next.stage === 'ALL_RED');
  return (next.stage === 'ALL_RED' && next.phase === prev.phase) || (next.stage === 'GREEN' && next.phase !== prev.phase);
}
