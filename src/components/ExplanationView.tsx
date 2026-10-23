import { Bot } from 'lucide-react';
import type { Explanation } from '../lib/api';
import { useT } from '../lib/i18n';

const SECTIONS: Array<{ key: keyof Omit<Explanation, 'headline'>; vi: string; en: string }> = [
  { key: 'observations', vi: 'Quan sát trong mô phỏng', en: 'Observed in the simulation' },
  { key: 'predictions', vi: 'Dự báo của mô hình', en: 'Model forecasts' },
  { key: 'actions', vi: 'Hành động của bộ điều khiển', en: 'Controller actions' },
  { key: 'outcomes', vi: 'Kết quả đo được (mô phỏng)', en: 'Measured outcomes (simulated)' },
  { key: 'uncertainty', vi: 'Độ bất định & hạn chế', en: 'Uncertainty & limitations' },
];

export function ExplanationView({ explanation, model, ungrounded, compact }: { explanation: Explanation; model: string; ungrounded: string[]; compact?: boolean }) {
  const t = useT();
  return (
    <div className={`mt-4 rounded-xl border border-violet-400/30 bg-violet-500/[0.07] ${compact ? 'p-3' : 'p-5'}`}>
      <div className="text-xs text-violet-300 flex items-center gap-1.5">
        <Bot size={14} /> {t(`Giải thích bởi Gemini (${model}) — dựa trên gói bằng chứng mô phỏng`, `Explained by Gemini (${model}) — grounded in the simulation evidence`)}
      </div>
      {explanation.headline && <p className={`mt-2 font-semibold text-violet-50 ${compact ? 'text-sm' : 'text-base'}`}>{explanation.headline}</p>}
      <div className={`mt-2 grid gap-3 ${compact ? '' : 'md:grid-cols-2'}`}>
        {SECTIONS.map((s) =>
          explanation[s.key].length ? (
            <div key={s.key}>
              <div className="text-xs uppercase tracking-wide text-violet-300/80">{t(s.vi, s.en)}</div>
              <ul className="mt-1 space-y-1 text-sm text-slate-200">
                {explanation[s.key].map((x, i) => (
                  <li key={i}>• {x}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        {ungrounded.length
          ? t(
              `Kiểm tra căn cứ: các số ${ungrounded.join(', ')} không tìm thấy trực tiếp trong dữ liệu mô phỏng — hãy đối chiếu với bảng số liệu.`,
              `Grounding check: the numbers ${ungrounded.join(', ')} were not found directly in the simulation data — compare with the results table.`,
            )
          : t('Kiểm tra số học sơ bộ không phát hiện số liệu lệch ngoài dung sai. Nội dung AI vẫn cần đối chiếu với bảng kết quả.', 'The preliminary numeric check found no values outside its tolerance. AI statements still need comparison with the results table.')}
      </p>
    </div>
  );
}
