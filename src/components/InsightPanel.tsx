import { seriesAt } from '../lib/sessionSeries';
import { Eye, Network, Radar, Target } from 'lucide-react';
import type { Frame, SimulationRun } from '../engine/types';
import { deriveInsight } from '../lib/insights';
import { usePrefs, useT } from '../lib/i18n';

export interface Uncertainty {
  seeds: number[];
  waitChangePct: number[];
}

interface Props {
  run: SimulationRun;
  baseline: SimulationRun;
  frame: Frame;
  uncertainty: Uncertainty | null;
  preview?: boolean;
}



export function InsightPanel({ run, baseline, frame, uncertainty, preview = false }: Props) {
  const { lang } = usePrefs();
  const t = useT();
  const ins = deriveInsight(run, frame, lang);
  const wg = seriesAt(run, frame.t);
  const fx = seriesAt(baseline, frame.t);
  if (!wg || !fx) return null;
  const diff = fx.cumWaiting > 1 ? ((wg.cumWaiting - fx.cumWaiting) / fx.cumWaiting) * 100 : 0;
  const finalDiff = baseline.metrics.cumulativeWaitingVehS > 0 ? ((run.metrics.cumulativeWaitingVehS - baseline.metrics.cumulativeWaitingVehS) / baseline.metrics.cumulativeWaitingVehS) * 100 : 0;
  const sevColor = ins.severity === 'critical' ? 'text-red-300' : ins.severity === 'warning' ? 'text-orange-300' : 'text-emerald-300';
  const rows = [
    { icon: <Eye size={16} />, title: t('WaveGuard đang quan sát', 'WaveGuard is observing'), text: ins.observing, color: 'text-slate-200' },
    { icon: <Radar size={16} />, title: t('WaveGuard đang dự báo', 'WaveGuard is forecasting'), text: ins.forecasting, color: sevColor },
    { icon: <Network size={16} />, title: t('WaveGuard đang phối hợp', 'WaveGuard is coordinating'), text: ins.coordinating, color: 'text-cyan-200' },
  ];
  const lo = uncertainty?.waitChangePct.length ? Math.min(...uncertainty.waitChangePct) : null;
  const hi = uncertainty?.waitChangePct.length ? Math.max(...uncertainty.waitChangePct) : null;
  const sign = (x: number) => (x > 0 ? '+' : '');
  return (
    <aside className="panel p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4 min-w-0" aria-live="polite">
      {rows.map((r) => (
        <div key={r.title}>
          <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
            {r.icon}
            {r.title}
          </div>
          <p className={`text-sm mt-1 leading-relaxed ${r.color}`}>{r.text}</p>
        </div>
      ))}
      <div className="border-t xl:border-t-0 xl:border-l border-white/10 pt-3 xl:pt-0 xl:pl-4">
        <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
          <Target size={16} /> {t('Kết quả mô phỏng', 'Simulation outcomes')}
        </div>
        <p className="text-sm mt-1 leading-relaxed text-slate-200">
          {t(`Mẫu t=${wg.t}s, tổng thời gian chờ: WaveGuard `, `Sample at t=${wg.t}s, total waiting time: WaveGuard `)}
          <b>{(wg.cumWaiting / 3600).toFixed(1)}</b> {t('xe·giờ so với Fixed-Time', 'veh·h vs Fixed-Time')} <b>{(fx.cumWaiting / 3600).toFixed(1)}</b> {t('xe·giờ', 'veh·h')}
          {fx.cumWaiting > 1 && (
            <span className={diff <= 0 ? 'text-emerald-300' : 'text-red-300'}>
              {' '}
              ({sign(diff)}
              {diff.toFixed(0)}%)
            </span>
          )}
          . {t(`Toàn bộ lần chạy (seed ${run.scenario.seed})`, `Full run (seed ${run.scenario.seed})`)}: {sign(finalDiff)}
          {finalDiff.toFixed(0)}%.
        </p>
        <p className="text-xs mt-1 text-slate-400">
          {uncertainty?.waitChangePct.length
            ? t(
                `Độ bất định: chạy lại với ${uncertainty.seeds.length} seed khác (cùng sự cố), mức thay đổi thời gian chờ nằm trong khoảng ${sign(lo!)}${lo!.toFixed(0)}% … ${sign(hi!)}${hi!.toFixed(0)}%.`,
                `Uncertainty: re-run with ${uncertainty.seeds.length} other seeds (same incident), the change in waiting time ranges from ${sign(lo!)}${lo!.toFixed(0)}% to ${sign(hi!)}${hi!.toFixed(0)}%.`,
              )
            : preview ? t('Chạy một kịch bản để so sánh độ bất định qua nhiều seed.', 'Run a scenario to compare uncertainty across seeds.') : t('Đang chạy thêm các seed khác để ước lượng độ bất định…', 'Running more seeds to estimate uncertainty…')}{' '}
          {t('Kết quả mô phỏng, không phải đo đạc thực tế.', 'Simulation result, not a real-world measurement.')}
        </p>
      </div>
    </aside>
  );
}
