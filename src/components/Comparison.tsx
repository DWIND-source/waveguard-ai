import { useMemo } from 'react';
import { seriesAt } from '../lib/sessionSeries';
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ControllerKind, Frame, SimulationRun } from '../engine/types';
import { computeComparison, CONTROLLER_NAME, DISCLAIMER, DISCLAIMER_EN, displayValue } from '../engine/report';
import { usePrefs, useT } from '../lib/i18n';
import { DigitalTwin } from './DigitalTwin';

interface Props {
  runs: Partial<Record<ControllerKind, SimulationRun>>;
  frameIndex: number;
  progress: number;
  time: number;
  finished: boolean;
}

const COLORS: Record<ControllerKind, string> = { fixed: '#94a3b8', maxpressure: '#fbbf24', waveguard: '#22d3ee' };



function LiveStats({ run, frame, t: time }: { run: SimulationRun; frame: Frame; t: number }) {
  const t = useT();
  const s = seriesAt(run, time);
  return (
    <div className="grid grid-cols-3 gap-2 text-center mt-2">
      <div>
        <div className="text-[11px] text-slate-400">{t('Xe đang chờ', 'Vehicles waiting')}</div>
        <div className="text-lg font-semibold tabular-nums">{s ? Math.round(s.queue) : '\u2014'}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400">{t('Tổng chờ (xe·h)', 'Total wait (veh·h)')}</div>
        <div className="text-lg font-semibold tabular-nums">{s ? (s.cumWaiting / 3600).toFixed(1) : '\u2014'}</div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400">{t('Xe đã thông qua', 'Vehicles served')}</div>
        <div className="text-lg font-semibold tabular-nums">{s ? Math.round(s.discharged) : '\u2014'}</div>
      </div>
      <div className="col-span-3 text-[11px] text-slate-500">
        {s ? t(`Số liệu tại t=${s.t}s · `, `Measurements at t=${s.t}s · `) : t('Chưa có mẫu số liệu · ', 'No measurement sample yet · ')}
        {t('Đèn', 'Signals')}:{' '}
        {(['A', 'B', 'C'] as const)
          .map((n) => {
            const sg = frame.signals[n];
            const phase = sg.phase === 'MAIN' ? t('chính', 'main') : t('ngang', 'side');
            const stage = sg.stage === 'GREEN' ? '' : sg.stage === 'YELLOW' ? t(' (vàng)', ' (amber)') : t(' (đỏ hết)', ' (all-red)');
            return `${n}=${phase}${stage}`;
          })
          .join(' · ')}
      </div>
    </div>
  );
}

export function Comparison({ runs, frameIndex, progress, time, finished }: Props) {
  const { lang, theme } = usePrefs();
  const t = useT();
  const fx = runs.fixed!;
  const wg = runs.waveguard!;
  const kinds = (['fixed', 'maxpressure', 'waveguard'] as ControllerKind[]).filter((k) => runs[k]);
  const rows = computeComparison(fx, wg);
  const chartData = useMemo(() => fx.series.map((p, i) => {
    const row: Record<string, number> = { t: p.t };
    for (const k of kinds) {
      row[`${k}_q`] = Math.round(runs[k]!.series[i].queue);
      row[`${k}_w`] = +(runs[k]!.series[i].cumWaiting / 3600).toFixed(2);
    }
    return row;
  }), [runs]);
  const inc = wg.scenario.incidents[0];
  const frameFx = fx.frames[frameIndex];
  const frameWg = wg.frames[frameIndex];
  const light = theme === 'light';
  const chart = {
    grid: light ? '#e2e8f0' : '#1e2b4f',
    axis: light ? '#64748b' : '#64748b',
    cursor: light ? '#334155' : '#e2e8f0',
    tooltip: { background: light ? '#ffffff' : '#0a1530', border: `1px solid ${light ? '#cbd5e1' : '#253a6b'}`, fontSize: 12, color: light ? '#0f172a' : '#e2e8f0' },
  };
  const waveColor = light ? '#0891b2' : COLORS.waveguard;
  const color = (k: ControllerKind) => (k === 'waveguard' ? waveColor : light && k === 'fixed' ? '#64748b' : COLORS[k]);

  const charts: Array<{ title: string; suffix: '_q' | '_w'; shade: boolean }> = [
    { title: t('Số xe đang chờ theo thời gian', 'Vehicles waiting over time'), suffix: '_q', shade: true },
    { title: t('Tổng thời gian chờ tích luỹ (xe·giờ)', 'Cumulative waiting time (veh·h)'), suffix: '_w', shade: false },
  ];

  return (
    <section aria-labelledby="cmp-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="cmp-h" className="text-xl font-semibold">
          {t('Trước và sau: cùng một tình huống, hai cách điều khiển', 'Before and after: same situation, two controllers')}
        </h2>
        <p className="text-xs text-slate-400">
          {t(
            `Cùng xe đến · cùng năng lực đường · cùng thời điểm sự cố · cùng điều kiện ban đầu · cùng seed ${wg.scenario.seed} · đồng hồ đồng bộ t=${frameFx.t}s`,
            `Same arrivals · same road capacity · same incident timing · same initial state · same seed ${wg.scenario.seed} · synced clock t=${frameFx.t}s`,
          )}
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-3 min-w-0">
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="font-semibold text-slate-200">{t('Điều khiển thông thường', 'Conventional control')}</h3>
            <span className="text-xs text-slate-400">
              Fixed-Time · {t('chu kỳ', 'cycle')} {wg.config.fixedPlan.mainGreen + wg.config.fixedPlan.sideGreen + 2 * (wg.config.timing.yellow + wg.config.timing.allRed)}s
            </span>
          </div>
          <DigitalTwin frame={frameFx} progress={progress} scenario={fx.scenario} compact showPrediction={false} title={t('Mô phỏng với điều khiển Fixed-Time', 'Simulation with Fixed-Time control')} />
          <LiveStats run={fx} frame={frameFx} t={time} />
        </div>
        <div className="panel p-3 border-cyan-400/30 min-w-0">
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="font-semibold text-cyan-200">WaveGuard AI</h3>
            <span className="text-xs text-slate-400">{t('dự báo sóng + cảnh báo lan truyền', 'wave forecast + propagated warnings')}</span>
          </div>
          <DigitalTwin frame={frameWg} progress={progress} scenario={wg.scenario} compact title={t('Mô phỏng với WaveGuard', 'Simulation with WaveGuard')} />
          <LiveStats run={wg} frame={frameWg} t={time} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {charts.map((c) => (
          <div key={c.suffix} className="panel p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">{c.title}</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="t" stroke={chart.axis} fontSize={11} tickFormatter={(v) => `${Math.round(v / 60)}′`} />
                  <YAxis stroke={chart.axis} fontSize={11} />
                  <Tooltip contentStyle={chart.tooltip} labelFormatter={(v) => `t=${v}s`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {c.shade && inc && inc.type !== 'demand_surge' && <ReferenceArea x1={inc.startS} x2={inc.startS + inc.durationS} fill="#ef4444" fillOpacity={0.06} />}
                  {kinds.map((k) => (
                    <Line key={k} type="monotone" dataKey={`${k}${c.suffix}`} name={CONTROLLER_NAME[k]} stroke={color(k)} dot={false} strokeWidth={k === 'waveguard' ? 2.5 : 1.8} isAnimationActive={false} />
                  ))}
                  <ReferenceLine x={Math.max(10, Math.round(time / 10) * 10)} stroke={chart.cursor} strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className={`panel p-4 transition-opacity ${finished ? 'opacity-100' : 'opacity-60'}`}>
        <div className="flex flex-wrap justify-between gap-2 mb-2">
          <h3 className="font-semibold">{t(`Kết quả đo được trong mô phỏng (${wg.scenario.durationS}s)`, `Measured results in the simulation (${wg.scenario.durationS}s)`)}</h3>
          {!finished && <span className="text-xs text-slate-400">{t('Bảng tổng hợp toàn bộ lần chạy — phát hết để xem diễn biến', 'Summary of the full run — play to the end to follow along')}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-white/10">
                <th className="py-2 pr-3 font-medium">{t('Chỉ số', 'Metric')}</th>
                {kinds.map((k) => (
                  <th key={k} className="py-2 px-2 font-medium text-right" style={{ color: color(k) }}>
                    {CONTROLLER_NAME[k]}
                  </th>
                ))}
                <th className="py-2 pl-2 font-medium text-right">WaveGuard vs Fixed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-slate-200">
                    {t(r.label, r.labelEn)} <span className="text-slate-500">({t(r.unit, r.unitEn)})</span>
                  </td>
                  {kinds.map((k) => (
                    <td key={k} className="py-2 px-2 text-right tabular-nums">
                      {displayValue(r.key, runs[k]!.metrics[r.key] as number)}
                    </td>
                  ))}
                  <td className={`py-2 pl-2 text-right tabular-nums ${r.improved === null ? 'text-slate-400' : r.improved ? 'text-emerald-300' : 'text-red-300'}`}>
                    <span className="inline-flex items-center gap-1">
                      {r.improved === null ? <Minus size={14} /> : (r.changePct ?? 0) < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                      {r.changePct === null ? '—' : `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(1)}%`}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="border-b border-white/5">
                <td className="py-2 pr-3 text-slate-200">{t('Cảnh báo tắc nghẽn đang hoạt động (TB / tối đa)', 'Active congestion warnings (avg / max)')}</td>
                {kinds.map((k) => (
                  <td key={k} className="py-2 px-2 text-right tabular-nums">
                    {runs[k]!.metrics.avgActiveWarnings === null ? t('không áp dụng', 'n/a') : `${runs[k]!.metrics.avgActiveWarnings!.toFixed(2)} / ${runs[k]!.metrics.maxActiveWarnings}`}
                  </td>
                ))}
                <td />
              </tr>
              <tr>
                <td className="py-2 pr-3 text-slate-200">{t('Thời gian tính quyết định (ms/quyết định, đo thực)', 'Decision compute time (ms/decision, measured)')}</td>
                {kinds.map((k) => (
                  <td key={k} className="py-2 px-2 text-right tabular-nums">
                    {runs[k]!.metrics.avgDecisionTimeMs === null ? '—' : runs[k]!.metrics.avgDecisionTimeMs!.toFixed(3)}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {t('Màu xanh = WaveGuard tốt hơn Fixed-Time, đỏ = kém hơn. Các chỉ số kém hơn được hiển thị nguyên trạng.', 'Green = WaveGuard better than Fixed-Time, red = worse. Worse metrics are shown as they are.')} {lang === 'en' ? DISCLAIMER_EN : DISCLAIMER}
        </p>
      </div>
    </section>
  );
}
