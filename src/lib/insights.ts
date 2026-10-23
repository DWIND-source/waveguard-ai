import type { Frame, LinkForecast, NodeId, SimulationRun } from '../engine/types';
import { engineText } from './engineText';
import { tr, type Lang } from './i18n';

export interface Insight {
  observing: string;
  forecasting: string;
  coordinating: string;
  severity: 'normal' | 'warning' | 'critical';
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Most severe forecast per link (prefer the observer with better confidence). */
export function bestForecasts(frame: Frame): LinkForecast[] {
  const by = new Map<string, LinkForecast>();
  for (const f of frame.forecasts) {
    const cur = by.get(f.linkId);
    if (!cur || f.confidence > cur.confidence + 0.2 || (Math.abs(f.confidence - cur.confidence) <= 0.2 && f.risk > cur.risk)) by.set(f.linkId, f);
  }
  return [...by.values()];
}

/** All texts are derived from the current WaveGuard simulation frame. */
export function deriveInsight(run: SimulationRun, frame: Frame, lang: Lang = 'vi'): Insight {
  const t_ = (vi: string, en: string) => tr(lang, vi, en);
  const sc = run.scenario;
  const t = frame.t;
  const inc = sc.incidents.find((i) => i.type !== 'demand_surge' && t >= i.startS && t < i.startS + i.durationS);
  const surge = sc.incidents.find((i) => i.type === 'demand_surge' && t >= i.startS && t < i.startS + i.durationS);
  const mainLinks = ['in-A', 'A-B', 'B-C', 'C-out'] as const;
  const worst = mainLinks.reduce((a, b) => (frame.linkOccupancy[b] > frame.linkOccupancy[a] ? b : a));

  let observing: string;
  if (frame.sensorFault.length) {
    observing = t_(
      `Nút ${frame.sensorFault.join(', ')} mất dữ liệu cảm biến — WaveGuard không suy đoán trạng thái tại đó và dùng quan sát của nút lân cận. Đoạn đông nhất: ${worst} (${pct(frame.linkOccupancy[worst])} sức chứa).`,
      `Node ${frame.sensorFault.join(', ')} lost sensor data — WaveGuard does not guess the state there and relies on neighbouring nodes. Busiest link: ${worst} (${pct(frame.linkOccupancy[worst])} of capacity).`,
    );
  } else if (inc) {
    const nodeNear = inc.linkId === 'B-C' ? 'C' : inc.linkId === 'A-B' ? 'B' : 'A';
    observing = t_(
      `Sự cố trên ${inc.linkId} gần nút ${nodeNear}: năng lực thông hành còn ${pct(1 - inc.capacityReduction)}. ${inc.linkId} đang chứa ${frame.linkVehicles[inc.linkId].toFixed(0)} xe (${pct(frame.linkOccupancy[inc.linkId])} sức chứa), hàng chờ ${frame.linkQueue[inc.linkId].toFixed(0)} xe.`,
      `Incident on ${inc.linkId} near node ${nodeNear}: ${pct(1 - inc.capacityReduction)} of capacity left. ${inc.linkId} holds ${frame.linkVehicles[inc.linkId].toFixed(0)} veh (${pct(frame.linkOccupancy[inc.linkId])} of capacity), queue ${frame.linkQueue[inc.linkId].toFixed(0)} veh.`,
    );
  } else if (surge) {
    observing = t_(
      `Lưu lượng vào hành lang tăng ${pct(surge.demandIncrease)}. Đoạn đông nhất: ${worst} (${pct(frame.linkOccupancy[worst])} sức chứa).`,
      `Corridor demand up ${pct(surge.demandIncrease)}. Busiest link: ${worst} (${pct(frame.linkOccupancy[worst])} of capacity).`,
    );
  } else {
    observing = t_(`Giao thông ổn định. Đoạn đông nhất: ${worst} (${pct(frame.linkOccupancy[worst])} sức chứa).`, `Traffic is stable. Busiest link: ${worst} (${pct(frame.linkOccupancy[worst])} of capacity).`);
  }

  const fcs = bestForecasts(frame).filter((f) => f.warning).sort((a, b) => b.risk - a.risk);
  let forecasting: string;
  if (fcs.length) {
    const f = fcs[0];
    forecasting = `${engineText(f.warning, lang)} (${t_('rủi ro', 'risk')} ${f.risk.toFixed(2)}, ${t_('độ tin cậy', 'confidence')} ${pct(f.confidence)}).`;
    if (fcs.length > 1) forecasting += t_(` Thêm ${fcs.length - 1} cảnh báo khác.`, ` ${fcs.length - 1} more warning(s).`);
  } else {
    forecasting = t_(`Chưa thấy đoạn nào có nguy cơ đầy trong cửa sổ dự báo ${run.config.waveguard.horizonS}s.`, `No link is at risk of filling up within the ${run.config.waveguard.horizonS}s forecast horizon.`);
  }

  const msgs = frame.activeMessages;
  const metering = (Object.entries(frame.actions) as Array<[NodeId, string | null]>).filter(([, a]) => a === 'METER').map(([n]) => n);
  const fallback = (Object.entries(frame.actions) as Array<[NodeId, string | null]>).filter(([, a]) => a === 'FALLBACK').map(([n]) => n);
  const parts: string[] = [];
  if (msgs.length) {
    const pairs = [...new Set(msgs.map((m) => `${m.source}→${m.target}`))];
    parts.push(t_(`Tín hiệu cảnh báo đang lan truyền: ${pairs.join(', ')}`, `Warnings propagating: ${pairs.join(', ')}`) + ` (τ: A=${frame.pheromone.A.toFixed(2)}, B=${frame.pheromone.B.toFixed(2)}).`);
  }
  if (metering.length) parts.push(t_(`Nút ${metering.join(', ')} đang điều tiết dòng về đoạn hạ lưu, nhường xanh cho đường ngang.`, `Node ${metering.join(', ')} is metering flow into the downstream link, giving green to the side street.`));
  if (fallback.length) parts.push(t_(`Nút ${fallback.join(', ')} dùng phương án dự phòng (chu kỳ cố định) vì thiếu dữ liệu.`, `Node ${fallback.join(', ')} uses the fallback (fixed cycle) due to missing data.`));
  const coordinating = parts.length ? parts.join(' ') : t_('Các nút tự điều chỉnh pha theo nhu cầu cục bộ; chưa cần phối hợp.', 'Each node adjusts phases to local demand; no coordination needed yet.');

  const maxRisk = Math.max(0, ...frame.forecasts.map((f) => f.risk));
  return { observing, forecasting, coordinating, severity: maxRisk >= 0.7 ? 'critical' : maxRisk >= 0.3 ? 'warning' : 'normal' };
}
