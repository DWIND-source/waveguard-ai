import { minGreen, plannedPhase } from '../signal';
import { NODE_IDS, type DecisionTrace, type NodeId, type Phase } from '../types';
import { now, type Controller, type ControllerContext, type ControllerOutput } from './types';

/**
 * Baseline 2 — Simplified Max-Pressure (after Varaiya, 2013).
 *
 * For each movement m = (upstream link i → downstream link j):
 *     w_m = x_i − Σ_j r_ij · x_j
 * where x is the number of vehicles on a link (observed), r_ij the turning
 * ratio (mainline through = 1 − turnOff, side streets and turn-offs exit to a
 * sink with x = 0). Phase pressure:
 *     P(phase) = Σ_{m ∈ phase} s_m · w_m       (s_m = saturation flow, veh/s)
 * Decision (every step, only while GREEN and min-green satisfied):
 *     switch if P(other) > P(current) + hysteresis.
 * Assumptions: perfect link counts when sensors work; when a node's
 * observation is missing it falls back to the fixed-time plan.
 */
export class MaxPressureController implements Controller {
  kind = 'maxpressure' as const;
  constructor(private readonly hysteresis = 0.5) {}

  decide(ctx: ControllerContext): ControllerOutput {
    const { net, config } = ctx;
    const p = net.params;
    const requests = {} as Record<NodeId, 'HOLD' | 'SWITCH'>;
    const traces: DecisionTrace[] = [];
    for (const n of NODE_IDS) {
      const t0 = now();
      const s = ctx.signals[n];
      const o = ctx.obs[n];
      const up = o.links[net.mainIn[n]]?.vehicles ?? null;
      const down = o.links[net.mainOut[n]]?.vehicles ?? null;
      const side = o.links[net.sideIn[n]]?.vehicles ?? null;
      if (s.stage !== 'GREEN') {
        requests[n] = 'HOLD';
        continue;
      }
      if (up === null || down === null || side === null) {
        const want = plannedPhase(config.fixedPlan, config.timing, n, ctx.t);
        requests[n] = s.phase !== want ? 'SWITCH' : 'HOLD';
        continue;
      }
      const sMain = p.satFlowPerLane * net.links[net.mainIn[n]].lanes;
      const sSide = p.satFlowPerLane * net.links[net.sideIn[n]].lanes;
      const r = 1 - p.turnOffFraction;
      const P: Record<Phase, number> = {
        MAIN: sMain * (up - r * down),
        SIDE: sSide * side,
      };
      const other: Phase = s.phase === 'MAIN' ? 'SIDE' : 'MAIN';
      const canSwitch = s.elapsed >= minGreen(s.phase, config.timing);
      const sw = canSwitch && P[other] > P[s.phase] + this.hysteresis;
      requests[n] = sw ? 'SWITCH' : 'HOLD';
      if (sw) {
        traces.push({
          t: ctx.t,
          node: n,
          controller: 'maxpressure',
          state: {
            phase: s.phase,
            stage: s.stage,
            greenElapsed: s.elapsed,
            mainQueue: up,
            sideQueue: side,
            downstreamOccupancy: o.links[net.mainOut[n]]?.occupancy ?? null,
            downstreamReceiving: o.links[net.mainOut[n]]?.receiving ?? null,
            localRisk: 0,
            pheromone: 0,
            confidence: o.confidence,
          },
          receivedMessages: [],
          candidates: [
            { action: 'MAINTAIN', targetPhase: s.phase, score: P[s.phase], feasible: true, note: `P(${s.phase})` },
            { action: 'SWITCH', targetPhase: other, score: P[other], feasible: canSwitch, note: `P(${other})` },
          ],
          selected: 'SWITCH',
          request: 'SWITCH',
          reason: `Áp lực pha ${other} (${P[other].toFixed(1)}) lớn hơn pha ${s.phase} (${P[s.phase].toFixed(1)}).`,
          constraints: [],
          decisionTimeMs: now() - t0,
        });
      }
    }
    return {
      requests,
      actions: { A: null, B: null, C: null },
      traces,
      forecasts: [],
      pheromone: { A: 0, B: 0, C: 0 },
      activeMessages: [],
      newMessages: [],
    };
  }
}
