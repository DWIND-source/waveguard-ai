import { Bot, Check, ClipboardList, X } from 'lucide-react';
import type { LinkId, NodeId } from '../engine/types';
import type { ConfirmedIncident } from '../shared/incident';
import { ASSUMPTION_OPTIONS, fieldLabel } from '../lib/presets';
import { usePrefs, useT } from '../lib/i18n';

interface Props {
  draft: ConfirmedIncident;
  onChange: (d: ConfirmedIncident) => void;
  onConfirm: () => void;
  onCancel: () => void;
  model: string | null;
  removedUnsupported: string[];
  missing: string[];
}

const TYPE_LABEL: Record<ConfirmedIncident['incidentType'], [string, string]> = {
  road_blockage: ['Chắn đường (xe hỏng / tai nạn)', 'Road blockage (breakdown / crash)'],
  capacity_drop: ['Giảm năng lực (thi công, ngập…)', 'Capacity drop (roadworks, flooding…)'],
  demand_surge: ['Lưu lượng tăng đột biến', 'Demand surge'],
  sensor_failure: ['Cảm biến mất tín hiệu', 'Sensor failure'],
};

function AssumptionTag({ on }: { on: boolean }) {
  const t = useT();
  return on ? <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 border border-amber-400/30">{t('Giả định thử nghiệm', 'Test assumption')}</span> : null;
}

export function ConfirmPanel({ draft, onChange, onConfirm, onCancel, model, removedUnsupported, missing }: Props) {
  const { lang } = usePrefs();
  const t = useT();
  const set = (patch: Partial<ConfirmedIncident>, field?: string) => {
    const assumptions = field ? draft.assumptions.filter((a) => a !== field) : draft.assumptions;
    onChange({ ...draft, ...patch, assumptions: field ? [...assumptions, field] : assumptions });
  };
  const isAssumed = (f: string) => draft.assumptions.includes(f);
  const sel = 'w-full rounded-lg bg-navy-950 border border-navy-600 px-3 py-2 text-sm focus:border-wg-cyan outline-none';
  const showCap = draft.incidentType !== 'demand_surge';
  const showDemand = draft.incidentType === 'demand_surge';

  return (
    <section aria-labelledby="confirm-h" className="panel p-5 md:p-6 border-violet-400/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="confirm-h" className="text-lg font-semibold flex items-center gap-2">
            {draft.source === 'gemini' ? <Bot size={18} className="text-wg-purple" /> : <ClipboardList size={18} className="text-wg-cyan" />}
            {t('Xác nhận tham số sự cố', 'Confirm incident parameters')}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {draft.source === 'gemini'
              ? t(
                  `Gemini (${model}) đã đọc mô tả và đề xuất các tham số dưới đây. Kiểm tra và chỉnh sửa trước khi áp dụng vào mô phỏng.`,
                  `Gemini (${model}) read the description and proposed the parameters below. Check and edit them before they are applied to the simulation.`,
                )
              : draft.source === 'preset'
                ? t('Kịch bản mẫu với tham số có cấu trúc (không qua Gemini).', 'Example scenario with structured parameters (not from Gemini).')
                : t('Nhập tham số thủ công (không dùng AI).', 'Manual parameters (no AI).')}
          </p>
        </div>
        <button onClick={onCancel} aria-label={t('Đóng', 'Close')} className="text-slate-400 hover:text-white">
          <X size={20} />
        </button>
      </div>

      {draft.source === 'gemini' && (
        <div className="mt-3 rounded-lg bg-violet-500/10 border border-violet-400/30 p-3 text-sm">
          <div className="text-violet-200 font-medium">{t('Gemini hiểu là:', 'Gemini understood:')}</div>
          <div className="text-slate-100">{draft.summary}</div>
          {missing.length > 0 && (
            <div className="mt-1 text-amber-200/90">
              {t('Thông tin còn thiếu trong mô tả', 'Missing from the description')}: {missing.map((m) => fieldLabel(m, lang)).join(', ')} — {t('hãy chọn giả định thử nghiệm.', 'pick a test assumption.')}
            </div>
          )}
          {removedUnsupported.length > 0 && (
            <div className="mt-1 text-slate-300">
              {t('Máy chủ đã loại bỏ số liệu không có trong mô tả', 'The server removed numbers not present in the description')}: {removedUnsupported.map((m) => fieldLabel(m, lang)).join(', ')}.
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="text-slate-300">{t('Loại sự cố', 'Incident type')}</span>
          <select className={sel} value={draft.incidentType} onChange={(e) => set({ incidentType: e.target.value as ConfirmedIncident['incidentType'] })}>
            {Object.entries(TYPE_LABEL).map(([k, [vi, en]]) => (
              <option key={k} value={k}>
                {t(vi, en)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-300">{draft.incidentType === 'sensor_failure' ? t('Nút mất cảm biến', 'Node with failed sensor') : t('Nút bị ảnh hưởng', 'Affected node')}</span>
          <select className={sel} value={draft.affectedNode} onChange={(e) => set({ affectedNode: e.target.value as NodeId })}>
            {(['A', 'B', 'C'] as NodeId[]).map((n) => (
              <option key={n} value={n}>
                {t('Nút', 'Node')} {n}
              </option>
            ))}
          </select>
        </label>
        {draft.incidentType !== 'demand_surge' && (
          <label className="text-sm">
            <span className="text-slate-300">{draft.incidentType === 'sensor_failure' ? t('Đoạn có cản trở (nếu có)', 'Obstructed link (if any)') : t('Đoạn đường bị ảnh hưởng', 'Affected link')}</span>
            <select className={sel} value={draft.affectedLink} onChange={(e) => set({ affectedLink: e.target.value as LinkId })}>
              {(['in-A', 'A-B', 'B-C', 'C-out'] as LinkId[]).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {showCap && (
          <label className="text-sm">
            <span className="text-slate-300">
              {t('Giảm năng lực thông hành', 'Capacity reduction')} <AssumptionTag on={isAssumed('capacityReduction')} />
            </span>
            <select className={sel} value={draft.capacityReduction} onChange={(e) => set({ capacityReduction: Number(e.target.value) }, 'capacityReduction')}>
              {(draft.incidentType === 'sensor_failure' ? [0, 0.3, 0.45, 0.6] : ASSUMPTION_OPTIONS.capacityReduction)
                .concat([draft.capacityReduction])
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort((a, b) => a - b)
                .map((v) => (
                  <option key={v} value={v}>
                    {v === 0 ? t('Không có cản trở', 'No obstruction') : t(`Giảm ${Math.round(v * 100)}%`, `−${Math.round(v * 100)}%`)}
                  </option>
                ))}
            </select>
          </label>
        )}
        {showDemand && (
          <label className="text-sm">
            <span className="text-slate-300">
              {t('Lưu lượng tăng', 'Demand increase')} <AssumptionTag on={isAssumed('demandChange')} />
            </span>
            <select className={sel} value={draft.demandChange} onChange={(e) => set({ demandChange: Number(e.target.value) }, 'demandChange')}>
              {ASSUMPTION_OPTIONS.demandChange
                .concat([draft.demandChange])
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort((a, b) => a - b)
                .map((v) => (
                  <option key={v} value={v}>
                    +{Math.round(v * 100)}%
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="text-slate-300">
            {t('Thời gian kéo dài', 'Duration')} <AssumptionTag on={isAssumed('durationSeconds')} />
          </span>
          <select className={sel} value={draft.durationSeconds} onChange={(e) => set({ durationSeconds: Number(e.target.value) }, 'durationSeconds')}>
            {ASSUMPTION_OPTIONS.durationSeconds
              .concat([draft.durationSeconds])
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort((a, b) => a - b)
              .map((v) => (
                <option key={v} value={v}>
                  {Math.round(v / 60)} {t('phút', 'min')}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-300">{t('Bắt đầu tại (giây mô phỏng)', 'Starts at (simulation seconds)')}</span>
          <input type="number" min={0} max={600} step={10} className={sel} value={draft.startS} onChange={(e) => set({ startS: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })} />
        </label>
      </div>

      {draft.assumptions.length > 0 && (
        <ul className="mt-4 text-sm text-amber-100/90 space-y-1">
          {draft.assumptions.map((a) => (
            <li key={a}>
              • {a === 'capacityReduction' && t(`Giả định thử nghiệm: năng lực thông hành giảm ${Math.round(draft.capacityReduction * 100)}%.`, `Test assumption: capacity reduced by ${Math.round(draft.capacityReduction * 100)}%.`)}
              {a === 'demandChange' && t(`Giả định thử nghiệm: lưu lượng tăng ${Math.round(draft.demandChange * 100)}%.`, `Test assumption: demand up ${Math.round(draft.demandChange * 100)}%.`)}
              {a === 'durationSeconds' && t(`Giả định thử nghiệm: sự cố kéo dài ${Math.round(draft.durationSeconds / 60)} phút.`, `Test assumption: incident lasts ${Math.round(draft.durationSeconds / 60)} min.`)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button onClick={onConfirm} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-semibold bg-wg-cyan text-navy-950 hover:brightness-110">
          <Check size={18} /> {t('Xác nhận & chạy mô phỏng', 'Confirm & run simulation')}
        </button>
        <button onClick={onCancel} className="rounded-xl px-4 py-2.5 border border-navy-600 text-slate-300 hover:text-white">
          {t('Huỷ', 'Cancel')}
        </button>
      </div>
    </section>
  );
}
