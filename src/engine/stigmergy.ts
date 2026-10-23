import type { NodeId, LinkId, RiskMessage, WaveGuardParams } from './types';

/**
 * PART B — Stigmergy-inspired risk propagation (experimental design hypothesis,
 * NOT a proven-superior method).
 *
 * Each node n keeps a bounded "pheromone" τ_n ∈ [0, τ_max] describing warning
 * intensity for its downstream mainline link. Per step of length dt:
 *
 *   evaporation : τ_n ← τ_n · (1 − ρ·dt)
 *   deposit     : for every newly delivered message m targeting n
 *                 τ_n ← τ_n + η · c_m · r_m · (τ_max − τ_n)
 *
 * with ρ = evaporation rate, η = deposit gain, c_m = observation confidence of
 * the source, r_m = risk carried by the message. The saturating deposit keeps
 * τ_n ≤ τ_max (no uncontrolled amplification) and low-confidence sources
 * deposit proportionally less.
 *
 * Emission / relay (upstream only, so the graph is acyclic):
 *   - a node emits to its upstream neighbour when its risk r ≥ θ_emit, and the
 *     risk rose by ≥ 0.05 since its last message, or refreshS has passed;
 *   - relayed risk is attenuated by γ per hop:  r_relay = γ · max(r_local_down, τ_n);
 *   - a message is never delivered to a node already on its path;
 *   - messages expire after TTL seconds and are dropped.
 */
export class StigmergyBus {
  tau: Record<NodeId, number> = { A: 0, B: 0, C: 0 };
  /** confidence of the evidence currently stored in τ_n */
  tauConfidence: Record<NodeId, number> = { A: 1, B: 1, C: 1 };
  active: RiskMessage[] = [];
  delivered: RiskMessage[] = [];
  private lastEmit = new Map<string, { t: number; risk: number }>();
  private seq = 0;

  constructor(private readonly p: WaveGuardParams) {}

  evaporate(t: number, dt: number) {
    for (const n of Object.keys(this.tau) as NodeId[]) {
      this.tau[n] = Math.max(0, this.tau[n] * (1 - this.p.evaporation * dt));
    }
    this.active = this.active.filter((m) => m.expiry > t);
  }

  /** Try to emit a message; returns it when actually sent (and deposited at the target). */
  emit(args: {
    t: number;
    source: NodeId;
    target: NodeId;
    linkId: LinkId;
    risk: number;
    timeToCapacity: number | null;
    confidence: number;
    path: NodeId[];
  }): RiskMessage | null {
    const { t, source, target, linkId } = args;
    const risk = Math.max(0, Math.min(1, args.risk));
    if (risk < this.p.emitThreshold) return null;
    if (args.path.includes(target)) return null; // no circular propagation
    const key = `${source}>${target}:${linkId}`;
    const prev = this.lastEmit.get(key);
    if (prev && risk - prev.risk < 0.05 && t - prev.t < this.p.refreshS) return null;
    this.lastEmit.set(key, { t, risk });
    const msg: RiskMessage = {
      id: `m${++this.seq}`,
      source,
      target,
      linkId,
      risk,
      timeToCapacity: args.timeToCapacity,
      confidence: Math.max(0, Math.min(1, args.confidence)),
      timestamp: t,
      expiry: t + this.p.messageTtlS,
      hops: args.path.length + 1,
      path: [...args.path, source],
    };
    this.deposit(target, msg);
    this.active.push(msg);
    this.delivered.push(msg);
    return msg;
  }

  private deposit(n: NodeId, m: RiskMessage) {
    const before = this.tau[n];
    const inc = this.p.depositGain * m.confidence * m.risk * (this.p.tauMax - before);
    this.tau[n] = Math.min(this.p.tauMax, before + inc);
    // confidence of stored evidence: weighted by contribution
    const w = before + inc > 1e-9 ? inc / (before + inc) : 1;
    this.tauConfidence[n] = (1 - w) * this.tauConfidence[n] + w * m.confidence;
  }

  messagesFor(n: NodeId): RiskMessage[] {
    return this.active.filter((m) => m.target === n);
  }
}
