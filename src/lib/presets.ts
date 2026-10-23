import { getScenario } from '../engine/scenarios';
import type { ScenarioConfig } from '../engine/types';
import type { ConfirmedIncident, ParsedIncident } from '../shared/incident';
import { NODE_TO_LINK } from '../shared/incident';
import { tr, type Lang } from './i18n';

export interface Preset {
  id: 'truck' | 'rush' | 'sensor';
  label: string;
  labelEn: string;
  text: string;
  textEn: string;
  draft: ConfirmedIncident;
}

export const PRESETS: Preset[] = [
  {
    id: 'truck',
    label: 'Xe tải hỏng tại nút C',
    labelEn: 'Truck breakdown at node C',
    textEn: 'A truck broke down on the stretch between nodes B and C. Traffic is heavy and the queue may back up to node A.',
    text: 'Xe tải bị hỏng tại đoạn đường giữa nút B và C. Lưu lượng đang cao, xe có nguy cơ ùn ngược về nút A.',
    draft: {
      incidentType: 'road_blockage',
      affectedNode: 'C',
      affectedLink: 'B-C',
      capacityReduction: 0.7,
      demandChange: 0,
      durationSeconds: 900,
      startS: 120,
      summary: 'Xe tải hỏng trên đoạn B-C gần nút C, nguy cơ ùn ngược về A.',
      assumptions: ['capacityReduction', 'durationSeconds'],
      source: 'preset',
    },
  },
  {
    id: 'rush',
    label: 'Lưu lượng tăng đột biến giờ cao điểm',
    labelEn: 'Rush-hour demand surge',
    textEn: 'Evening rush hour: traffic entering the corridor through node A has surged.',
    text: 'Giờ cao điểm buổi chiều, lưu lượng đi vào hành lang qua nút A tăng đột biến.',
    draft: {
      incidentType: 'demand_surge',
      affectedNode: 'A',
      affectedLink: 'in-A',
      capacityReduction: 0,
      demandChange: 0.35,
      durationSeconds: 900,
      startS: 120,
      summary: 'Lưu lượng giờ cao điểm vào hành lang qua nút A tăng đột biến.',
      assumptions: ['demandChange', 'durationSeconds'],
      source: 'preset',
    },
  },
  {
    id: 'sensor',
    label: 'Cảm biến tại nút B mất tín hiệu',
    labelEn: 'Sensor at node B offline',
    textEn: 'The sensor at node B has lost signal while a parked vehicle is obstructing link B-C.',
    text: 'Cảm biến tại nút B mất tín hiệu trong khi có xe dừng đỗ gây cản trở trên đoạn B-C.',
    draft: {
      incidentType: 'sensor_failure',
      affectedNode: 'B',
      affectedLink: 'B-C',
      capacityReduction: 0.45,
      demandChange: 0,
      durationSeconds: 600,
      startS: 150,
      summary: 'Nút B mất dữ liệu cảm biến; xe dừng đỗ gây cản trở trên B-C.',
      assumptions: ['capacityReduction', 'durationSeconds'],
      source: 'preset',
    },
  },
];

export const ASSUMPTION_OPTIONS = {
  capacityReduction: [0.3, 0.5, 0.7, 0.9],
  demandChange: [0.2, 0.35, 0.5],
  durationSeconds: [600, 900, 1200, 1800],
};

export const DEFAULT_ASSUMPTION = { capacityReduction: 0.7, demandChange: 0.35, durationSeconds: 900 };

export const FIELD_LABEL: Record<string, string> = {
  capacityReduction: 'Mức giảm năng lực thông hành',
  demandChange: 'Mức thay đổi lưu lượng',
  durationSeconds: 'Thời gian sự cố',
  affectedLink: 'Đoạn đường bị ảnh hưởng',
  severity: 'Mức độ nghiêm trọng',
};

export const FIELD_LABEL_EN: Record<string, string> = {
  capacityReduction: 'Capacity reduction',
  demandChange: 'Demand change',
  durationSeconds: 'Incident duration',
  affectedLink: 'Affected link',
  severity: 'Severity',
};

export const fieldLabel = (f: string, lang: Lang) => (lang === 'en' ? FIELD_LABEL_EN : FIELD_LABEL)[f] ?? f;

export function assumptionText(d: ConfirmedIncident, lang: Lang = 'vi'): string[] {
  return d.assumptions.map((a) => {
    if (a === 'capacityReduction') return tr(lang, `Giả định thử nghiệm: năng lực thông hành giảm ${Math.round(d.capacityReduction * 100)}%.`, `Test assumption: capacity reduced by ${Math.round(d.capacityReduction * 100)}%.`);
    if (a === 'demandChange') return tr(lang, `Giả định thử nghiệm: lưu lượng tăng ${Math.round(d.demandChange * 100)}%.`, `Test assumption: demand up ${Math.round(d.demandChange * 100)}%.`);
    if (a === 'durationSeconds') return tr(lang, `Giả định thử nghiệm: sự cố kéo dài ${Math.round(d.durationSeconds / 60)} phút.`, `Test assumption: incident lasts ${Math.round(d.durationSeconds / 60)} min.`);
    return tr(lang, `Giả định thử nghiệm: ${a}`, `Test assumption: ${a}`);
  });
}

/** Turn Gemini's validated output into an editable draft; unknown numbers become clearly labelled assumptions. */
export function draftFromParsed(p: ParsedIncident): ConfirmedIncident {
  if (p.incidentType === 'unknown') throw new Error('unsupported_incident');
  const type = p.incidentType;
  const node = p.affectedNode ?? (p.affectedLink === 'A-B' ? 'B' : p.affectedLink === 'in-A' ? 'A' : 'C');
  let link = p.affectedLink ?? NODE_TO_LINK[node];
  if (type === 'sensor_failure' && (link === 'in-A' || !p.affectedLink)) link = 'B-C';
  const assumptions: string[] = [];
  const cap = p.capacityReduction ?? (type === 'sensor_failure' || type === 'demand_surge' ? 0 : (assumptions.push('capacityReduction'), DEFAULT_ASSUMPTION.capacityReduction));
  const dem = p.demandChange ?? (type === 'demand_surge' ? (assumptions.push('demandChange'), DEFAULT_ASSUMPTION.demandChange) : 0);
  const dur = p.durationSeconds ?? (assumptions.push('durationSeconds'), DEFAULT_ASSUMPTION.durationSeconds);
  return {
    incidentType: type,
    affectedNode: node,
    affectedLink: link,
    capacityReduction: cap,
    demandChange: dem,
    durationSeconds: Math.min(3000, Math.max(60, dur)),
    startS: 120,
    summary: p.summary,
    assumptions,
    source: 'gemini',
  };
}

export function baseScenario(seed: number): ScenarioConfig {
  const s = getScenario('incident', seed);
  return { ...s, incidents: [], sensorFaults: [] };
}

export function confirmedSummary(d: ConfirmedIncident, lang: Lang = 'vi'): string {
  const types = lang === 'en'
    ? { road_blockage: 'Road blockage', capacity_drop: 'Capacity drop', demand_surge: 'Demand surge', sensor_failure: 'Sensor failure' }
    : { road_blockage: 'Chắn đường', capacity_drop: 'Giảm năng lực', demand_surge: 'Tăng lưu lượng', sensor_failure: 'Mất cảm biến' };
  const parts = [tr(lang, `${types[d.incidentType]} — nút ${d.affectedNode}, đoạn ${d.affectedLink}`, `${types[d.incidentType]} — node ${d.affectedNode}, link ${d.affectedLink}`)];
  if (d.capacityReduction > 0) parts.push(tr(lang, `giảm ${Math.round(d.capacityReduction * 100)}% năng lực`, `capacity −${Math.round(d.capacityReduction * 100)}%`));
  if (d.demandChange) parts.push(tr(lang, `lưu lượng +${Math.round(d.demandChange * 100)}%`, `demand +${Math.round(d.demandChange * 100)}%`));
  parts.push(tr(lang, `từ t=${d.startS}s trong ${Math.round(d.durationSeconds / 60)} phút`, `from t=${d.startS}s for ${Math.round(d.durationSeconds / 60)} min`));
  return parts.join(', ');
}
