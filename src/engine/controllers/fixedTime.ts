import { plannedPhase } from '../signal';
import { NODE_IDS, type NodeId } from '../types';
import type { Controller, ControllerContext, ControllerOutput } from './types';

/**
 * Baseline 1 — Fixed-Time.
 * Pre-timed two-phase plan (main green, side green, yellow, all-red) with
 * static offsets for a simple green wave. No observation is used.
 */
export class FixedTimeController implements Controller {
  kind = 'fixed' as const;

  decide(ctx: ControllerContext): ControllerOutput {
    const requests = {} as Record<NodeId, 'HOLD' | 'SWITCH'>;
    for (const n of NODE_IDS) {
      const s = ctx.signals[n];
      const want = plannedPhase(ctx.config.fixedPlan, ctx.config.timing, n, ctx.t);
      requests[n] = s.stage === 'GREEN' && s.phase !== want ? 'SWITCH' : 'HOLD';
    }
    return {
      requests,
      actions: { A: null, B: null, C: null },
      traces: [],
      forecasts: [],
      pheromone: { A: 0, B: 0, C: 0 },
      activeMessages: [],
      newMessages: [],
    };
  }
}
