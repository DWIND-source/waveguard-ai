import type { Network } from './network';
import type { LinkForecast, LinkId, LinkObservation, NodeId, WaveGuardParams } from './types';

/**
 * PART A — Congestion wave prediction (CTM / LWR-inspired).
 *
 * For a link observed by a node we keep exponential moving averages of the
 * measured inflow q_in and outflow q_out (veh/s) and compute:
 *
 *   occupancy          = n / storage
 *   remainingStorage   = storage − n
 *   netRate            = EMA(q_in) − EMA(q_out)
 *   timeToCapacity     = remainingStorage / netRate     only if netRate > ε, else null (not filling)
 *
 * Queue-tail shockwave (Lighthill–Whitham–Richards, triangular fundamental diagram):
 *   upstream (arriving) state   : q_u = EMA(q_in),  k_u = q_u / v_f                 (free-flow branch)
 *   downstream (queued) state   : q_d = EMA(q_out), k_d = L·k_j − q_d / w             (congested branch)
 *   shock speed                 : u = (q_d − q_u) / (k_d − k_u)     (m/s, negative = travels upstream)
 * The shock speed is only computed when a queue actually exists, so no wave is
 * reported (or drawn) when the model predicts none.
 *
 * Link risk in [0, 1]:
 *   risk = max( clamp((occ − 0.5)/0.4), clamp(1 − TTC/H), clamp(1 − T_spill/H) )
 */
export const NET_RATE_EPS = 0.01;

export class LinkPredictor {
  private emaIn = 0;
  private emaOut = 0;
  private emaQueueGrowth = 0;
  private lastQueue: number | null = null;
  private last: LinkForecast | null = null;
  private initialised = false;
  /** number of valid observations; risk is suppressed during EMA warm-up */
  private samples = 0;

  constructor(
    private readonly net: Network,
    private readonly params: WaveGuardParams,
    readonly observer: NodeId,
    readonly linkId: LinkId,
  ) {}

  update(obs: LinkObservation | undefined): LinkForecast {
    const spec = this.net.links[this.linkId];
    const H = this.params.horizonS;
    if (!obs || obs.vehicles === null || obs.inflow === null || obs.outflow === null || obs.occupancy === null) {
      // Missing observation: never fabricate new evidence. Keep the last
      // estimate but mark it as low-confidence and stale.
      const conf = obs?.confidence ?? 0;
      const base: LinkForecast = this.last ?? {
        linkId: this.linkId,
        observer: this.observer,
        occupancy: 0,
        remainingStorage: spec.storage,
        netRate: 0,
        queueGrowth: 0,
        timeToCapacity: null,
        shockSpeed: null,
        queueTailM: null,
        projectedTailM: null,
        timeToSpillback: null,
        risk: 0,
        confidence: conf,
        warning: null,
      };
      return { ...base, confidence: conf, warning: null };
    }

    const a = this.params.emaAlpha;
    this.samples++;
    if (!this.initialised) {
      this.emaIn = obs.inflow;
      this.emaOut = obs.outflow;
      this.initialised = true;
    } else {
      this.emaIn += a * (obs.inflow - this.emaIn);
      this.emaOut += a * (obs.outflow - this.emaOut);
    }
    const q = obs.queue ?? 0;
    if (this.lastQueue !== null) this.emaQueueGrowth += a * (q - this.lastQueue - this.emaQueueGrowth);
    this.lastQueue = q;

    const occupancy = obs.occupancy;
    const remainingStorage = Math.max(0, spec.storage - obs.vehicles);
    const netRate = this.emaIn - this.emaOut;
    const timeToCapacity = netRate > NET_RATE_EPS ? remainingStorage / netRate : null;

    let shockSpeed: number | null = null;
    let projectedTailM: number | null = null;
    let timeToSpillback: number | null = null;
    const tail = obs.queueTailM;
    if (tail !== null) {
      const p = this.net.params;
      const kjTot = p.jamDensityPerLane * spec.lanes;
      const qu = Math.max(0, this.emaIn);
      const ku = qu / p.freeFlowSpeed;
      const qd = Math.max(0, this.emaOut);
      const kd = kjTot - qd / this.net.waveSpeed;
      if (kd - ku > 1e-6) {
        shockSpeed = (qd - qu) / (kd - ku);
        projectedTailM = tail + shockSpeed * H;
        if (shockSpeed < -1e-3) timeToSpillback = tail / -shockSpeed;
      }
      // queue already reaches the upstream end of the link: spillback is happening now
      if (tail <= this.net.cellLength * 1.01) timeToSpillback = 0;
    }

    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const occTerm = clamp((occupancy - 0.5) / 0.4);
    const ttcTerm = timeToCapacity === null ? 0 : clamp(1 - timeToCapacity / H);
    const spillTerm = timeToSpillback === null ? 0 : clamp(1 - timeToSpillback / H);
    // EMA warm-up (~3/α steps): occupancy evidence only, no extrapolated forecasts yet
    const warm = this.samples >= Math.ceil(3 / a);
    const risk = warm ? Math.max(occTerm, ttcTerm, spillTerm) : occTerm;

    let warning: string | null = null;
    if (!warm) {
      warning = null;
    } else if (timeToSpillback === 0) {
      warning = `Hàng chờ trên ${this.linkId} đã lan tới nút thượng lưu (spillback), chiếm ${Math.round(occupancy * 100)}% sức chứa.`;
    } else if (timeToSpillback !== null && timeToSpillback <= H) {
      warning = `Hàng chờ trên ${this.linkId} lan ngược ~${Math.abs(shockSpeed!).toFixed(1)} m/s, có thể chạm nút thượng lưu sau ~${Math.round(timeToSpillback)} s.`;
    } else if (timeToCapacity !== null && timeToCapacity <= H) {
      warning = `Đoạn ${this.linkId} có thể đạt sức chứa trong ~${Math.round(timeToCapacity)} s (cửa sổ dự báo ${H} s).`;
    } else if (occupancy >= 0.85) {
      warning = `Đoạn ${this.linkId} đã đầy ${Math.round(occupancy * 100)}% sức chứa.`;
    }

    const f: LinkForecast = {
      linkId: this.linkId,
      observer: this.observer,
      occupancy,
      remainingStorage,
      netRate,
      queueGrowth: this.emaQueueGrowth,
      timeToCapacity,
      shockSpeed,
      queueTailM: tail,
      projectedTailM,
      timeToSpillback,
      risk,
      confidence: obs.confidence,
      warning,
    };
    this.last = f;
    return f;
  }
}
