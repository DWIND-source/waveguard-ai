import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import type { ControllerKind, EngineConfig, NodeId, ScenarioConfig, SimulationRun } from '../engine/types';
import { compareControllers } from '../engine/simulator';
import { CONTROLLER_NAME, DISCLAIMER, DISCLAIMER_EN } from '../engine/report';
import { usePrefs, useT } from '../lib/i18n';
import { engineText } from '../lib/engineText';
import { download } from '../lib/api';

interface Props {
  config: EngineConfig;
  onConfig: (c: EngineConfig) => void;
  seed: number;
  onSeed: (s: number) => void;
  includeMP: boolean;
  onIncludeMP: (b: boolean) => void;
  onRerun: () => void;
  scenario: ScenarioConfig | null;
  runs: Partial<Record<ControllerKind, SimulationRun>> | null;
  time: number;
}

interface BenchRow {
  kind: ControllerKind;
  wait: number[];
  disch: number[];
  queue: number[];
  spill: number[];
  maxOcc: number[];
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
};

function Num({ label, value, onChange, step = 1, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <label className="text-xs text-slate-300 flex flex-col gap-1">
      <span>
        {label} {hint && <span className="text-slate-500">({hint})</span>}
      </span>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))); }} className="rounded-md bg-navy-950 border border-navy-600 px-2 py-1 text-sm" />
    </label>
  );
}

export function ResearchMode(p: Props) {
  const { config } = p;
  const { lang } = usePrefs();
  const t = useT();
  const [nSeeds, setNSeeds] = useState(10);
  const [bench, setBench] = useState<BenchRow[] | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    ++generation.current;
    setBench(null);
    setBenchBusy(false);
    return () => { ++generation.current; };
  }, [p.scenario, config]);
  const [logNode, setLogNode] = useState<NodeId | 'all'>('all');
  const wg = (k: keyof EngineConfig['waveguard'], v: number) => p.onConfig({ ...config, waveguard: { ...config.waveguard, [k]: v } });
  const tm = (k: keyof EngineConfig['timing'], v: number) => {
    const timing = { ...config.timing, [k]: v };
    if (k === 'minGreenMain') timing.minGreenMain = Math.min(v, timing.maxGreenMain);
    if (k === 'maxGreenMain') timing.maxGreenMain = Math.max(v, timing.minGreenMain);
    p.onConfig({ ...config, timing, fixedPlan: { ...config.fixedPlan, mainGreen: Math.max(timing.minGreenMain, Math.min(timing.maxGreenMain, config.fixedPlan.mainGreen)) } });
  };
  const fp = (k: 'mainGreen' | 'sideGreen', v: number) => p.onConfig({ ...config, fixedPlan: { ...config.fixedPlan, [k]: v } });

  const runBench = () => {
    if (!p.scenario) return;
    setBenchBusy(true);
    const currentGeneration = ++generation.current;
    const kinds: ControllerKind[] = ['fixed', 'maxpressure', 'waveguard'];
    const rows: Record<string, BenchRow> = Object.fromEntries(kinds.map((k) => [k, { kind: k, wait: [], disch: [], queue: [], spill: [], maxOcc: [] }]));
    let i = 0;
    const step = () => {
      if (currentGeneration !== generation.current) return;
      const seed = p.scenario!.seed + i;
      const runs = compareControllers({ ...p.scenario!, seed }, kinds, config, { recordFrames: false });
      for (const k of kinds) {
        const m = runs[k].metrics;
        rows[k].wait.push(m.cumulativeWaitingVehS / 3600);
        rows[k].disch.push(m.totalDischarged);
        rows[k].queue.push(m.avgQueue);
        rows[k].spill.push(m.spillbackDurationS);
        rows[k].maxOcc.push(m.maxLinkOccupancy * 100);
      }
      i++;
      if (i < nSeeds) setTimeout(step, 0);
      else {
        setBench(kinds.map((k) => rows[k]));
        setBenchBusy(false);
      }
    };
    setTimeout(step, 20);
  };

  const exportBench = () => {
    if (!bench || !p.scenario) return;
    const lines = ['controller,seed,cum_waiting_veh_h,discharged_veh,avg_queue_veh,spillback_s,max_occupancy_pct'];
    for (const r of bench) r.wait.forEach((_, j) => lines.push([r.kind, p.scenario!.seed + j, r.wait[j].toFixed(3), r.disch[j].toFixed(1), r.queue[j].toFixed(2), r.spill[j], r.maxOcc[j].toFixed(1)].join(',')));
    download('waveguard-benchmark.csv', lines.join('\n'), 'text/csv;charset=utf-8');
    download('waveguard-benchmark.json', JSON.stringify({ disclaimer: DISCLAIMER, scenario: p.scenario, config, seeds: bench[0].wait.map((_, j) => p.scenario!.seed + j), results: bench }, null, 2), 'application/json');
  };

  const logs = useMemo(() => {
    const run = p.runs?.waveguard;
    if (!run || !open) return [];
    return run.decisions.filter((d) => d.t <= p.time && (logNode === 'all' || d.node === logNode)).slice(-150).reverse();
  }, [p.runs, p.time, logNode, open]);

  return (
    <details className="panel p-5 group" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer list-none flex items-center gap-2 font-semibold text-lg">
        <FlaskConical size={18} className="text-wg-purple" /> {t('Chế độ nghiên cứu', 'Research Mode')}
        <span className="text-xs font-normal text-slate-400 ml-2">{t('giả định mô hình · tham số · seed · benchmark nhiều seed · nhật ký quyết định', 'model assumptions · parameters · seed · multi-seed benchmark · decision log')}</span>
      </summary>

      <div className="mt-5 grid lg:grid-cols-2 gap-6 text-sm">
        <div>
          <h3 className="font-semibold text-cyan-100">{t('Giả định mô hình CTM', 'CTM model assumptions')}</h3>
          <ul className="mt-2 space-y-1 text-slate-300 text-xs leading-relaxed">
            <li>• {t('Ô dài', 'Cell length')} v_f·Δt = {(config.network.freeFlowSpeed * config.network.dt).toFixed(1)} m; Δt = {config.network.dt}s; v_f = {(config.network.freeFlowSpeed * 3.6).toFixed(0)} km/h; q_max = {config.network.satFlowPerLane * 3600} {t('xe/h/làn', 'veh/h/lane')}; k_j = 1/{(1 / config.network.jamDensityPerLane).toFixed(0)} {t('xe/m/làn', 'veh/m/lane')}.</li>
            <li>• {t('Sơ đồ cơ bản tam giác', 'Triangular fundamental diagram')}: w = q_max / (k_j − k_c) ≈ {(config.network.satFlowPerLane / (config.network.jamDensityPerLane - config.network.satFlowPerLane / config.network.freeFlowSpeed)).toFixed(2)} m/s.</li>
            <li>• S_i = min(n_i, Q_i); R_i = min(Q_i, (w/v_f)(N_i − n_i)); y = min(S_i, R_i+1); n(t+1) = n(t) + {t('vào − ra', 'in − out')}.</li>
            <li>• {t(`Nút giao: chỉ pha xanh (vàng ${Math.round(config.network.yellowDischarge * 100)}%) được xả; tách dòng FIFO, ${Math.round(config.network.turnOffFraction * 100)}% xe trục chính rẽ ra đường ngang.`, `Intersections: only the green phase discharges (amber ${Math.round(config.network.yellowDischarge * 100)}%); FIFO diverge, ${Math.round(config.network.turnOffFraction * 100)}% of main-road vehicles turn off to the side street.`)}</li>
            <li>• {t('Xe đến: Poisson theo seed, sinh trước cho toàn bộ thời lượng, dùng chung cho mọi bộ điều khiển.', 'Arrivals: seeded Poisson, pre-generated for the whole run and shared by all controllers.')}</li>
            <li>• {t('Dự báo: TTC = dung lượng còn lại / (EMA vào − EMA ra) khi dương; sóng xung kích LWR', 'Forecast: TTC = remaining storage / (EMA in − EMA out) when positive; LWR shockwave')} u = (q_d − q_u)/(k_d − k_u).</li>
            <li>• Stigmergy: τ ← τ(1 − ρΔt); τ ← τ + η·c·r·(τ_max − τ); {t('chuyển tiếp ngược dòng với γ; hết hạn sau TTL.', 'relayed upstream with γ; expires after TTL.')}</li>
            <li>• Max-Pressure: P = Σ s_m (x_in − r·x_out); {t('chuyển pha khi P(pha khác) > P(hiện tại) + 0.5.', 'switch when P(other) > P(current) + 0.5.')}</li>
          </ul>

          <h3 className="font-semibold text-cyan-100 mt-5">{t('Kịch bản & seed', 'Scenario & seed')}</h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Num label="Seed" value={p.seed} onChange={(v) => p.onSeed(Math.max(0, Math.floor(v)))} />
            <label className="text-xs text-slate-300 flex items-center gap-2 mt-5">
              <input type="checkbox" checked={p.includeMP} onChange={(e) => p.onIncludeMP(e.target.checked)} className="accent-amber-400" />
              {t('So sánh thêm Max-Pressure', 'Also compare Max-Pressure')}
            </label>
          </div>
          {p.scenario && (
            <p className="mt-2 text-xs text-slate-400">
              {t('Kịch bản hiện tại', 'Current scenario')}: {engineText(p.scenario.name, lang)} · {p.scenario.durationS}s · {t('nhu cầu chính', 'main demand')} {(p.scenario.demand.main * 3600).toFixed(0)} {t('xe/h', 'veh/h')} · {t('đường ngang', 'side streets')} A/B/C {(['A', 'B', 'C'] as const).map((n) => (p.scenario!.demand.side[n] * 3600).toFixed(0)).join('/')} {t('xe/h', 'veh/h')}.
            </p>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-cyan-100">{t('Tham số lan truyền rủi ro (WaveGuard)', 'Risk propagation parameters (WaveGuard)')}</h3>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Num label={t('Cửa sổ dự báo H', 'Forecast horizon H')} hint="s" value={config.waveguard.horizonS} onChange={(v) => wg('horizonS', v)} step={10} min={30} />
            <Num label={t('Bay hơi ρ', 'Evaporation ρ')} hint="1/s" value={config.waveguard.evaporation} onChange={(v) => wg('evaporation', v)} step={0.01} min={0} max={1} />
            <Num label={t('Lắng đọng η', 'Deposit η')} value={config.waveguard.depositGain} onChange={(v) => wg('depositGain', v)} step={0.05} min={0} max={1} />
            <Num label={t('Suy giảm chuyển tiếp γ', 'Relay attenuation γ')} value={config.waveguard.relayAttenuation} onChange={(v) => wg('relayAttenuation', v)} step={0.05} min={0} max={1} />
            <Num label={t('Ngưỡng phát θ', 'Emit threshold θ')} value={config.waveguard.emitThreshold} onChange={(v) => wg('emitThreshold', v)} step={0.05} min={0} max={1} />
            <Num label={t('TTL thông điệp', 'Message TTL')} hint="s" value={config.waveguard.messageTtlS} onChange={(v) => wg('messageTtlS', v)} step={5} min={5} />
            <Num label={t('Chiết khấu rủi ro κ', 'Risk discount κ')} value={config.waveguard.riskDiscount} onChange={(v) => wg('riskDiscount', v)} step={0.05} min={0} max={1} />
            <Num label={t('Trọng số công bằng λ', 'Fairness weight λ')} value={config.waveguard.fairnessWeight} onChange={(v) => wg('fairnessWeight', v)} step={0.1} min={0} />
            <Num label={t('Ngưỡng tin cậy', 'Confidence threshold')} value={config.waveguard.fallbackConfidence} onChange={(v) => wg('fallbackConfidence', v)} step={0.05} min={0} max={1} />
          </div>
          <h3 className="font-semibold text-cyan-100 mt-5">{t('Bộ điều khiển & ràng buộc an toàn', 'Controllers & safety constraints')}</h3>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Num label={t('Fixed: xanh chính', 'Fixed: main green')} hint="s" value={config.fixedPlan.mainGreen} onChange={(v) => fp('mainGreen', v)} min={config.timing.minGreenMain} max={config.timing.maxGreenMain} />
            <Num label={t('Fixed: xanh ngang', 'Fixed: side green')} hint="s" value={config.fixedPlan.sideGreen} onChange={(v) => fp('sideGreen', v)} min={config.timing.minGreenSide} max={config.timing.maxGreenSide} />
            <Num label={t('Xanh tối thiểu chính', 'Min main green')} hint="s" value={config.timing.minGreenMain} onChange={(v) => tm('minGreenMain', v)} min={5} />
            <Num label={t('Xanh tối đa chính', 'Max main green')} hint="s" value={config.timing.maxGreenMain} onChange={(v) => tm('maxGreenMain', v)} min={20} />
            <Num label={t('Đường ngang chờ tối đa', 'Max side-street wait')} hint="s" value={config.timing.maxSideRed} onChange={(v) => tm('maxSideRed', v)} min={30} />
            <Num label={t('Đỏ toàn phần', 'All-red')} hint="s" value={config.timing.allRed} onChange={(v) => tm('allRed', v)} min={1} max={5} />
          </div>
          <button onClick={p.onRerun} disabled={!p.scenario} className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40">
            <RefreshCw size={15} /> {t('Áp dụng & chạy lại mô phỏng', 'Apply & re-run simulation')}
          </button>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-cyan-100">{t('Benchmark nhiều seed', 'Multi-seed benchmark')} (Fixed-Time vs Max-Pressure vs WaveGuard)</h3>
          <Num label={t('Số seed', 'Seeds')} value={nSeeds} onChange={(v) => setNSeeds(Math.max(2, Math.min(50, Math.floor(v))))} min={2} max={50} />
          <button onClick={runBench} disabled={benchBusy || !p.scenario} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-violet-500/20 border border-violet-400/40 hover:bg-violet-500/30 disabled:opacity-40 self-end">
            {benchBusy && <Loader2 size={15} className="animate-spin" />} {t('Chạy benchmark', 'Run benchmark')}
          </button>
          {bench && (
            <button onClick={exportBench} className="rounded-lg px-4 py-2 border border-white/15 hover:bg-white/5 self-end">
              {t('Xuất dữ liệu benchmark (CSV + JSON)', 'Export benchmark data (CSV + JSON)')}
            </button>
          )}
        </div>
        {bench && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-white/10">
                  <th className="py-1.5">{t('Bộ điều khiển', 'Controller')}</th>
                  <th className="text-right">{t('Tổng chờ (xe·h)', 'Total wait (veh·h)')}</th>
                  <th className="text-right">{t('Xe thông qua', 'Vehicles served')}</th>
                  <th className="text-right">{t('Hàng chờ TB', 'Avg queue')}</th>
                  <th className="text-right">Spillback (s)</th>
                  <th className="text-right">{t('Chiếm dụng max (%)', 'Max occupancy (%)')}</th>
                </tr>
              </thead>
              <tbody>
                {bench.map((r) => (
                  <tr key={r.kind} className="border-b border-white/5">
                    <td className="py-1.5">{CONTROLLER_NAME[r.kind]}</td>
                    {[r.wait, r.disch, r.queue, r.spill, r.maxOcc].map((a, j) => (
                      <td key={j} className="text-right tabular-nums">
                        {mean(a).toFixed(1)} <span className="text-slate-500">± {sd(a).toFixed(1)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-2">
              {t(`Trung bình ± độ lệch chuẩn trên ${bench[0].wait.length} seed liên tiếp từ seed ${p.scenario?.seed}, cùng sự cố và cấu hình.`, `Mean ± standard deviation over ${bench[0].wait.length} consecutive seeds from seed ${p.scenario?.seed}, same incident and configuration.`)} {lang === 'en' ? DISCLAIMER_EN : DISCLAIMER}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-cyan-100">{t(`Nhật ký quyết định của thuật toán (đến t=${Math.floor(p.time)}s)`, `Algorithm decision log (up to t=${Math.floor(p.time)}s)`)}</h3>
          <select value={logNode} onChange={(e) => setLogNode(e.target.value as NodeId | 'all')} className="rounded-md bg-navy-950 border border-navy-600 px-2 py-1 text-sm">
            <option value="all">{t('Tất cả nút', 'All nodes')}</option>
            <option value="A">{t('Nút', 'Node')} A</option>
            <option value="B">{t('Nút', 'Node')} B</option>
            <option value="C">{t('Nút', 'Node')} C</option>
          </select>
        </div>
        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-white/5">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-navy-900">
              <tr className="text-left text-slate-400">
                <th className="p-1.5">t</th>
                <th>{t('Nút', 'Node')}</th>
                <th>{t('Pha', 'Phase')}</th>
                <th>{t('Hành động', 'Action')}</th>
                <th className="text-right">{t('ρ cục bộ', 'local ρ')}</th>
                <th className="text-right">τ</th>
                <th className="text-right">{t('Tin cậy', 'Confidence')}</th>
                <th className="pl-2">{t('Lý do', 'Reason')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((d, i) => (
                <tr key={i} className="border-t border-white/5 align-top">
                  <td className="p-1.5 tabular-nums">{d.t}</td>
                  <td>{d.node}</td>
                  <td>{d.state.phase === 'MAIN' ? t('chính', 'main') : t('ngang', 'side')} {d.state.greenElapsed}s</td>
                  <td className={d.selected === 'METER' ? 'text-cyan-300' : d.selected === 'FALLBACK' ? 'text-slate-400' : ''}>{d.selected}</td>
                  <td className="text-right tabular-nums">{d.state.localRisk.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{d.state.pheromone.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{Math.round(d.state.confidence * 100)}%</td>
                  <td className="pl-2 text-slate-300">{engineText(d.reason, lang)}</td>
                </tr>
              ))}
              {!logs.length && (
                <tr>
                  <td colSpan={8} className="p-3 text-slate-500">
                    {t('Chưa có dữ liệu — hãy chạy một mô phỏng.', 'No data yet — run a simulation.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
