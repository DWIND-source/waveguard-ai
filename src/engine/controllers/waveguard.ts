import type { Network } from '../network';
import { LinkPredictor } from '../predictor';
import { minGreen, plannedPhase } from '../signal';
import { StigmergyBus } from '../stigmergy';
import {
  NODE_IDS,
  type ActionKind,
  type CandidateAction,
  type DecisionTrace,
  type EngineConfig,
  type LinkForecast,
  type LinkId,
  type NodeId,
  type Phase,
  type RiskMessage,
} from '../types';
import { now, type Controller, type ControllerContext, type ControllerOutput } from './types';

/**
 * Proposed — WaveGuard: physics-guided congestion anticipation (PART A,
 * predictor.ts) + stigmergy-inspired risk propagation (PART B, stigmergy.ts)
 * + coordinated, safety-checked local decisions (PART C, this file)
 * + an explainable decision trace (PART D).
 *
 * PART C — scoring at node n while its current phase P is GREEN:
 *
 *   ρ_n        = max(r_local(downstream link), τ_n)                    effective downstream risk
 *   R_eff      = R_down · (1 − κ·ρ_n)                                  risk-discounted receiving capacity (veh/s)
 *   served_M(h)= min(q_M, s_M·h, R_eff·h / r_through)                  mainline vehicles servable in h seconds
 *   served_S(h)= min(q_S, s_S·h)
 *   u_X        = 1 + λ_f · red_X / 30                                   waiting / fairness urgency of phase X
 *   HOLD   score = served_P(h) · u_P
 *   SWITCH score = served_other(h − lost) · u_other − hysteresis       lost = yellow·(1−yellowDischarge) + allRed
 *
 * The node requests SWITCH when its score is higher. A switch away from MAIN
 * (or holding SIDE) that would NOT have been chosen with ρ_n = 0 is labelled
 * METER (flow metering toward a congested downstream link). If observation
 * confidence < fallbackConfidence the node applies FALLBACK (the conservative
 * fixed-time plan). All requests then pass through the signal state machine,
 * which enforces min/max green, yellow, all-red and side-street fairness —
 * neither the controller nor Gemini can bypass it.
 */
export class WaveGuardController implements Controller {
  kind = 'waveguard' as const;
  readonly bus: StigmergyBus;
  private predictors = new Map<string, LinkPredictor>();
  private mainRed: Record<NodeId, number> = { A: 0, B: 0, C: 0 };
  private lastAction: Record<NodeId, ActionKind | null> = { A: null, B: null, C: null };
  private lastTraceT: Record<NodeId, number> = { A: -1e9, B: -1e9, C: -1e9 };
  private hysteresis = 0.5;

  constructor(
    private readonly net: Network,
    private readonly config: EngineConfig,
  ) {
    this.bus = new StigmergyBus(config.waveguard);
    for (const n of NODE_IDS) {
      for (const l of [net.mainIn[n], net.mainOut[n]]) {
        this.predictors.set(`${n}:${l}`, new LinkPredictor(net, config.waveguard, n, l));
      }
    }
  }

  decide(ctx: ControllerContext): ControllerOutput {
    const { net, config, t } = ctx;
    const wg = config.waveguard;
    const dt = net.params.dt;
    this.bus.evaporate(t, dt);

    // ---- PART A: forecasts (recomputed every step from current observations)
    const forecasts: LinkForecast[] = [];
    const fc = (n: NodeId, l: LinkId) => forecasts.find((f) => f.observer === n && f.linkId === l)!;
    for (const n of NODE_IDS) {
      for (const l of [net.mainIn[n], net.mainOut[n]]) {
        forecasts.push(this.predictors.get(`${n}:${l}`)!.update(ctx.obs[n].links[l]));
      }
    }
    const reliable = (f: LinkForecast) => f.confidence >= wg.fallbackConfidence;

    // ---- PART B: emissions, downstream first so relays propagate C → B → A
    const newMessages: RiskMessage[] = [];
    // C observes its incoming link B-C from the stop line and warns B
    {
      const f = fc('C', 'B-C');
      const m = this.bus.emit({ t, source: 'C', target: 'B', linkId: 'B-C', risk: f.risk, timeToCapacity: f.timeToCapacity, confidence: f.confidence, path: [] });
      if (m) newMessages.push(m);
    }
    // B relays toward A about A-B (B will meter, so A-B is at risk too)
    {
      const fDown = fc('B', 'B-C');
      const fUp = fc('B', 'A-B');
      const localDown = reliable(fDown) ? fDown.risk : 0;
      const rhoB = Math.max(localDown, this.bus.tau.B);
      const relayed = wg.relayAttenuation * rhoB;
      const local = reliable(fUp) ? fUp.risk : 0;
      const useRelay = relayed > local;
      const conf = useRelay
        ? localDown >= this.bus.tau.B
          ? fDown.confidence
          : this.bus.tauConfidence.B
        : fUp.confidence;
      const m = this.bus.emit({
        t,
        source: 'B',
        target: 'A',
        linkId: 'A-B',
        risk: Math.max(relayed, local),
        timeToCapacity: useRelay ? fDown.timeToCapacity : fUp.timeToCapacity,
        confidence: conf,
        path: useRelay && this.bus.tau.B > localDown ? ['C'] : [],
      });
      if (m) newMessages.push(m);
    }

    // ---- PART C/D: local decisions
    const requests = {} as Record<NodeId, 'HOLD' | 'SWITCH'>;
    const actions = {} as Record<NodeId, ActionKind | null>;
    const traces: DecisionTrace[] = [];
    const p = net.params;
    const timing = config.timing;
    const lost = timing.yellow * (1 - p.yellowDischarge) + timing.allRed;
    for (const n of NODE_IDS) {
      const t0 = now();
      const s = ctx.signals[n];
      const o = ctx.obs[n];
      this.mainRed[n] = s.phase === 'MAIN' && s.stage !== 'ALL_RED' ? 0 : this.mainRed[n] + dt;
      if (s.stage !== 'GREEN') {
        requests[n] = 'HOLD';
        actions[n] = this.lastAction[n];
        continue;
      }
      const fDown = fc(n, net.mainOut[n]);
      const localRisk = reliable(fDown) ? fDown.risk : 0;
      const tau = this.bus.tau[n];
      const rho = Math.max(localRisk, tau);
      const mainObs = o.links[net.mainIn[n]];
      const sideObs = o.links[net.sideIn[n]];
      const downObs = o.links[net.mainOut[n]];
      const received = this.bus.messagesFor(n);
      const constraints: string[] = [];
      const other: Phase = s.phase === 'MAIN' ? 'SIDE' : 'MAIN';
      const canSwitch = s.elapsed >= minGreen(s.phase, timing);
      if (!canSwitch) constraints.push(`Thời gian xanh tối thiểu: pha ${s.phase} mới xanh ${s.elapsed}s < ${minGreen(s.phase, timing)}s`);

      const lowConf = o.confidence < wg.fallbackConfidence || mainObs?.nearStop == null || sideObs?.nearStop == null || downObs?.receiving == null;
      let request: 'HOLD' | 'SWITCH';
      let selected: ActionKind;
      let reason: string;
      const candidates: CandidateAction[] = [];

      if (lowConf) {
        const want = plannedPhase(config.fixedPlan, timing, n, t);
        request = want !== s.phase ? 'SWITCH' : 'HOLD';
        selected = 'FALLBACK';
        constraints.push(`Độ tin cậy cảm biến ${Math.round(o.confidence * 100)}% < ${Math.round(wg.fallbackConfidence * 100)}% → dùng phương án dự phòng an toàn (chu kỳ cố định)`);
        reason = `Nút ${n} không có quan sát đáng tin cậy nên không suy đoán trạng thái giao thông; áp dụng chu kỳ cố định thận trọng${tau > 0.05 ? `, vẫn tiếp nhận và chuyển tiếp cảnh báo từ hạ lưu (τ=${tau.toFixed(2)})` : ''}.`;
        candidates.push(
          { action: 'MAINTAIN', targetPhase: s.phase, score: null, feasible: false, note: 'Không đủ dữ liệu để chấm điểm' },
          { action: 'SWITCH', targetPhase: other, score: null, feasible: false, note: 'Không đủ dữ liệu để chấm điểm' },
          { action: 'FALLBACK', targetPhase: want, score: null, feasible: true, note: 'Chu kỳ cố định' },
        );
      } else {
        const h = wg.decisionHorizonS;
        const r = 1 - p.turnOffFraction;
        const sM = p.satFlowPerLane * net.links[net.mainIn[n]].lanes;
        const sS = p.satFlowPerLane * net.links[net.sideIn[n]].lanes;
        const qM = mainObs!.nearStop!;
        const qS = sideObs!.nearStop!;
        const recv = downObs!.receiving!;
        const servedMain = (hh: number, riskAware: boolean) =>
          Math.max(0, Math.min(qM, sM * hh, (recv * (riskAware ? 1 - wg.riskDiscount * rho : 1) * hh) / r));
        const servedSide = (hh: number) => Math.max(0, Math.min(qS, sS * hh));
        const uM = 1 + (wg.fairnessWeight * this.mainRed[n]) / 30;
        const uS = 1 + (wg.fairnessWeight * s.sideRed) / 30;
        const score = (riskAware: boolean) => {
          if (s.phase === 'MAIN') {
            return { hold: servedMain(h, riskAware) * uM, sw: servedSide(h - lost) * uS - this.hysteresis };
          }
          return { hold: servedSide(h) * uS, sw: servedMain(h - lost, riskAware) * uM - this.hysteresis };
        };
        const withRisk = score(true);
        const noRisk = score(false);
        const wantSwitch = withRisk.sw > withRisk.hold;
        const wouldSwitchNoRisk = noRisk.sw > noRisk.hold;
        request = wantSwitch && canSwitch ? 'SWITCH' : 'HOLD';
        const riskCaused = s.phase === 'MAIN' ? wantSwitch && !wouldSwitchNoRisk : !wantSwitch && wouldSwitchNoRisk;
        const holdLabel: ActionKind =
          s.phase === 'SIDE' && riskCaused ? 'METER' : s.phase === 'MAIN' && s.elapsed > config.fixedPlan.mainGreen ? 'EXTEND' : 'MAINTAIN';
        const switchLabel: ActionKind = s.phase === 'MAIN' && (riskCaused || rho >= 0.5) ? 'METER' : 'SWITCH';
        candidates.push(
          { action: holdLabel, targetPhase: s.phase, score: withRisk.hold, feasible: true, note: s.phase === 'MAIN' ? `phục vụ ~${servedMain(h, true).toFixed(1)} xe chính / ${h}s` : `phục vụ ~${servedSide(h).toFixed(1)} xe đường ngang / ${h}s` },
          { action: switchLabel, targetPhase: other, score: withRisk.sw, feasible: canSwitch, note: canSwitch ? `mất ${lost.toFixed(1)}s chuyển pha` : 'chưa đủ xanh tối thiểu' },
          { action: 'FALLBACK', targetPhase: plannedPhase(config.fixedPlan, timing, n, t), score: null, feasible: false, note: 'chỉ dùng khi độ tin cậy thấp' },
        );
        selected = request === 'SWITCH' ? switchLabel : wantSwitch ? 'MAINTAIN' : holdLabel;
        const riskTxt = `rủi ro hạ lưu ρ=${rho.toFixed(2)} (cục bộ ${localRisk.toFixed(2)}, pheromone τ=${tau.toFixed(2)})`;
        if (selected === 'METER' && s.phase === 'MAIN') {
          reason = `Điều tiết dòng về ${net.mainOut[n]}: ${riskTxt}; khả năng tiếp nhận hiệu dụng giảm còn ${(recv * (1 - wg.riskDiscount * rho)).toFixed(2)} xe/s nên nhường xanh cho đường ngang (${qS.toFixed(1)} xe chờ).`;
        } else if (selected === 'METER') {
          reason = `Giữ xanh đường ngang để hạn chế xe đổ vào ${net.mainOut[n]}: ${riskTxt}. Nếu bỏ qua rủi ro, bộ điều khiển đã chuyển về trục chính.`;
        } else if (selected === 'SWITCH') {
          reason = `Chuyển sang pha ${other}: điểm ${withRisk.sw.toFixed(1)} > ${withRisk.hold.toFixed(1)} (hàng chờ chính ${qM.toFixed(1)}, đường ngang ${qS.toFixed(1)} xe; ${riskTxt}).`;
        } else if (selected === 'EXTEND') {
          reason = `Kéo dài xanh trục chính: còn ${qM.toFixed(1)} xe gần vạch dừng và hạ lưu còn tiếp nhận ${recv.toFixed(2)} xe/s (${riskTxt}).`;
        } else {
          reason = wantSwitch && !canSwitch
            ? `Muốn chuyển pha nhưng bị ràng buộc thời gian xanh tối thiểu; giữ pha ${s.phase}.`
            : `Giữ pha ${s.phase}: điểm ${withRisk.hold.toFixed(1)} ≥ ${withRisk.sw.toFixed(1)} (${riskTxt}).`;
        }
        if (rho > 0 && rho >= wg.emitThreshold) constraints.push(`Hạ lưu ${net.mainOut[n]} có rủi ro tràn ${rho.toFixed(2)} → giảm tiếp nhận hiệu dụng ${Math.round(wg.riskDiscount * rho * 100)}%`);
        if (s.phase === 'MAIN' && s.sideRed > timing.maxSideRed * 0.7) constraints.push(`Công bằng: đường ngang đã chờ ${s.sideRed}s (tối đa ${timing.maxSideRed}s)`);
        if (s.elapsed >= (s.phase === 'MAIN' ? timing.maxGreenMain : timing.maxGreenSide) - 1) constraints.push('Sắp chạm thời gian xanh tối đa → bộ an toàn sẽ buộc chuyển pha');
      }
      actions[n] = selected;
      requests[n] = request;
      const changed = selected !== this.lastAction[n] || request === 'SWITCH';
      this.lastAction[n] = selected;
      if (changed || t - this.lastTraceT[n] >= 15) {
        this.lastTraceT[n] = t;
        traces.push({
          t,
          node: n,
          controller: 'waveguard',
          state: {
            phase: s.phase,
            stage: s.stage,
            greenElapsed: s.elapsed,
            mainQueue: mainObs?.nearStop ?? null,
            sideQueue: sideObs?.nearStop ?? null,
            downstreamOccupancy: downObs?.occupancy ?? null,
            downstreamReceiving: downObs?.receiving ?? null,
            localRisk,
            pheromone: tau,
            confidence: o.confidence,
          },
          receivedMessages: received.map((m) => ({ ...m, path: [...m.path] })),
          candidates,
          selected,
          request,
          reason,
          constraints,
          decisionTimeMs: now() - t0,
        });
      }
    }

    return {
      requests,
      actions,
      traces,
      forecasts,
      pheromone: { ...this.bus.tau },
      activeMessages: this.bus.active.slice(),
      newMessages,
    };
  }
}
