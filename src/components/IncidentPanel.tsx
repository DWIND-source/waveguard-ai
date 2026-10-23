import { AlertTriangle, Bot, CheckCircle2, Loader2, Play, Sparkles, Wand2 } from 'lucide-react';
import type { ApiStatus } from '../lib/api';
import { PRESETS, type Preset } from '../lib/presets';
import { usePrefs, useT } from '../lib/i18n';

interface Props {
  status: ApiStatus | null;
  text: string;
  onText: (s: string) => void;
  onAnalyze: () => void;
  onPreset: (p: Preset) => void;
  onDemo: () => void;
  onManual: () => void;
  analyzing: boolean;
  error: string | null;
  demoBusy: boolean;
}

export function IncidentPanel({ status, text, onText, onAnalyze, onPreset, onDemo, onManual, analyzing, error, demoBusy }: Props) {
  const { lang } = usePrefs();
  const t = useT();
  const gem = status?.gemini;
  return (
    <section aria-labelledby="incident-h" className="panel p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <label id="incident-h" htmlFor="incident-text" className="text-lg md:text-xl font-semibold">
          {t('Điều gì đang xảy ra trên đường?', 'What is happening on the road?')}
        </label>
        <span
          className={`chip px-3 py-1 text-xs flex items-center gap-1.5 ${gem ? 'text-violet-200 border-violet-400/40 bg-violet-500/10' : 'text-slate-300 bg-slate-500/10'}`}
          title={gem ? t(`Gemini qua máy chủ (${status?.model})`, `Gemini via server (${status?.model})`) : t('Chưa có GEMINI_API_KEY — dùng điều khiển thủ công', 'No GEMINI_API_KEY — manual controls')}
        >
          <Bot size={14} />
          {status === null
            ? t('Đang kiểm tra Gemini…', 'Checking Gemini…')
            : gem
              ? t(`Gemini đã cấu hình · ${status.model}`, `Gemini configured · ${status.model}`)
              : t('Gemini chưa cấu hình — chế độ thủ công', 'Gemini not configured — manual mode')}
        </span>
      </div>
      <textarea
        id="incident-text"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onAnalyze();
        }}
        rows={3}
        placeholder={t('Ví dụ: Một xe tải gặp sự cố gần nút C, khiến lưu lượng bị ùn ứ...', 'E.g. A truck broke down near node C and traffic is backing up...')}
        className="w-full rounded-xl bg-navy-950/70 border border-navy-600 focus:border-wg-cyan outline-none p-4 text-base placeholder:text-slate-500 resize-y"
      />
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-400 mr-1">{t('Ví dụ:', 'Examples:')}</span>
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => onPreset(p)} className="chip px-3 py-1.5 text-sm hover:bg-white/5 hover:border-wg-cyan/60 transition">
            {lang === 'en' ? p.labelEn : p.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <button
          onClick={onAnalyze}
          disabled={analyzing || !text.trim()}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold bg-wg-cyan text-navy-950 disabled:opacity-40 hover:brightness-110 transition"
        >
          {analyzing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
          {analyzing ? t('Gemini đang phân tích…', 'Gemini is analysing…') : t('Phân tích & Điều phối', 'Analyse & Coordinate')}
        </button>
        <button
          onClick={onDemo}
          disabled={demoBusy}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold border border-wg-cyan/60 text-cyan-100 bg-cyan-500/10 hover:bg-cyan-500/20 transition disabled:opacity-40"
        >
          <Play size={18} /> {t('Chạy demo phối hợp', 'Run coordination demo')}
        </button>
        <button onClick={onManual} className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white underline-offset-4 hover:underline">
          <Wand2 size={15} /> {t('Nhập tham số thủ công', 'Enter parameters manually')}
        </button>
      </div>
      {!gem && status !== null && (
        <p className="mt-3 text-sm text-slate-400 flex items-start gap-2">
          <AlertTriangle size={16} className="text-wg-orange shrink-0 mt-0.5" />
          {t(
            'Phân tích sự cố bằng AI đang tắt (máy chủ chưa có GEMINI_API_KEY). “Phân tích & Điều phối” sẽ mở bảng tham số thủ công; kịch bản mẫu dùng tham số có cấu trúc, không phải kết quả của Gemini.',
            'AI incident analysis is off (no GEMINI_API_KEY on the server). “Analyse & Coordinate” opens the manual parameter form; examples use structured parameters, not Gemini output.',
          )}
        </p>
      )}
      {gem && (
        <p className="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
          <CheckCircle2 size={14} className="text-violet-300" />{' '}
          {t(
            'Gemini chỉ diễn giải mô tả thành tham số có cấu trúc; bạn xác nhận trước khi áp dụng. Gemini không điều khiển đèn tín hiệu.',
            'Gemini only turns the description into structured parameters; you confirm before they are applied. Gemini never controls the signals.',
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {error}
        </p>
      )}
    </section>
  );
}
