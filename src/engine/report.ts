import type { ControllerKind, DecisionTrace, MetricsSummary, SimulationRun } from './types';
import { engineText } from '../lib/engineText';

export const DISCLAIMER = 'Đây là kết quả mô phỏng, chưa phải dữ liệu thử nghiệm giao thông thực tế.';
export const DISCLAIMER_EN = 'These are simulation results, not real-world traffic trial data.';

export const LIMITATIONS = [
  'Mô hình CTM vĩ mô (dòng xe liên tục) trên 3 nút giao, không phải mô phỏng vi mô từng xe; xe hiển thị chỉ mang tính sơ đồ.',
  'Nhu cầu giao thông là chuỗi Poisson tổng hợp theo seed, không phải dữ liệu đo thực tế tại Hà Nội.',
  'Hiện tượng chặn nút giao (xe kẹt giữa ngã tư), làn rẽ riêng, xe máy hỗn hợp và người đi bộ chưa được mô hình hoá.',
  'Cơ chế lan truyền rủi ro kiểu stigmergy là giả thuyết thiết kế mang tính thử nghiệm, chưa được chứng minh vượt trội so với các phương pháp điều phối dựa trên đồ thị khác.',
  'Tham số (tốc độ tự do, lưu lượng bão hoà, mật độ kẹt, hệ số rủi ro) là giá trị điển hình, chưa hiệu chỉnh với dữ liệu thực.',
  'Kết quả chỉ là bằng chứng mô phỏng cho hỗ trợ quyết định; không dùng để điều khiển đèn tín hiệu thực.',
];

export const LIMITATIONS_EN = [
  'Macroscopic CTM model (continuous flow) on 3 intersections, not a per-vehicle microsimulation; the vehicles shown are schematic.',
  'Traffic demand is a synthetic seeded Poisson series, not measured data from Hanoi.',
  'Intersection blocking, dedicated turn lanes, mixed motorbike traffic and pedestrians are not modelled.',
  'Stigmergy-style risk propagation is an experimental design hypothesis, not proven superior to other graph-based coordination methods.',
  'Parameters (free-flow speed, saturation flow, jam density, risk coefficients) are typical values, not calibrated against real data.',
  'Results are simulation evidence for decision support only; they must not be used to control real traffic signals.',
];

export interface ComparisonRow {
  key: keyof MetricsSummary;
  label: string;
  labelEn: string;
  unit: string;
  unitEn: string;
  better: 'lower' | 'higher';
  baseline: number | null;
  proposed: number | null;
  changePct: number | null;
  improved: boolean | null;
}

const ROWS: Array<Pick<ComparisonRow, 'key' | 'label' | 'labelEn' | 'unit' | 'unitEn' | 'better'>> = [
  { key: 'totalDischarged', label: 'Tổng số xe thông qua', labelEn: 'Vehicles served', unit: 'xe', unitEn: 'veh', better: 'higher' },
  { key: 'cumulativeWaitingVehS', label: 'Tổng thời gian chờ', labelEn: 'Total waiting time', unit: 'xe·giờ', unitEn: 'veh·h', better: 'lower' },
  { key: 'avgQueue', label: 'Hàng chờ trung bình', labelEn: 'Average queue', unit: 'xe', unitEn: 'veh', better: 'lower' },
  { key: 'maxLinkOccupancy', label: 'Độ chiếm dụng đoạn đường lớn nhất', labelEn: 'Peak link occupancy', unit: '%', unitEn: '%', better: 'lower' },
  { key: 'spillbackDurationS', label: 'Thời gian tràn ngược (spillback)', labelEn: 'Spillback duration', unit: 's', unitEn: 's', better: 'lower' },
  { key: 'finalEntryQueue', label: 'Xe còn chờ ở cửa vào (cuối mô phỏng)', labelEn: 'Vehicles still waiting at entry (end)', unit: 'xe', unitEn: 'veh', better: 'lower' },
  { key: 'sideStreetWaitingVehS', label: 'Thời gian chờ đường ngang', labelEn: 'Side-street waiting time', unit: 'xe·giờ', unitEn: 'veh·h', better: 'lower' },
];

export function displayValue(key: keyof MetricsSummary, v: number | null): string {
  if (v === null || v === undefined) return '—';
  if (key === 'cumulativeWaitingVehS' || key === 'sideStreetWaitingVehS') return (v / 3600).toFixed(1);
  if (key === 'maxLinkOccupancy') return `${Math.round(v * 100)}`;
  if (key === 'avgQueue') return v.toFixed(1);
  if (key === 'avgDecisionTimeMs') return v.toFixed(3);
  return Math.round(v).toString();
}

export function computeComparison(baseline: SimulationRun, proposed: SimulationRun): ComparisonRow[] {
  return ROWS.map((r) => {
    const b = baseline.metrics[r.key] as number | null;
    const p = proposed.metrics[r.key] as number | null;
    let changePct: number | null = null;
    let improved: boolean | null = null;
    if (b !== null && p !== null) {
      if (Math.abs(b) > 1e-9) changePct = ((p - b) / b) * 100;
      else if (Math.abs(p) < 1e-9) changePct = 0;
      improved = Math.abs(p - b) < 1e-6 * Math.max(1, Math.abs(b)) ? null : r.better === 'lower' ? p < b : p > b;
    }
    return { ...r, baseline: b, proposed: p, changePct, improved };
  });
}

export const CONTROLLER_NAME: Record<ControllerKind, string> = {
  fixed: 'Fixed-Time',
  maxpressure: 'Max-Pressure',
  waveguard: 'WaveGuard',
};

function summariseDecisions(decisions: DecisionTrace[]) {
  const counts: Record<string, Record<string, number>> = {};
  for (const d of decisions) {
    counts[d.node] ??= {};
    counts[d.node][d.selected] = (counts[d.node][d.selected] ?? 0) + 1;
  }
  return counts;
}

/**
 * Compact, grounded evidence package sent to Gemini for explanation. Every
 * number here comes straight from the simulation runs.
 */
export function buildEvidence(runs: Partial<Record<ControllerKind, SimulationRun>>, incidentText: string, confirmed: unknown) {
  const wg = runs.waveguard;
  const fx = runs.fixed;
  const metricsOf = (r?: SimulationRun) =>
    r
      ? Object.fromEntries(ROWS.map((row) => [row.key, Number(displayValue(row.key, r.metrics[row.key] as number))]))
      : undefined;
  const keyDecisions = wg
    ? wg.decisions
        .filter((d) => d.selected === 'METER' || d.selected === 'FALLBACK')
        .filter((d, i, arr) => i === 0 || arr[i - 1].node !== d.node || d.t - arr[i - 1].t > 60)
        .slice(0, 12)
        .map((d) => ({ t: d.t, node: d.node, action: d.selected, reason: d.reason, constraints: d.constraints }))
    : [];
  const peakForecast = wg
    ? wg.frames.reduce<{ t: number; link: string; risk: number; ttc: number | null; shock: number | null } | null>((best, f) => {
        for (const fc of f.forecasts) {
          if (!best || fc.risk > best.risk) best = { t: f.t, link: `${fc.linkId} (quan sát bởi ${fc.observer})`, risk: fc.risk, ttc: fc.timeToCapacity, shock: fc.shockSpeed };
        }
        return best;
      }, null)
    : null;
  return {
    disclaimer: DISCLAIMER,
    terminology: { TTC: 'Time-to-Capacity: estimated seconds until a road link reaches storage capacity. Never Time-to-Collision. No collision detection exists.', shockSpeed: 'Queue boundary speed in metres per second; negative means upstream propagation.', risk: 'Dimensionless model score, not an accident probability.' },
    incidentDescription: incidentText,
    verifiedIncident: confirmed,
    scenario: wg?.scenario ?? fx?.scenario,
    simulation: {
      durationS: (wg ?? fx)?.scenario.durationS,
      timestepS: (wg ?? fx)?.config.network.dt,
      seed: (wg ?? fx)?.scenario.seed,
      demandChecksum: (wg ?? fx)?.demandChecksum,
    },
    simulatedObservations: (wg ?? fx)?.events.filter((e) => ['incident', 'incident_end', 'occupancy', 'spillback', 'sensor', 'sensor_end'].includes(e.kind)).slice(0, 15),
    modelPredictions: { peakForecast, firstWarnings: wg?.events.filter((e) => e.kind === 'warning').slice(0, 5) },
    riskMessages: wg ? { total: wg.messages.length, sample: wg.messages.slice(0, 6).map((m) => ({ t: m.timestamp, from: m.source, to: m.target, link: m.linkId, risk: +m.risk.toFixed(2), confidence: m.confidence, path: m.path })) } : null,
    controllerActions: { counts: wg ? summariseDecisions(wg.decisions) : null, keyDecisions },
    measuredSimulatedOutcomes: {
      units: { cumulativeWaitingVehS: 'xe·giờ', sideStreetWaitingVehS: 'xe·giờ', maxLinkOccupancy: '%', spillbackDurationS: 's' },
      fixedTime: metricsOf(fx),
      maxPressure: metricsOf(runs.maxpressure),
      waveGuard: metricsOf(wg),
      comparison: fx && wg ? computeComparison(fx, wg).map((r) => ({ metric: r.label, fixedTime: displayValue(r.key, r.baseline), waveGuard: displayValue(r.key, r.proposed), changePct: r.changePct === null ? null : +r.changePct.toFixed(1), improved: r.improved })) : null,
    },
    limitations: LIMITATIONS,
  };
}

// ---------- exports ----------

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function seriesCsv(runs: Partial<Record<ControllerKind, SimulationRun>>): string {
  const lines = ['controller,t_s,queue_veh,cum_waiting_veh_s,discharged_veh,max_occupancy,entry_queue_veh,active_warnings,occ_B_C,occ_A_B'];
  for (const [k, r] of Object.entries(runs)) {
    if (!r) continue;
    for (const p of r.series) lines.push([k, p.t, p.queue.toFixed(3), p.cumWaiting.toFixed(1), p.discharged.toFixed(2), p.maxOccupancy.toFixed(4), p.entryQueue.toFixed(2), p.warnings, p.occBC.toFixed(4), p.occAB.toFixed(4)].join(','));
  }
  return lines.join('\n');
}

export function decisionsCsv(run: SimulationRun): string {
  const lines = ['t_s,node,controller,phase,stage,green_elapsed,main_queue,side_queue,down_occupancy,local_risk,pheromone,confidence,received_msgs,selected,request,reason,constraints,decision_ms'];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  for (const d of run.decisions) {
    lines.push([d.t, d.node, d.controller, d.state.phase, d.state.stage, d.state.greenElapsed, d.state.mainQueue?.toFixed(2) ?? '', d.state.sideQueue?.toFixed(2) ?? '', d.state.downstreamOccupancy?.toFixed(3) ?? '', d.state.localRisk.toFixed(3), d.state.pheromone.toFixed(3), d.state.confidence, d.receivedMessages.length, d.selected, d.request, q(d.reason), q(d.constraints.join(' | ')), d.decisionTimeMs.toFixed(4)].join(','));
  }
  return lines.join('\n');
}

export function benchmarkJson(runs: Partial<Record<ControllerKind, SimulationRun>>, extra: Record<string, unknown> = {}) {
  const any = Object.values(runs).find(Boolean)!;
  return {
    generator: 'WaveGuard AI simulation engine',
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
    scenario: any.scenario,
    config: any.config,
    demandChecksum: any.demandChecksum,
    ...extra,
    controllers: Object.fromEntries(
      Object.entries(runs).map(([k, r]) => [k, r && { metrics: r.metrics, events: r.events, decisions: r.decisions, messages: r.messages, series: r.series }]),
    ),
    limitations: LIMITATIONS,
  };
}

export function reportHtml(args: {
  lang?: 'vi' | 'en';
  runs: Partial<Record<ControllerKind, SimulationRun>>;
  incidentText: string;
  confirmedSummary: string;
  assumptions: string[];
  geminiExplanation: string | null;
  geminiModel: string | null;
}): string {
  const { runs } = args;
  const fx = runs.fixed!;
  const wg = runs.waveguard!;
  const cmp = computeComparison(fx, wg);
  const sc = wg.scenario;
  const counts = summariseDecisions(wg.decisions);
  const metaRows = (['fixed', 'maxpressure', 'waveguard'] as ControllerKind[])
    .filter((k) => runs[k])
    .map((k) => `<th>${CONTROLLER_NAME[k]}</th>`)
    .join('');
  const allRows = cmp
    .map((r) => {
      const cells = (['fixed', 'maxpressure', 'waveguard'] as ControllerKind[])
        .filter((k) => runs[k])
        .map((k) => `<td>${displayValue(r.key, runs[k]!.metrics[r.key] as number)}</td>`)
        .join('');
      const ch = r.changePct === null ? '—' : `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(1)}%`;
      const cls = r.improved === null ? '' : r.improved ? 'good' : 'bad';
      return `<tr><td>${esc(r.label)} (${r.unit})</td>${cells}<td class="${cls}">${ch}</td></tr>`;
    })
    .join('');
  const events = wg.events.map((e) => `<li><b>t=${e.t}s</b> — ${esc(e.text)}</li>`).join('');
  const decisions = wg.decisions
    .filter((d) => d.selected !== 'MAINTAIN')
    .filter((d, i, arr) => i === 0 || arr[i - 1].selected !== d.selected || arr[i - 1].node !== d.node)
    .slice(0, 25)
    .map((d) => `<tr><td>${d.t}</td><td>${d.node}</td><td>${d.selected}</td><td>${esc(d.reason)}</td></tr>`)
    .join('');
  const inc = sc.incidents.map((i) => `${i.type} trên ${i.linkId} (vị trí ${Math.round(i.positionFrac * 100)}%), giảm ${Math.round(i.capacityReduction * 100)}% năng lực, t=${i.startS}–${i.startS + i.durationS}s${i.demandIncrease ? `, nhu cầu +${Math.round(i.demandIncrease * 100)}%` : ''}`).join('; ') || 'Không';
  const faults = sc.sensorFaults.map((f) => `Nút ${f.node}: ${f.mode}, t=${f.startS}–${f.startS + f.durationS}s`).join('; ') || 'Không';
  const c = wg.config;
  if (args.lang === 'en') {
    const metrics = cmp.map((r) => `<tr><th>${esc(r.labelEn)} (${r.unitEn})</th>${(['fixed', 'maxpressure', 'waveguard'] as ControllerKind[]).filter((k) => runs[k]).map((k) => `<td>${displayValue(r.key, runs[k]!.metrics[r.key] as number)}</td>`).join('')}<td>${r.changePct === null ? '—' : `${r.changePct.toFixed(1)}%`}</td></tr>`).join('');
    const timeline = wg.events.map((e) => `<li><b>${e.t}s</b> — ${esc(engineText(e.text, 'en'))}</li>`).join('');
    const traces = wg.decisions.filter((d) => d.selected !== 'MAINTAIN').slice(0, 25).map((d) => `<tr><td>${d.t}</td><td>${d.node}</td><td>${d.selected}</td><td>${esc(engineText(d.reason, 'en'))}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WaveGuard AI — Session report</title><style>
body{font:15px/1.6 system-ui,sans-serif;color:#14212a;max-width:1000px;margin:40px auto;padding:0 20px}h1{letter-spacing:-.04em}h2{border-top:1px solid #bdcbd1;padding-top:20px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:8px;border:1px solid #cbd5e1;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;padding:16px}.notice{border-left:3px solid #0891b2;padding:12px} @media print{button{display:none}thead{display:table-header-group}}</style></head><body>
<h1>WaveGuard AI / Session report</h1><p>Generated ${new Date().toISOString()} · seed ${sc.seed} · demand checksum ${wg.demandChecksum}</p><p class="notice">${DISCLAIMER_EN}</p>
<h2>1. Incident and confirmed assumptions</h2><p>${esc(args.incidentText)}</p><p>${esc(args.confirmedSummary)}</p><ul>${args.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
<h2>2. Measured simulation outcomes</h2><p>Every controller uses identical arrivals, incidents, initial conditions, seed and duration. Percent change is WaveGuard relative to Fixed-Time; negative values are not automatically better.</p><table><thead><tr><th>Measurement</th>${metaRows}<th>Change</th></tr></thead><tbody>${metrics}</tbody></table>
<p>Measured mean WaveGuard decision time: ${wg.metrics.avgDecisionTimeMs?.toFixed(3) ?? '—'} ms. This timing varies with the host computer.</p>
<h2>3. Engine event timeline</h2><ul>${timeline}</ul><h2>4. Decision evidence (first 25 non-maintain records)</h2><table><tr><th>Time (s)</th><th>Node</th><th>Action</th><th>Reason</th></tr>${traces}</table>
<h2>5. Reproducibility / exact configuration</h2><pre>${esc(JSON.stringify({ scenario: { ...sc, name: engineText(sc.name, 'en'), description: engineText(sc.description, 'en'), incidents: sc.incidents.map((i) => ({ ...i, description: engineText(i.description, 'en') })) }, config: c, demandChecksum: wg.demandChecksum }, null, 2))}</pre>
<h2>6. Gemini explanation</h2>${args.geminiExplanation ? `<p>Model: ${esc(args.geminiModel ?? '')}</p><pre>${esc(args.geminiExplanation)}</pre>` : '<p>No Gemini explanation generated for this session.</p>'}
<h2>7. Limitations</h2><ul>${LIMITATIONS_EN.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><button onclick="window.print()">Print / Save PDF</button></body></html>`;
  }
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo WaveGuard AI</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#0b1530;line-height:1.5}
h1{margin-bottom:0}h2{border-bottom:2px solid #06b6d4;padding-bottom:4px;margin-top:28px}.muted{color:#556}.warn{background:#fff7e6;border-left:4px solid #f97316;padding:10px 14px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #ccd;padding:6px 8px;text-align:left}th{background:#eef6fb}.good{color:#047857;font-weight:600}.bad{color:#b91c1c;font-weight:600}
.ai{background:#f5f0ff;border-left:4px solid #8b5cf6;padding:10px 14px;white-space:pre-wrap}@media print{.noprint{display:none}}</style></head><body>
<h1>WaveGuard AI — Báo cáo phân tích sự cố</h1><p class="muted">The City That Thinks Ahead · Tạo lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
<p class="warn"><b>${DISCLAIMER}</b></p>
<h2>1. Tóm tắt sự cố</h2><p><b>Mô tả của điều hành viên:</b> ${esc(args.incidentText || '(kịch bản mẫu)')}</p><p><b>Tham số đã xác nhận:</b> ${esc(args.confirmedSummary)}</p>
${args.assumptions.length ? `<p><b>Giả định thử nghiệm:</b> ${args.assumptions.map(esc).join('; ')}</p>` : ''}
<h2>2. Cấu hình mạng và kịch bản</h2><ul><li>Hành lang 3 nút giao A → B → C, trục chính 2 làn, đường ngang 1 làn; mô hình CTM, bước thời gian ${c.network.dt}s.</li>
<li>Tốc độ tự do ${(c.network.freeFlowSpeed * 3.6).toFixed(0)} km/h, lưu lượng bão hoà ${c.network.satFlowPerLane * 3600} xe/h/làn, mật độ kẹt ${(1 / c.network.jamDensityPerLane).toFixed(0)} m/xe.</li>
<li>Kịch bản: ${esc(sc.name)} — thời lượng ${sc.durationS}s, seed ${sc.seed}, mã kiểm tra nhu cầu ${wg.demandChecksum}.</li><li>Sự cố: ${esc(inc)}</li><li>Lỗi cảm biến: ${esc(faults)}</li></ul>
<h2>3. Cấu hình bộ điều khiển</h2><ul><li>Fixed-Time: xanh chính ${c.fixedPlan.mainGreen}s, xanh ngang ${c.fixedPlan.sideGreen}s, vàng ${c.timing.yellow}s, đỏ toàn phần ${c.timing.allRed}s, offset A/B/C = ${c.fixedPlan.offsets.A}/${c.fixedPlan.offsets.B}/${c.fixedPlan.offsets.C}s.</li>
<li>WaveGuard: cửa sổ dự báo ${c.waveguard.horizonS}s, bay hơi ρ=${c.waveguard.evaporation}/s, hệ số lắng η=${c.waveguard.depositGain}, suy giảm chuyển tiếp γ=${c.waveguard.relayAttenuation}, ngưỡng phát θ=${c.waveguard.emitThreshold}, TTL ${c.waveguard.messageTtlS}s, chiết khấu rủi ro κ=${c.waveguard.riskDiscount}.</li>
<li>Ràng buộc an toàn: xanh tối thiểu ${c.timing.minGreenMain}/${c.timing.minGreenSide}s, xanh tối đa ${c.timing.maxGreenMain}/${c.timing.maxGreenSide}s, đường ngang chờ tối đa ${c.timing.maxSideRed}s.</li></ul>
<h2>4. Diễn biến và dự báo ùn tắc (WaveGuard)</h2><ul>${events}</ul>
<h2>5. Hành động điều khiển đã chọn</h2><p>Số lần ghi nhận theo nút: ${Object.entries(counts).map(([n, m]) => `${n}: ${Object.entries(m).map(([a, v]) => `${a}×${v}`).join(', ')}`).join(' · ')}</p>
<table><tr><th>t (s)</th><th>Nút</th><th>Hành động</th><th>Lý do</th></tr>${decisions}</table>
<h2>6. So sánh kết quả mô phỏng</h2><table><tr><th>Chỉ số</th>${metaRows}<th>WaveGuard so với Fixed-Time</th></tr>${allRows}</table>
<p class="muted">Tất cả bộ điều khiển dùng cùng chuỗi xe đến, cùng sự cố, cùng điều kiện ban đầu, cùng seed và thời lượng. Thời gian quyết định trung bình WaveGuard: ${wg.metrics.avgDecisionTimeMs?.toFixed(3) ?? '—'} ms/quyết định.</p>
${args.geminiExplanation ? `<h2>7. Giải thích bởi Gemini${args.geminiModel ? ` (${esc(args.geminiModel)})` : ''}</h2><div class="ai">${esc(args.geminiExplanation)}</div>` : `<h2>7. Giải thích</h2><p class="muted">Chưa tạo giải thích Gemini cho lần chạy này.</p>`}
<h2>8. Hạn chế của mô hình</h2><ul>${LIMITATIONS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p class="warn"><b>${DISCLAIMER}</b></p><button class="noprint" onclick="window.print()">In / Lưu PDF</button></body></html>`;
}
