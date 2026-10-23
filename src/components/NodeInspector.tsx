import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, ShieldCheck, X } from 'lucide-react';
import type { DecisionTrace, Frame, NodeId, SimulationRun } from '../engine/types';
import { buildNetwork } from '../engine/network';
import { explainEvidence, type Explanation } from '../lib/api';
import { usePrefs, useT } from '../lib/i18n';
import { engineText } from '../lib/engineText';
import { ExplanationView } from './ExplanationView';

const net = buildNetwork();

const ACTION_LABEL: Record<string, [string, string]> = {
  MAINTAIN: ['Giữ pha hiện tại', 'Hold current phase'],
  EXTEND: ['Kéo dài pha xanh', 'Extend green'],
  SWITCH: ['Yêu cầu chuyển pha', 'Request phase switch'],
  METER: ['Điều tiết dòng về hạ lưu', 'Meter flow downstream'],
  FALLBACK: ['Phương án dự phòng thận trọng', 'Conservative fallback'],
};

interface Props {
  node: NodeId;
  run: SimulationRun;
  frame: Frame;
  geminiReady: boolean;
  onClose: () => void;
}

export function NodeInspector({ node, run, frame, geminiReady, onClose }: Props) {
  const { lang } = usePrefs();
  const t = useT();
  const act = (a: string) => (ACTION_LABEL[a] ? t(...ACTION_LABEL[a]) : a);
  const eng = (s: string) => engineText(s, lang);
  const traces = run.decisions.filter((d) => d.node === node && d.t <= frame.t);
  const latest: DecisionTrace | undefined = traces[traces.length - 1];
  const lastChange = [...traces].reverse().find((d) => d.request === 'SWITCH' || d.selected === 'METER' || d.selected === 'FALLBACK');
  const sig = frame.signals[node];
  const fDown = frame.forecasts.find((f) => f.observer === node && f.linkId === net.mainOut[node]);
  const msgs = frame.activeMessages.filter((m) => m.target === node);
  const [loading, setLoading] = useState(false);
  const [exp, setExp] = useState<{ explanation: Explanation; model: string; ungrounded: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel?.addEventListener('keydown', trap);
    return () => { panel?.removeEventListener('keydown', trap); previous?.focus(); };
  }, []);

  useEffect(() => {
    setExp(null);
    setErr(null);
  }, [node]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ask = async () => {
    setLoading(true);
    setErr(null);
    try {
      const evidence = {
        disclaimer: 'Kết quả mô phỏng, không phải dữ liệu thực tế.',
        node,
        simulationTime: frame.t,
        currentSignal: sig,
        downstreamForecast: fDown,
        neighbourWarnings: msgs,
        latestDecision: latest,
        lastSignalChangeDecision: lastChange,
        recentDecisions: traces.slice(-6).map((d) => ({ t: d.t, selected: d.selected, request: d.request, reason: d.reason, constraints: d.constraints })),
        controllerRules: 'WaveGuard chấm điểm Giữ pha vs Chuyển pha theo số xe phục vụ được trong 10s, có chiết khấu khả năng tiếp nhận hạ lưu theo rủi ro ρ=max(rủi ro cục bộ, pheromone τ), cộng hệ số khẩn cấp theo thời gian chờ. Mọi yêu cầu đi qua bộ an toàn (xanh tối thiểu/tối đa, vàng, đỏ toàn phần, công bằng đường ngang).',
      };
      setExp(await explainEvidence(evidence, t(`Tại sao nút ${node} thay đổi (hoặc giữ) tín hiệu ở thời điểm này?`, `Why did node ${node} change (or hold) its signal at this moment?`), lang));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const phaseName = (p: string) => (p === 'MAIN' ? t('trục chính', 'main road') : t('đường ngang', 'side street'));

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="node-h">
      <button className="absolute inset-0 bg-black/50" aria-label={t('Đóng', 'Close')} onClick={onClose} />
      <div ref={panelRef} className="relative w-full max-w-lg h-full overflow-y-auto bg-navy-900 border-l border-white/10 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 id="node-h" className="text-xl font-semibold">
            {t('Nút giao', 'Intersection')} {node} <span className="text-sm text-slate-400 font-normal">· t={frame.t}s · WaveGuard</span>
          </h2>
          <button onClick={onClose} aria-label={t('Đóng', 'Close')} className="text-slate-400 hover:text-white">
            <X />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div className="panel p-3">
            <div className="text-xs text-slate-400">{t('Trạng thái giao thông', 'Traffic state')}</div>
            <div>
              {t('Vào', 'In')} ({net.mainIn[node]}): {frame.linkVehicles[net.mainIn[node]].toFixed(0)} {t('xe', 'veh')} · {Math.round(frame.linkOccupancy[net.mainIn[node]] * 100)}%
            </div>
            <div>
              {t('Ra', 'Out')} ({net.mainOut[node]}): {frame.linkVehicles[net.mainOut[node]].toFixed(0)} {t('xe', 'veh')} · {Math.round(frame.linkOccupancy[net.mainOut[node]] * 100)}%
            </div>
            <div>
              {t('Đường ngang', 'Side street')}: {frame.linkVehicles[net.sideIn[node]].toFixed(0)} {t('xe', 'veh')}
            </div>
          </div>
          <div className="panel p-3">
            <div className="text-xs text-slate-400">{t('Tín hiệu hiện tại', 'Current signal')}</div>
            <div>
              {t('Pha', 'Phase')} {phaseName(sig.phase)} — {sig.stage === 'GREEN' ? t('xanh', 'green') : sig.stage === 'YELLOW' ? t('vàng', 'amber') : t('đỏ toàn phần', 'all-red')} {sig.elapsed}s
            </div>
            <div className="mt-1 text-cyan-200">{frame.actions[node] ? act(frame.actions[node]!) : '—'}</div>
            {frame.sensorFault.includes(node) && <div className="text-amber-300 mt-1">{t('Cảm biến đang mất tín hiệu', 'Sensor is offline')}</div>}
          </div>
          <div className="panel p-3">
            <div className="text-xs text-slate-400">
              {t('Rủi ro cục bộ', 'Local risk')} ({net.mainOut[node]})
            </div>
            {fDown ? (
              <>
                <div className="text-lg font-semibold">{fDown.risk.toFixed(2)}</div>
                <div className="text-xs text-slate-400">
                  {fDown.timeToCapacity !== null ? t(`đầy sau ~${Math.round(fDown.timeToCapacity)}s`, `full in ~${Math.round(fDown.timeToCapacity)}s`) : t('không đang đầy lên', 'not filling up')} · {t('tin cậy', 'confidence')}{' '}
                  {Math.round(fDown.confidence * 100)}%
                </div>
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="panel p-3">
            <div className="text-xs text-slate-400">{t('Cảnh báo từ nút lân cận', 'Warnings from neighbours')}</div>
            <div className="text-lg font-semibold">τ = {frame.pheromone[node].toFixed(2)}</div>
            <div className="text-xs text-slate-400">
              {msgs.length
                ? msgs.map((m) => `${m.source}→${node} r=${m.risk.toFixed(2)} (${m.linkId}), ${t(`còn ${Math.max(0, m.expiry - frame.t)}s`, `${Math.max(0, m.expiry - frame.t)}s left`)}`).join('; ')
                : t('Không có cảnh báo đang hiệu lực', 'No active warnings')}
            </div>
          </div>
        </div>

        <h3 className="mt-5 font-semibold">{t('Vì sao có quyết định này?', 'Why this decision?')}</h3>
        {latest ? (
          <div className="mt-2 text-sm space-y-3">
            <div className="text-xs text-slate-400">{t(`Bản ghi quyết định t=${latest.t}s`, `Decision record t=${latest.t}s`)}</div>
            <p className="text-slate-100">
              <b className="text-cyan-200">{act(latest.selected)}</b> — {eng(latest.reason)}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="py-1">{t('Phương án', 'Option')}</th>
                  <th>{t('Pha đích', 'Target phase')}</th>
                  <th className="text-right pr-3">{t('Điểm', 'Score')}</th>
                  <th className="pl-1">{t('Khả thi', 'Feasible')}</th>
                </tr>
              </thead>
              <tbody>
                {latest.candidates.map((c, i) => (
                  <tr key={i} className={`border-t border-white/5 ${c.action === latest.selected ? 'text-cyan-200' : 'text-slate-300'}`}>
                    <td className="py-1">{act(c.action)}</td>
                    <td>{c.targetPhase === 'MAIN' ? t('chính', 'main') : t('ngang', 'side')}</td>
                    <td className="text-right tabular-nums pr-3">{c.score === null ? '—' : c.score.toFixed(2)}</td>
                    <td className="pl-1">
                      {c.feasible ? '✓' : '✗'} <span className="text-slate-500">{eng(c.note)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {latest.constraints.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 flex items-center gap-1">
                  <ShieldCheck size={14} /> {t('Ràng buộc ảnh hưởng', 'Constraints in effect')}
                </div>
                <ul className="list-disc ml-5 text-slate-300">
                  {latest.constraints.map((c, i) => (
                    <li key={i}>{eng(c)}</li>
                  ))}
                </ul>
              </div>
            )}
            {lastChange && lastChange !== latest && (
              <p className="text-xs text-slate-400">
                {t('Lần đổi/điều tiết gần nhất', 'Last switch/metering')}: t={lastChange.t}s — {act(lastChange.selected)}: {eng(lastChange.reason)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400 mt-2">{t('Chưa có bản ghi quyết định trước thời điểm này.', 'No decision recorded before this moment.')}</p>
        )}

        <div className="mt-5">
          <button
            onClick={ask}
            disabled={!geminiReady || loading || !latest}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 bg-violet-500/20 border border-violet-400/40 text-violet-100 hover:bg-violet-500/30 disabled:opacity-40"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />} {t(`Tại sao nút ${node} thay đổi tín hiệu? (Gemini)`, `Why did node ${node} change its signal? (Gemini)`)}
          </button>
          {!geminiReady && (
            <p className="text-xs text-slate-400 mt-2">
              {t('Gemini không khả dụng trong bản triển khai này — bản ghi quyết định ở trên là giải thích gốc, đầy đủ.', 'Gemini is unavailable in this deployment — the decision record above is the complete, original explanation.')}
            </p>
          )}
          {err && <p className="text-sm text-red-300 mt-2">{err}</p>}
          {exp && <ExplanationView {...exp} compact />}
        </div>
      </div>
    </div>
  );
}
