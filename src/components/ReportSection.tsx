import { memo, useState } from 'react';
import { Bot, FileDown, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import type { ControllerKind, SimulationRun } from '../engine/types';
import { benchmarkJson, buildEvidence, computeComparison, decisionsCsv, DISCLAIMER, DISCLAIMER_EN, displayValue, LIMITATIONS, LIMITATIONS_EN, reportHtml, seriesCsv } from '../engine/report';
import { download, explainEvidence, type Explanation } from '../lib/api';
import { usePrefs, useT } from '../lib/i18n';
import { engineText } from '../lib/engineText';
import { ExplanationView } from './ExplanationView';

interface Props {
  runs: Partial<Record<ControllerKind, SimulationRun>>;
  incidentText: string;
  confirmed: unknown;
  confirmedSummary: string;
  assumptions: string[];
  geminiReady: boolean;
}

function ReportSectionImpl({ runs, incidentText, confirmed, confirmedSummary, assumptions, geminiReady }: Props) {
  const { lang } = usePrefs();
  const t = useT();
  const eng = (s: string | null | undefined) => engineText(s, lang);
  const fx = runs.fixed!;
  const wg = runs.waveguard!;
  const [loading, setLoading] = useState(false);
  const [exp, setExp] = useState<{ explanation: Explanation; model: string; ungrounded: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cmp = computeComparison(fx, wg);
  const better = cmp.filter((r) => r.improved === true);
  const worse = cmp.filter((r) => r.improved === false);
  const firstWarn = wg.events.find((e) => e.kind === 'warning');
  const firstMeter = wg.events.filter((e) => e.kind === 'meter');
  const peak = wg.frames.reduce<{ t: number; risk: number; text: string | null } | null>((b, f) => {
    for (const fc of f.forecasts) if (!b || fc.risk > b.risk) b = { t: f.t, risk: fc.risk, text: fc.warning };
    return b;
  }, null);
  const firstPredWarning = wg.frames.find((f) => f.forecasts.some((fc) => fc.warning && fc.linkId !== 'in-A' && fc.confidence >= 0.5 && fc.risk >= wg.config.waveguard.emitThreshold));
  const firstPred = firstPredWarning?.forecasts.find((fc) => fc.warning && fc.linkId !== 'in-A' && fc.confidence >= 0.5 && fc.risk >= wg.config.waveguard.emitThreshold);
  const spillFx = fx.events.find((e) => e.kind === 'spillback');
  const spillWg = wg.events.find((e) => e.kind === 'spillback');
  const counts: Record<string, number> = {};
  for (const d of wg.decisions) counts[d.selected] = (counts[d.selected] ?? 0) + 1;
  const pairs = [...new Set(wg.messages.map((m) => `${m.source}→${m.target}`))];
  const metricList = (rows: typeof cmp) =>
    rows.map((r) => `${t(r.label, r.labelEn).toLowerCase()} (${displayValue(r.key, r.baseline)} → ${displayValue(r.key, r.proposed)} ${t(r.unit, r.unitEn)})`).join('; ');

  const startEvents = wg.events.filter((e) => e.kind === 'incident' || e.kind === 'sensor').map((e) => `t=${e.t}s: ${eng(e.text)}`).join('; ');
  const qa: Array<[string, string]> = [
    [
      t('Điều gì đã xảy ra?', 'What happened?'),
      `${confirmedSummary}. ${startEvents}${
        spillFx
          ? t(` Với Fixed-Time, hàng chờ tràn ngược tới nút thượng lưu lần đầu ở t=${spillFx.t}s (${spillFx.linkId}).`, ` Under Fixed-Time, the queue first spilled back to the upstream intersection at t=${spillFx.t}s (${spillFx.linkId}).`)
          : ''
      }`,
    ],
    [
      t('Vì sao WaveGuard dự báo ùn tắc?', 'Why did WaveGuard forecast congestion?'),
      firstPred
        ? t(
            `Lần đầu ở t=${firstPredWarning!.t}s, nút ${firstPred.observer} đo thấy ${firstPred.linkId} tích luỹ xe (dòng vào − dòng ra = ${firstPred.netRate.toFixed(2)} xe/s): ${firstPred.warning} Rủi ro cao nhất trong lần chạy: ${peak?.risk.toFixed(2)} tại t=${peak?.t}s.`,
            `First at t=${firstPredWarning!.t}s, node ${firstPred.observer} saw ${firstPred.linkId} accumulating vehicles (inflow − outflow = ${firstPred.netRate.toFixed(2)} veh/s): ${eng(firstPred.warning)} Highest risk in the run: ${peak?.risk.toFixed(2)} at t=${peak?.t}s.`,
          )
        : t('Mô hình không dự báo đoạn nào đầy trong cửa sổ dự báo, nên không có cảnh báo sóng ùn tắc.', 'The model did not forecast any link filling up within the horizon, so there was no queue-wave warning.'),
    ],
    [
      t('Các nút giao đã phối hợp thế nào?', 'How did the intersections coordinate?'),
      wg.messages.length
        ? t(
            `${wg.messages.length} thông điệp rủi ro được gửi theo hướng ngược dòng (${pairs.join(', ')}). ${firstWarn ? `Cảnh báo đầu tiên: t=${firstWarn.t}s — ${firstWarn.text}.` : ''} Cường độ cảnh báo (pheromone) suy giảm theo thời gian và hết hạn sau ${wg.config.waveguard.messageTtlS}s nếu không được củng cố.`,
            `${wg.messages.length} risk messages were sent upstream (${pairs.join(', ')}). ${firstWarn ? `First warning: t=${firstWarn.t}s — ${eng(firstWarn.text)}.` : ''} Warning strength (pheromone) decays over time and expires after ${wg.config.waveguard.messageTtlS}s unless reinforced.`,
          )
        : t('Không có thông điệp rủi ro nào vượt ngưỡng phát; các nút chỉ điều khiển theo nhu cầu cục bộ.', 'No risk message crossed the emission threshold; nodes only followed local demand.'),
    ],
    [
      t('Hành động điều khiển nào đã được chọn?', 'Which control actions were chosen?'),
      `${t('Số bản ghi quyết định', 'Decision records')}: ${Object.entries(counts)
        .map(([k, v]) => `${k}×${v}`)
        .join(', ')}. ${firstMeter.length ? firstMeter.map((e) => `t=${e.t}s: ${eng(e.text)}`).join('; ') + '.' : t('Không có hành động điều tiết.', 'No metering actions.')} ${t(
        'Mọi yêu cầu đều qua bộ an toàn tín hiệu (xanh tối thiểu/tối đa, vàng, đỏ toàn phần, công bằng đường ngang).',
        'Every request went through the signal safety layer (min/max green, amber, all-red, side-street fairness).',
      )}`,
    ],
    [
      t('WaveGuard có cải thiện hiệu quả không?', 'Did WaveGuard improve performance?'),
      `${better.length ? `${t('Tốt hơn ở', 'Better on')}: ${metricList(better)}.` : t('Không cải thiện chỉ số nào.', 'No metric improved.')} ${worse.length ? `${t('Kém hơn ở', 'Worse on')}: ${metricList(worse)}.` : ''}${
        spillWg ? '' : spillFx ? t(' WaveGuard không để hàng chờ tràn tới nút thượng lưu theo tiêu chí spillback.', ' WaveGuard kept the queue from spilling back to the upstream intersection.') : ''
      }`,
    ],
    [t('Còn những hạn chế nào?', 'What are the limitations?'), (lang === 'en' ? LIMITATIONS_EN : LIMITATIONS).slice(0, 4).join(' ')],
  ];

  const evidence = () => buildEvidence(runs, incidentText, confirmed);

  const askGemini = async () => {
    setLoading(true);
    setErr(null);
    try {
      setExp(await explainEvidence(evidence(), undefined, lang));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const geminiText = exp
    ? [exp.explanation.headline, '', t('Quan sát:', 'Observations:'), ...exp.explanation.observations, '', t('Dự báo:', 'Predictions:'), ...exp.explanation.predictions, '', t('Hành động:', 'Actions:'), ...exp.explanation.actions, '', t('Kết quả mô phỏng:', 'Simulation outcomes:'), ...exp.explanation.outcomes, '', t('Độ bất định:', 'Uncertainty:'), ...exp.explanation.uncertainty, ...(exp.ungrounded.length ? [t('Số liệu chưa xác minh:', 'Unverified numbers:'), exp.ungrounded.join(', ')] : [])].join('\n')
    : null;

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return (
    <section aria-labelledby="report-h" className="panel p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="report-h" className="text-xl font-semibold">
            {t('Giải thích & kết quả', 'Explanation & results')}
          </h2>
          <p className="text-sm text-slate-400">
            {t(
              'Tóm tắt tự động từ dữ liệu mô phỏng (không dùng AI). Bấm “Giải thích bằng Gemini” để có diễn giải ngôn ngữ tự nhiên dựa trên cùng dữ liệu.',
              'Automatic summary from the simulation data (no AI). Click “Explain with Gemini” for a natural-language explanation based on the same data.',
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={askGemini}
            disabled={!geminiReady || loading}
            title={geminiReady ? '' : t('Cần backend Gemini', 'Gemini unavailable on the server')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 bg-violet-500/20 border border-violet-400/40 text-violet-100 hover:bg-violet-500/30 disabled:opacity-40"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />} {t('Giải thích bằng Gemini', 'Explain with Gemini')}
          </button>
          <button
            onClick={() => download(`waveguard-bao-cao-${stamp}.html`, reportHtml({ lang, runs, incidentText, confirmedSummary, assumptions, geminiExplanation: geminiText, geminiModel: exp?.model ?? null }), 'text/html;charset=utf-8')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 bg-wg-cyan text-navy-950 font-semibold hover:brightness-110"
          >
            <FileDown size={16} /> {t('Xuất báo cáo', 'Export report')}
          </button>
          <button
            onClick={() => download(`waveguard-ket-qua-${stamp}.json`, JSON.stringify(benchmarkJson(runs, { incidentText, confirmedIncident: confirmed, geminiExplanation: exp }), null, 2), 'application/json')}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 border border-white/15 text-slate-200 hover:bg-white/5"
          >
            <FileJson size={16} /> JSON
          </button>
          <button
            onClick={() => {
              download(`waveguard-chuoi-thoi-gian-${stamp}.csv`, seriesCsv(runs), 'text/csv;charset=utf-8');
              download(`waveguard-quyet-dinh-${stamp}.csv`, decisionsCsv(wg), 'text/csv;charset=utf-8');
            }}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 border border-white/15 text-slate-200 hover:bg-white/5"
          >
            <FileSpreadsheet size={16} /> CSV
          </button>
        </div>
      </div>
      {!geminiReady && (
        <p className="mt-2 text-xs text-slate-400">
          {t(
            'Gemini không khả dụng trong bản triển khai này nên nút giải thích bằng AI bị tắt. Báo cáo bên dưới hoàn toàn được tính từ mô phỏng.',
            'Gemini is unavailable in this deployment, so the AI explanation button is disabled. The report below is computed entirely from the simulation.',
          )}
        </p>
      )}

      <dl className="mt-4 grid md:grid-cols-2 gap-4">
        {qa.map(([q, a]) => (
          <div key={q} className="rounded-xl bg-navy-950/50 border border-white/5 p-4">
            <dt className="font-semibold text-cyan-100">{q}</dt>
            <dd className="mt-1 text-sm text-slate-300 leading-relaxed">{a}</dd>
          </div>
        ))}
      </dl>

      {err && (
        <p className="mt-3 text-sm text-red-300">
          {t('Gemini lỗi', 'Gemini error')}: {err}
        </p>
      )}
      {exp && <ExplanationView {...exp} />}

      <p className="mt-5 rounded-lg bg-orange-500/10 border border-orange-400/30 p-3 text-sm text-orange-100 font-medium">{lang === 'en' ? DISCLAIMER_EN : DISCLAIMER}</p>
    </section>
  );
}

export const ReportSection = memo(ReportSectionImpl, (a, b) => a.runs === b.runs && a.incidentText === b.incidentText && a.confirmed === b.confirmed && a.confirmedSummary === b.confirmedSummary && a.geminiReady === b.geminiReady);
